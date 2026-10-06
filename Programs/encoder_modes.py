# encoder_modes.py - rotary encoder with four modes, as a KMK module.
# Copy this file to the root of CIRCUITPY (next to code.py).
# Replaces KMK's EncoderHandler, which can't tell a short press from a long one.
#
#   1. Idle      the OLED is showing the owner/logo screen. The first turn or press
#                only wakes the screen and does nothing else.
#   2. Default   turning runs the profile's knob action (volume, tab, scroll...).
#   3. Short     press and release under hold_s: runs the profile's press action.
#   4. Profile   hold the knob for hold_s. Turn to pick a profile, short press to
#      switcher  confirm, hold again to cancel. It also cancels after
#                switch_timeout_s with no input.
#
# While the knob is held the OLED shows what will happen, a progress bar and a
# countdown. This module only publishes the numbers (held, progress, left_text,
# right_text, mode, sel, switch_left); oled_ui.py draws them.
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
        actions,             # actions[layer] = (turn left, turn right, short press) as KC keys
        press_labels,        # press_labels[layer] = short text for the press action
        n_profiles,          # how many layers the switcher lists (the utility layer is not one)
        reverse=False,       # True if the knob turns the wrong way
        divisor=4,           # raw pulses per click
        hold_s=0.5,          # hold time for the profile switcher
        switch_timeout_s=5.0,
        debounce_s=0.02,
    ):
        self._pins = (pin_a, pin_b, pin_sw)
        self.actions = actions
        self.press_labels = press_labels
        self.n = n_profiles
        self._reverse = reverse
        self._div = divisor
        self.hold_s = hold_s
        self._timeout = switch_timeout_s
        self._debounce = debounce_s

        self.ui = None            # set to the OledUI after it is created (wake / asleep)
        self.enabled = False

        # published for the OLED
        self.mode = "default"     # "default" or "switch"
        self.held = False         # knob is down and its release will still do something
        self.progress = 0.0       # 0.0 - 1.0 towards the hold threshold
        self.left_text = ""
        self.right_text = ""
        self.sel = 0              # highlighted profile in the switcher
        self.switch_left = 0      # whole seconds until the switcher cancels itself

        self._a = self._b = self._sw = None
        self._ab = 0
        self._acc = 0
        self._raw = False
        self._raw_t = 0
        self._down = False        # debounced button state
        self._t_down = 0
        self._fired = False       # the hold action already happened for this press
        self._swallow = False     # ignore this press's release (it only woke the screen)
        self._act = 0             # last switcher activity

    # ------------------------------------------------------------ helpers
    def _asleep(self):
        return self.ui is not None and self.ui.asleep

    def _wake(self):
        if self.ui is not None:
            self.ui.wake()

    def _layer(self, kb):
        layer = kb.active_layers[0]
        return layer if 0 <= layer < len(self.actions) else 0

    def _enter_switch(self, kb, now):
        base = kb.active_layers[-1]
        self.sel = base if 0 <= base < self.n else 0
        self.mode = "switch"
        self._act = now

    def _leave_switch(self):
        self.mode = "default"

    # ------------------------------------------------------------ turning
    def _turn(self, kb, now, d):
        if self._reverse:
            d = -d
        if self._asleep():
            self._wake()
            return
        self._wake()
        if self.held:                       # turning while held cancels the press
            self.held = False
            self._swallow = True
        if self.mode == "switch":
            self.sel = (self.sel + d) % self.n
            self._act = now
        else:
            kb.tap_key(self.actions[self._layer(kb)][1 if d > 0 else 0])

    def _poll_turn(self, kb, now):
        new = (self._a.value << 1) | self._b.value
        if new == (self._ab & 3):
            return
        self._ab = ((self._ab << 2) | new) & 0xF
        self._acc += _TABLE[self._ab]
        if self._acc >= self._div:
            self._acc = 0
            self._turn(kb, now, 1)
        elif self._acc <= -self._div:
            self._acc = 0
            self._turn(kb, now, -1)

    # ------------------------------------------------------------ button
    def _press_down(self, kb, now):
        if self._asleep():
            self._wake()
            self._swallow = True            # this press only wakes the screen
            return
        self._wake()
        self.held = True
        self._fired = False
        self._t_down = now
        self._act = now
        self.progress = 0.0

    def _press_up(self, kb, now):
        if self._swallow:
            self._swallow = False
            return
        was_held = self.held
        self.held = False
        self._act = now
        if not was_held or self._fired:
            return
        if self.mode == "switch":
            kb.active_layers[-1] = self.sel     # AppProfiles sees this as a manual choice
            self._leave_switch()
        else:
            kb.tap_key(self.actions[self._layer(kb)][2])

    def _poll_button(self, kb, now):
        raw = not self._sw.value            # pulled up, pressed = low
        if raw != self._raw:
            self._raw = raw
            self._raw_t = now
        elif raw != self._down and now - self._raw_t >= self._debounce:
            self._down = raw
            if raw:
                self._press_down(kb, now)
            else:
                self._press_up(kb, now)

    # ------------------------------------------------------------ hold / timeout
    def _tick(self, kb, now):
        if self.held and not self._fired:
            el = now - self._t_down
            switching = self.mode == "switch"
            if el >= self.hold_s:
                self._fired = True
                self.progress = 1.0
                self.right_text = "RELEASE"
                if switching:
                    self._leave_switch()
                    self.left_text = "CANCEL"
                else:
                    self._enter_switch(kb, now)
                    self.left_text = "SWITCHER"
            else:
                self.progress = el / self.hold_s
                left = self.hold_s - el
                if switching:
                    self.left_text = "REL:SELECT"
                    self.right_text = "CANCEL %.1fs" % left
                else:
                    lbl = self.press_labels[self._layer(kb)]
                    self.left_text = ("REL:" + lbl)[:9]
                    self.right_text = "SWITCH %.1fs" % left
        if self.mode == "switch":
            if not self.held and now - self._act >= self._timeout:
                self._leave_switch()
            else:
                self.switch_left = max(0, int(self._timeout - (now - self._act) + 0.999))

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
            self._poll_turn(keyboard, now)
            self._poll_button(keyboard, now)
            self._tick(keyboard, now)
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
