# SPDX-License-Identifier: GPL-3.0-only
# rgb_keys.py - per-key RGB for the 3x4 pad, as a KMK module.
# Copy this file to the root of CIRCUITPY (next to code.py).
#
# Replaces KMK's own RGB extension, which paints all LEDs with one colour.
# Here every key has its own colour, stored per layer (profile), and the
# colours follow the active layer, so a profile change recolours the pad.
#
# Hardware: 12x SK6812MINI-E on ONE data pin, daisy-chained in a snake.
# If the colours land on the wrong keys, fix LED_FOR_KEY below (nothing else).
#
# Utility keys it adds (use them in a layer): KC.LED_TOG, KC.LED_DIM, KC.LED_BRT
#
# Needs neopixel in CIRCUITPY/lib (10.x bundle, KMK uses it too).
# If anything in here fails, the error is printed and the LEDs stay off;
# the keyboard itself keeps working.

import time

import neopixel

from kmk.keys import make_key
from kmk.modules import Module

KEYS = 12
WHITE = 0xFFFFFF

# LED_FOR_KEY[key index] = position of that key's LED in the data chain.
# Key index counts row by row: 0-3 top row, 4-7 middle, 8-11 bottom.
# Snake wiring: top row left->right, middle right->left, bottom left->right.
LED_FOR_KEY = (0, 1, 2, 3,
               7, 6, 5, 4,
               8, 9, 10, 11)

# brightness steps for the DIM / BRT keys (0.5 max keeps 12 LEDs inside USB limits)
LEVELS = (0.05, 0.12, 0.25, 0.4, 0.5)

# When the profile changes, all keys show the new profile's main colour for this long (seconds), then the
# per-key colours return. Only between profiles: holding FN (the utility layer) does not flash.
SWITCH_FLASH_S = 0.3

# A brightness change made with the DIM / BRT keys is handed to on_level this long after the last key press, so
# holding the key down to go from dim to bright writes the pad's memory once, not at every step.
SAVE_AFTER_S = 2.0

# Soft start. At power-up the computer may only give the pad 100 mA until it has enumerated the device, and 12 LEDs at
# once can draw about three times that. On a weak or crowded hub the sudden load pulls the whole hub's voltage down and
# resets what else is plugged into it (seen: a Bluetooth module). So the LEDs stay dark for START_DELAY_S, which lets
# USB finish, and then fade up to the chosen brightness over RAMP_S seconds.
START_DELAY_S = 1.0
RAMP_S = 2.0


