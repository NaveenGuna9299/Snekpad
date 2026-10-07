# encoder_modes.py - rotary encoder with a push button, as a KMK module.
# Copy this file to the root of CIRCUITPY (next to code.py).
# Replaces KMK's EncoderHandler so the first touch can wake the OLED without doing anything.
#
#   1. Idle      the OLED is showing the owner/logo screen. The first turn or press
#                only wakes the screen and does nothing else.
#   2. Default   turning runs the profile's knob action (volume, tab, scroll...).
#   3. Press     pressing the knob runs the profile's press action.
#
# If anything in here fails, the error is printed and the knob goes dead;
# the keys keep working.

import time

import digitalio

from kmk.modules import Module

# quadrature transition table, index = (previous AB << 2) | new AB
_TABLE = (0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0)


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
        self.enabled = False

        self._a = self._b = self._sw = None
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
        if self._asleep():
            self._wake()
            self._swallow = True            # this press only wakes the screen
            return
        self._wake()
        self._swallow = False
        kb.tap_key(self.actions[self._layer(kb)][2])

    def _poll_button(self, kb, now):
        raw = not self._sw.value            # pulled up, pressed = low
        if raw != self._raw:
            self._raw = raw
            self._raw_t = now
        elif raw != self._down and now - self._raw_t >= self._debounce:
            self._down = raw
            if raw:
                self._press_down(kb)

    # ------------------------------------------------------------ KMK hooks
    def during_bootup(self, keyboard):
        try:
            pins = []
            for p in self._pins:
                d = digitalio.DigitalInOut(p)
                d.direction = digitalio.Direction.INPUT
                d.pull = digitalio.Pull.UP
                pins.append(d)
            self._a, self._b, self._sw = pins
            self._ab = (self._a.value << 1) | self._b.value
            self.enabled = True
            print("encoder_modes ready")
        except Exception as e:
            print("encoder_modes error in setup:", e)

    def before_matrix_scan(self, keyboard):
        if not self.enabled:
            return None
        try:
            now = time.monotonic()
            self._poll_turn(keyboard)
            self._poll_button(keyboard, now)
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
