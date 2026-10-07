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


class RgbKeys(Module):
    def __init__(self, pin, level=3, press_flash=True):
        self._pin = pin
        self._level = max(0, min(level, len(LEVELS) - 1))
        self._flash = press_flash

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

    def _color(self, i):
        if not self.on:
            return 0
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
        self._apply_level()

    def _brighter(self, *args, **kwargs):
        self._level = min(len(LEVELS) - 1, self._level + 1)
        self._apply_level()

    def _apply_level(self):
        if self.px is not None:
            self.px.brightness = LEVELS[self._level]
            self._paint()

    # ------------------------------------------------------------ KMK hooks
    def during_bootup(self, keyboard):
        try:
            self.px = neopixel.NeoPixel(
                self._pin, KEYS, brightness=LEVELS[self._level],
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
        try:
            layer = keyboard.active_layers[0]
            if layer != self.layer:
                self.layer = layer
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
