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

import math
import random
import time

import neopixel

try:
    from supervisor import ticks_ms
except ImportError:                 # on a normal computer (the tests)
    def ticks_ms():
        return int(time.monotonic() * 1000) & 0x1FFFFFFF

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

# Effects (settings.effect in the config, chosen in SnekPad Studio). "static" shows the profile's per-key colours. The
# others make their own colours: "equalizer" and "beat" (music, see below), "rainbow" (a wave of colour sweeping from left to right), "ripple" (a ring of a random
# colour spreads from the key you press) and "starry" (random keys twinkle). Brightness always stays inside the steps
# above. config_loader.EFFECTS lists the same names.
#
# Smoothness. The pad has only a few KB of free RAM. In CircuitPython every number with a decimal point, and every new
# list or tuple, takes some of it, and when it runs out everything stops for about 50 ms to clean up. Drawn from
# decimal numbers, an effect did that every half second, and that was the stutter. So the effects here use whole
# numbers only (times in milliseconds, strengths and brightness 0 to 1024, tables worked out once at start) and make
# no new objects per frame. The same goes for the clock that decides when to draw.
#
# Music (settings.effect "equalizer" or "beat"): SnekPad Studio listens to the sound the computer plays and sends the
# pad five numbers 0 to 63, about 25 times a second (see AppProfiles._line): the loudness of four bands from bass to
# treble, and how hard a beat has just hit (0 = none). "equalizer" lights each column of keys like a bar, from the
# bottom row up, one column per band. "beat" flashes all the keys on every beat and moves the colour on round the
# wheel. The pad smooths the numbers (they rise at once and fall away over about half a second) and lets the keys go
# dark when the numbers stop coming. Unlike the other effects they ignore the screen's dimming and sleep: the screen
# still sleeps, but the lights keep following the music (the key LED toggle still switches them off).
#
# The LED chip has 256 steps per colour and the brightness steps of this pad leave it 12 (lowest step) to 127. Rounding
# to those steps is all that is done. Carrying the rounding error from frame to frame (dithering) was tried and made
# single colours flicker; a slow fade down to dark (the Breathing effect, taken out again) showed its steps at the two
# dimmest brightness steps and was not worth the extra code.
FRAME_MS = 25               # time between two frames of a moving effect (40 a second)
STILL_MS = 50               # the same without an effect
RAINBOW_MS = 4000           # one trip round the colour wheel for the sweeping wave (rainbow): 0.25 cycles a second
LOOP_MS = RAINBOW_MS        # the rainbow's clock wraps here, after a whole number of trips round the wheel
RAINBOW_SPREAD = 307        # how much of the colour wheel lies between two columns: 0.2 of it (WHEEL * 0.2)
RIPPLE_LIFE_MS = 1200       # how long a ripple lasts
RIPPLE_SPEED16 = 72         # how fast the ring spreads, in sixteenths of a key per second (4.5 keys a second)
RIPPLE_WIDTH16 = 19         # thickness of the ring, in sixteenths of a key
MAX_RIPPLES = 4
TWINKLE_MS = 1600           # how long one star takes to light up and fade
TWINKLE_ONE_IN = 10         # a new star appears on about one frame in this many
MAX_STARS = 5
MUSIC_HOLD_MS = 400         # the music numbers count as fresh for this long after the last message
MUSIC_FALL = 48             # how far a bar falls on each frame, of 1024 (all the way down in about half a second)
MUSIC_BEAT_FALL = 90        # the same for the beat flash
MUSIC_BEAT_HUE = 140        # how far the beat moves the colour on round the wheel (of 1536)
MUSIC_ROW = 341             # a bar of 1024 fills three rows of keys: this much for each
COLUMNS = 4
WHEEL = 1536                # positions round the colour wheel
CLOCK_MASK = 0xFFFFFF       # the clock for ripples and stars wraps after 4.6 hours; ages are taken modulo this

