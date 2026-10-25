# SPDX-License-Identifier: GPL-3.0-only
# encoder_modes.py - rotary encoder with a push button, as a KMK module.
# Copy this file to the root of CIRCUITPY (next to code.py).
# Replaces KMK's EncoderHandler so the first touch can wake the OLED without doing anything.
#
#   1. Idle      the OLED is showing the owner/logo screen. The first turn or press
#                only wakes the screen and does nothing else.
#   2. Default   turning runs the profile's knob action (volume, tab, scroll...).
#   3. Press     pressing the knob runs the profile's press action.
#
# Turning is counted by the RP2040 itself (rotaryio, a PIO state machine), so a turn is not missed when the main loop is
# busy with the screen, the lights or memory clean-up. Without it (the pins are not next to each other, or no PIO block
# is free) the two contacts are looked at on every pass of the main loop, as before.
#
# If anything in here fails, the error is printed and the knob goes dead;
# the keys keep working.

import time

import digitalio

from kmk.modules import Module

try:
    import rotaryio     # the RP2040 counts the knob in hardware (a PIO state machine)
except ImportError:
    rotaryio = None

# quadrature transition table, index = (previous AB << 2) | new AB (used only when the hardware counter is not there)
_TABLE = (0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0)

# Clicks counted but not typed yet are capped at this many: a long stall followed by a lot of turning must not type a
# long burst of keys afterwards.
_MAX_BACKLOG = 12


class EncoderModes(Module):
    def __init__(
        self,
        pin_a,
        pin_b,
        pin_sw,
        actions,             # actions[layer] = (turn left, turn right, press) as KC keys
        reverse=False,       # True if the knob turns the wrong way
        divisor=4,           # raw pulses per click
        debounce_s=0.02,
    ):
        self._pins = (pin_a, pin_b, pin_sw)
        self.actions = actions
        self._reverse = reverse
        self._div = divisor
        self._debounce = debounce_s

        self.ui = None            # set to the OledUI after it is created (wake / asleep)
        self.press_hook = None    # a prompt on the screen (firmware update) can take the next press: function() -> True if it did
        self.enabled = False

        self._a = self._b = self._sw = None
        self._enc = None          # rotaryio.IncrementalEncoder: counts the clicks by itself, however busy the main loop is
        self._last = 0            # its position when it was last read
        self._backlog = 0         # clicks it has counted that are not typed yet (one is typed per pass of the main loop)
        self._ab = 0
        self._acc = 0
        self._raw = False
        self._raw_t = 0
        self._down = False        # debounced button state
        self._swallow = False     # ignore this press (it only woke the screen)

    # ------------------------------------------------------------ helpers
    def _asleep(self):
        return self.ui is not None and self.ui.asleep

    def _wake(self):
        if self.ui is not None:
            self.ui.wake()

    def _layer(self, kb):
        layer = kb.active_layers[0]
        return layer if 0 <= layer < len(self.actions) else 0

    # ------------------------------------------------------------ turning
    def _turn(self, kb, d):
        if self._reverse:
            d = -d
        if self._asleep():
            self._wake()
            return
        self._wake()
        kb.tap_key(self.actions[self._layer(kb)][1 if d > 0 else 0])

    def _poll_counter(self, kb):
        # The hardware counter has kept count while the main loop was busy (redrawing the screen, lighting the keys, clearing
        # memory): turns are never missed, only typed a little later. KMK sends a tap's press and release within one pass of
        # its loop, so one click is typed per pass; two in one pass would merge into a single key press.
        pos = self._enc.position
        if pos != self._last:
            n = self._backlog + pos - self._last
            self._last = pos
            self._backlog = max(-_MAX_BACKLOG, min(_MAX_BACKLOG, n))
        if self._backlog:
            d = 1 if self._backlog > 0 else -1
            self._backlog -= d
            self._turn(kb, d)

    def _poll_turn(self, kb):
        new = (self._a.value << 1) | self._b.value
        if new == (self._ab & 3):
            return
        self._ab = ((self._ab << 2) | new) & 0xF
        self._acc += _TABLE[self._ab]
        if self._acc >= self._div:
            self._acc = 0
            self._turn(kb, 1)
        elif self._acc <= -self._div:
            self._acc = 0
            self._turn(kb, -1)

    # ------------------------------------------------------------ button
    def _press_down(self, kb):
        if self.press_hook is not None and self.press_hook():
            self._swallow = True    # this press answered the prompt: it is not typed
            return
        if self._asleep():
            self._wake()
            self._swallow = True            # this press only wakes the screen
            return
        self._wake()
        self._swallow = False
        kb.tap_key(self.actions[self._layer(kb)][2])

    def _poll_button(self, kb, now=None):
        raw = not self._sw.value            # pulled up, pressed = low
        if raw != self._raw:
            self._raw = raw
            self._raw_t = time.monotonic() if now is None else now
        elif raw != self._down and (time.monotonic() if now is None else now) - self._raw_t >= self._debounce:
            self._down = raw
            if raw:
                self._press_down(kb)

    # ------------------------------------------------------------ KMK hooks
    def during_bootup(self, keyboard):
        try:
            # Turning is counted by the chip itself when it can (pins A and B next to each other, a PIO block free). If
            # not, the old way is kept: look at the two contacts on every pass of the main loop.
            if rotaryio is not None:
                try:
                    self._enc = rotaryio.IncrementalEncoder(self._pins[0], self._pins[1], divisor=self._div)
                    self._last = self._enc.position
                except Exception as e:
                    self._enc = None
                    print("encoder_modes: no hardware counter, polling:", e)
            pins = []
            for p in (self._pins[2:] if self._enc is not None else self._pins):
                d = digitalio.DigitalInOut(p)
                d.direction = digitalio.Direction.INPUT
                d.pull = digitalio.Pull.UP
                pins.append(d)
            if self._enc is not None:
                self._sw = pins[0]
            else:
                self._a, self._b, self._sw = pins
                self._ab = (self._a.value << 1) | self._b.value
            self.enabled = True
            print("encoder_modes ready" + (" (hardware counter)" if self._enc is not None else ""))
        except Exception as e:
            print("encoder_modes error in setup:", e)

    def before_matrix_scan(self, keyboard):
        if not self.enabled:
            return None
        try:
            if self._enc is not None:
                self._poll_counter(keyboard)
            else:
                self._poll_turn(keyboard)
            self._poll_button(keyboard)     # the time is only read when the button changes: no decimal number per scan
        except Exception as e:
            print("encoder_modes error:", e)
            self.enabled = False
        return None

    def process_key(self, keyboard, key, is_pressed, int_coord):
        return key

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