class RgbKeys(Module):
    def __init__(self, pin, level=3, press_flash=True, on_level=None):
        self._pin = pin
        self._level = max(0, min(level, len(LEVELS) - 1))
        self._flash = press_flash
        self._on_level = on_level   # function(level): remembers the step across a power-off (code.py sets it)
        self._save_at = 0
        self._t0 = None         # when the soft start began: the first scan, not power-up (the screen's start-up logo
                                # blocks for about 2 s before the first scan, which would use up the fade)
        self._ramp = 1.0        # 0 to 1: how far the soft start has got (1 = done, or none)

        self.ui = None          # the OledUI: the LEDs dim and switch off with the screen (set by code.py)
        self.profile_layers = 0 # layers below this number are profiles; 0 = no flash on profile change
        self._idle = 0          # 0 in use, 1 dimmed, 2 off (follows the screen)
        self._flash_until = 0
        self._flash_color = 0

        self.px = None
        self.enabled = False
        self.on = True
        self.colors = []        # colors[layer][key] = 0xRRGGBB
        self.layer = -1
        self._down = set()
        self._last_tick = 0

        # keys for the utility layer
        make_key(names=("LED_TOG",), on_press=self._toggle)
        make_key(names=("LED_DIM",), on_press=self._dimmer)
        make_key(names=("LED_BRT",), on_press=self._brighter)

    # ------------------------------------------------------------ colours
    def set_colors(self, colors):
        """colors: one list of 12 0xRRGGBB values per layer."""
        self.colors = colors
        self.layer = -1         # forces a repaint

    def set_key(self, layer, key, color):
        """Change one key's colour on one layer (used for live preview)."""
        self.colors[layer][key] = color
        if layer == self.layer:
            self._paint()

    def _accent(self, layer):
        # the colour most keys of a layer have, ignoring dark keys: the profile's main colour
        row = self.colors[layer] if 0 <= layer < len(self.colors) else ()
        counts = {}
        best = 0
        for c in row:
            if c:
                counts[c] = counts.get(c, 0) + 1
                if counts[c] > counts.get(best, 0):
                    best = c
        return best

    def _color(self, i):
        if not self.on or self._idle == 2:
            return 0
        if self._flash_until and self._flash_color:
            return self._flash_color
        if i in self._down and self._flash:
            return WHITE
        layer = self.layer if 0 <= self.layer < len(self.colors) else 0
        row = self.colors[layer] if self.colors else ()
        return row[i] if i < len(row) else 0

    def _paint(self):
        if self.px is None:
            return
        for i in range(KEYS):
            self.px[LED_FOR_KEY[i]] = self._color(i)
        self.px.show()

    # ------------------------------------------------------------ utility keys
    def _toggle(self, *args, **kwargs):
        self.on = not self.on
        self._paint()

    def _dimmer(self, *args, **kwargs):
        self._level = max(0, self._level - 1)
        self._save_at = time.monotonic() + SAVE_AFTER_S
        self._apply_level()

    def _brighter(self, *args, **kwargs):
        self._level = min(len(LEVELS) - 1, self._level + 1)
        self._save_at = time.monotonic() + SAVE_AFTER_S
        self._apply_level()

    def _brightness(self):
        # while the screen is dimmed the LEDs drop to the lowest step (never up: a lower setting stays)
        b = LEVELS[self._level]
        return (min(b, LEVELS[0]) if self._idle == 1 else b) * self._ramp

    def _apply_level(self):
        if self.px is not None:
            self.px.brightness = self._brightness()
            self._paint()

    def _soft_start(self, now):
        # one step of the fade-in; the LEDs are repainted only when the step changes
        r = (now - self._t0 - START_DELAY_S) / RAMP_S
        r = 0.0 if r < 0 else (1.0 if r >= 1 else r)
        if r != self._ramp:
            self._ramp = r
            self._apply_level()

    def _apply_idle(self, idle):
        self._idle = idle
        if idle == 2:
            self._flash_until = 0
        self._apply_level()

    # ------------------------------------------------------------ KMK hooks
    def during_bootup(self, keyboard):
        try:
            self._t0 = None
            self._ramp = 0.0
            self.px = neopixel.NeoPixel(
                self._pin, KEYS, brightness=0,
                auto_write=False, pixel_order=neopixel.GRB)
            self.enabled = True
            self.layer = keyboard.active_layers[0]
            self._paint()
            print("rgb_keys ready")
        except Exception as e:
            print("rgb_keys error in setup:", e)

    def process_key(self, keyboard, key, is_pressed, int_coord):
        if not self.enabled:
            return key
        try:
            if int_coord is not None and 0 <= int_coord < KEYS:
                if is_pressed:
                    self._down.add(int_coord)
                else:
                    self._down.discard(int_coord)
                if self._flash:
                    self._paint()
        except Exception as e:
            print("rgb_keys error:", e)
            self.enabled = False
        return key

    def before_matrix_scan(self, keyboard):
        if not self.enabled:
            return None
        now = time.monotonic()
        if now - self._last_tick < 0.05:
            return None
        self._last_tick = now
        if self._save_at and now >= self._save_at:
            self._save_at = 0
            if self._on_level is not None:
                try:
                    self._on_level(self._level)
                except Exception as e:      # never let a memory error switch the LEDs off
                    print("rgb_keys level not saved:", e)
        try:
            if self._ramp < 1.0:
                if self._t0 is None:
                    self._t0 = now
                self._soft_start(now)
            if self.ui is not None:
                idle = self.ui.idle_level()
                if idle != self._idle:
                    self._apply_idle(idle)
            layer = keyboard.active_layers[0]
            if layer != self.layer:
                old = self.layer
                self.layer = layer
                # a flash tells you the profile changed (by app focus, or by hand): only profile to profile,
                # never for the utility layer, and not while the LEDs are off
                if 0 <= old < self.profile_layers and layer < self.profile_layers and self._idle != 2:
                    self._flash_color = self._accent(layer)
                    self._flash_until = now + SWITCH_FLASH_S
                self._paint()
            elif self._flash_until and now >= self._flash_until:
                self._flash_until = 0
                self._paint()
        except Exception as e:
            print("rgb_keys error:", e)
            self.enabled = False
        return None

    def after_matrix_scan(self, keyboard):
        return None

    def before_hid_send(self, keyboard):
        return None

    def after_hid_send(self, keyboard):
        return None

    def on_powersave_enable(self, keyboard):
        return None

    def on_powersave_disable(self, keyboard):
        return None