# distance between two keys, in sixteenths of a key (a key to the next one is 16)
DIST = bytes(
    int(math.sqrt((a // COLUMNS - b // COLUMNS) ** 2 + (a % COLUMNS - b % COLUMNS) ** 2) * 16)
    for a in range(KEYS) for b in range(KEYS)
)
# brightness over one star (64 steps), 0 to 255: a squared sine, the eye reads brightness on a curve and this looks even
TWINKLE = bytes(int(255 * math.sin(3.1416 * i / 64) ** 2) for i in range(64))


def _wheel(p):
    """Fully saturated colour at position p (a whole number, WHEEL = once round) of the colour wheel, as 0xRRGGBB."""
    p %= WHEEL
    seg = p >> 8
    f = p & 255
    if seg == 0:
        return 0xFF0000 | (f << 8)
    if seg == 1:
        return ((255 - f) << 16) | 0x00FF00
    if seg == 2:
        return 0x00FF00 | f
    if seg == 3:
        return 0x0000FF | ((255 - f) << 8)
    if seg == 4:
        return (f << 16) | 0x0000FF
    return 0xFF0000 | (255 - f)


class RgbKeys(Module):
    def __init__(self, pin, level=3, press_flash=True, on_level=None, effect="static"):
        self._pin = pin
        self.effect = effect    # static, rainbow, ripple, starry, equalizer or beat
        self._last_ms = 0       # ticks_ms of the last frame
        self._last = None       # ticks_ms of the last frame of an effect
        self._ms = 0            # the effects' clock, for ripples and stars (wraps at CLOCK_MASK)
        self._tt = 0            # the rainbow's clock (wraps at LOOP_MS)
        self._c = 0             # colour and strength (0 to 1024) of the key being worked out
        self._g = 1024
        self._drawn = False
        # the music effects keep the lights going while the screen sleeps (they go dark by themselves when the music stops)
        self._music_fx = effect == "equalizer" or effect == "beat"
        # only the effect in use gets its memory
        if effect == "ripple":
            self._rp_t = [-1] * MAX_RIPPLES                             # start time, -1 = free
            self._rp_k = [0] * MAX_RIPPLES                              # the key it started from
            self._rp_c = [0] * MAX_RIPPLES                              # its colour
        elif effect == "equalizer" or effect == "beat":
            self._mt = [0] * COLUMNS                                    # the loudness of each band last heard, 0 to 1008
            self._mu = [0] * COLUMNS                                    # what the bars show now (smoothed), 0 to 1024
            self._mb = 0                                                # the beat flash now, 0 to 1024
            self._mh = 0                                                # the beat's colour, a position on the wheel
            self._mu_ms = 0                                             # ticks_ms of the last music message
        elif effect == "starry":
            self._st_t = [-1] * KEYS                                    # start time of the star on a key, -1 = none
            self._st_c = [0] * KEYS
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

    def _moving(self):
        # a moving effect runs on the profiles; the utility layer (holding FN) always shows its own colours
        return self.effect != "static" and (not self.profile_layers or self.layer < self.profile_layers)

    def _base(self, i):
        layer = self.layer if 0 <= self.layer < len(self.colors) else 0
        row = self.colors[layer] if self.colors else ()
        return row[i] if i < len(row) else 0

    def _color(self, i):
        if not self.on or self._idle == 2:
            return 0
        if self._flash_until and self._flash_color:
            return self._flash_color
        if i in self._down and self._flash:
            return WHITE
        return self._base(i)

    def _pixel(self, i):
        """Work out key i for a moving effect: its colour in self._c and how strong it is (0 to 1024) in self._g."""
        e = self.effect
        self._g = 1024
        if e == "rainbow":
            # minus the time: the colours move from the left column to the right one
            self._c = _wheel((i % COLUMNS) * RAINBOW_SPREAD - self._tt * WHEEL // RAINBOW_MS)
        elif e == "equalizer":
            # column = band, bottom row first: each row is 341 of the bar's 1024, and fades in over a third of that
            g = (self._mu[i % COLUMNS] - (2 - i // COLUMNS) * MUSIC_ROW) * 3
            self._c = _wheel((i % COLUMNS) * RAINBOW_SPREAD)
            self._g = 0 if g < 0 else 1024 if g > 1024 else g
        elif e == "beat":
            self._c = _wheel(self._mh)
            self._g = self._mb
        elif e == "ripple":
            best = 0
            c = 0
            for r in range(MAX_RIPPLES):
                start = self._rp_t[r]
                if start < 0:
                    continue
                age = (self._ms - start) & CLOCK_MASK
                if age >= RIPPLE_LIFE_MS:
                    continue
                x = DIST[self._rp_k[r] * KEYS + i] - age * RIPPLE_SPEED16 // 1000
                if x < 0:
                    x = -x
                if x < RIPPLE_WIDTH16:
                    k = (RIPPLE_WIDTH16 - x) * (RIPPLE_LIFE_MS - age) * 1024 // (RIPPLE_WIDTH16 * RIPPLE_LIFE_MS)
                    if k > best:
                        best = k
                        c = self._rp_c[r]
            self._c = c
            self._g = best
        elif e == "starry":
            start = self._st_t[i]
            if start < 0:
                self._c = 0
            else:
                n = ((self._ms - start) & CLOCK_MASK) * 64 // TWINKLE_MS
                self._c = self._st_c[i]
                self._g = TWINKLE[n if n < 64 else 63] * 4
        else:
            self._c = self._base(i)

    def _paint_moving(self):
        px = self.px
        if not self.on or self._idle == 2:
            for i in range(KEYS):
                px[LED_FOR_KEY[i]] = 0
            px.show()
            return
        bright = int(self._brightness() * 1024)    # px.brightness is 1 while an effect moves: applied here instead
        for i in range(KEYS):
            self._pixel(i)
            c = self._c
            gain = self._g * bright
            out = 0
            for shift in (16, 8, 0):
                # at most 255 * 1024 * 1024: a small number, no object
                out = (out << 8) | ((((c >> shift) & 255) * gain + 0x80000) >> 20)
            px[LED_FOR_KEY[i]] = out
        px.show()

    def _step_effect(self, ms):
        """Advance a moving effect by one frame (ms = ticks_ms now) and draw it."""
        e = self.effect
        # the time that has passed, in whole milliseconds taken from the one exact clock, so it never drifts
        dt = (ms - self._last) & 0x1FFFFFFF if self._last is not None else 0
        self._last = ms
        if dt > 500:                        # a long pause: no jump
            dt = 0
        # the clocks add small steps, so they stay exact however long the pad has been on
        self._ms = (self._ms + dt) & CLOCK_MASK
        self._tt = (self._tt + dt) % LOOP_MS
        if e == "ripple":
            active = False
            for r in range(MAX_RIPPLES):
                if self._rp_t[r] >= 0:
                    if ((self._ms - self._rp_t[r]) & CLOCK_MASK) >= RIPPLE_LIFE_MS:
                        self._rp_t[r] = -1
                    else:
                        active = True
            if not active and not self._drawn:
                return
            self._drawn = active        # one more frame after the last ripple puts the keys dark
        elif e == "equalizer" or e == "beat":
            fresh = ((ms - self._mu_ms) & 0x1FFFFFFF) < MUSIC_HOLD_MS
            active = False
            for c in range(COLUMNS):
                t = self._mt[c] if fresh else 0
                v = self._mu[c]
                v = t if t >= v else (t if v - MUSIC_FALL < t else v - MUSIC_FALL)    # up at once, down gently
                self._mu[c] = v
                if v:
                    active = True
            self._mb = 0 if self._mb < MUSIC_BEAT_FALL else self._mb - MUSIC_BEAT_FALL
            if self._mb:
                active = True
            if not active and not self._drawn:
                return
            self._drawn = active        # one more frame after the last light goes out puts the keys dark
        elif e == "starry":
            count = 0
            for k in range(KEYS):
                if self._st_t[k] >= 0:
                    if ((self._ms - self._st_t[k]) & CLOCK_MASK) >= TWINKLE_MS:
                        self._st_t[k] = -1
                    else:
                        count += 1
            if count < MAX_STARS and random.randrange(TWINKLE_ONE_IN) == 0:
                k = random.randrange(KEYS)
                if self._st_t[k] < 0:
                    self._st_t[k] = self._ms
                    self._st_c[k] = _wheel(random.randrange(WHEEL))
        self._paint()

    def music(self, a, b, c, d, beat):
        """The loudness of the four bands and the strength of a beat just heard, each 0 to 63 (from Studio)."""
        if self.effect != "equalizer" and self.effect != "beat":
            return
        mt = self._mt
        mt[0] = (a & 63) * 16
        mt[1] = (b & 63) * 16
        mt[2] = (c & 63) * 16
        mt[3] = (d & 63) * 16
        beat = (beat & 63) * 16
        if beat > self._mb:             # a beat: flash, and move the colour on
            self._mb = beat
            self._mh = (self._mh + MUSIC_BEAT_HUE) % WHEEL
        self._mu_ms = ticks_ms()

    def _ripple_from(self, key):
        slot = 0
        for r in range(MAX_RIPPLES):    # a free slot, or the oldest ripple
            if self._rp_t[r] < 0:
                slot = r
                break
            if ((self._ms - self._rp_t[r]) & CLOCK_MASK) > ((self._ms - self._rp_t[slot]) & CLOCK_MASK):
                slot = r
        self._rp_t[slot] = self._ms
        self._rp_k[slot] = key
        self._rp_c[slot] = _wheel(random.randrange(WHEEL))
        self._drawn = True

    def _paint(self):
        if self.px is None:
            return
        if self._moving():
            self._paint_moving()
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
            self.px.brightness = 1.0 if self._moving() else self._brightness()
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
                    if self.effect == "ripple" and self.on and self._idle != 2 and self._moving():
                        self._ripple_from(int_coord)
                else:
                    self._down.discard(int_coord)
                if self._flash and not self._moving():
                    self._paint()
        except Exception as e:
            print("rgb_keys error:", e)
            self.enabled = False
        return key

    def before_matrix_scan(self, keyboard):
        if not self.enabled:
            return None
        ms = ticks_ms()                 # whole numbers: this runs hundreds of times a second and must make no objects
        if ((ms - self._last_ms) & 0x1FFFFFFF) < (STILL_MS if self.effect == "static" else FRAME_MS):
            return None
        self._last_ms = ms
        now = time.monotonic()
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
            if self.ui is not None and not self._music_fx:
                idle = self.ui.idle_level()
                if idle != self._idle:
                    self._apply_idle(idle)
            layer = keyboard.active_layers[0]
            if layer != self.layer:
                old = self.layer
                self.layer = layer
                # a flash tells you the profile changed (by app focus, or by hand): only profile to profile,
                # never for the utility layer, and not while the LEDs are off
                if (self.effect == "static" and 0 <= old < self.profile_layers and layer < self.profile_layers
                        and self._idle != 2):
                    self._flash_color = self._accent(layer)
                    self._flash_until = now + SWITCH_FLASH_S
                self._apply_level()     # also paints; the utility layer is not an effect, so brightness is set again
            elif self._flash_until and now >= self._flash_until:
                self._flash_until = 0
                self._paint()
            if self.px is not None and self.on and self._idle != 2 and self._moving():
                self._step_effect(ms)
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
