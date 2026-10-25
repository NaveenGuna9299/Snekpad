# SPDX-License-Identifier: GPL-3.0-only
# The knob (encoder_modes.py) counts turns with the RP2040's hardware counter (rotaryio), so a turn is not missed when the main
# loop is busy. These tests run it with fake rotaryio / digitalio modules: the counter keeps counting while "the loop is busy"
# (the position changes between scans) and every click must still be typed, one per pass, in order.
#
#     python -m unittest discover -s Programs/tests -v

import os
import sys
import types
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

for name in ("digitalio", "kmk", "kmk.modules"):
    sys.modules.setdefault(name, types.ModuleType(name))
if not hasattr(sys.modules["kmk.modules"], "Module"):
    sys.modules["kmk.modules"].Module = type("Module", (), {})

IO = {}     # pin -> the fake pin object the knob made for it


class FakeIO:
    def __init__(self, pin):
        self.pin = pin
        self.value = True       # pulled up: not pressed / contact open
        self.direction = None
        self.pull = None
        IO[pin] = self


digitalio = sys.modules["digitalio"]
digitalio.DigitalInOut = FakeIO
digitalio.Direction = types.SimpleNamespace(INPUT="in")
digitalio.Pull = types.SimpleNamespace(UP="up")

import encoder_modes  # noqa: E402


class FakeCounter:
    """rotaryio.IncrementalEncoder: `position` goes up one per click clockwise, down one per click the other way."""

    made = []

    def __init__(self, pin_a, pin_b, divisor=4):
        self.pins = (pin_a, pin_b)
        self.divisor = divisor
        self.position = 0
        FakeCounter.made.append(self)


class FakeKeyboard:
    def __init__(self):
        self.active_layers = [0]
        self.tapped = []

    def tap_key(self, key):
        self.tapped.append(key)


class FakeUi:
    def __init__(self, asleep=False):
        self.asleep = asleep
        self.woken = 0

    def wake(self):
        self.woken += 1
        self.asleep = False


def make(reverse=False, counter=True):
    IO.clear()
    FakeCounter.made = []
    knob = encoder_modes.EncoderModes("A", "B", "SW", actions=[("LEFT", "RIGHT", "PRESS")], reverse=reverse)
    kb = FakeKeyboard()
    with mock.patch.object(encoder_modes, "rotaryio", types.SimpleNamespace(IncrementalEncoder=FakeCounter) if counter else None):
        knob.during_bootup(kb)
    return knob, kb


def scan(knob, kb, n=1):
    for _ in range(n):
        knob.before_matrix_scan(kb)


class HardwareCounter(unittest.TestCase):
    def test_it_asks_the_chip_to_count_on_the_two_contact_pins_with_the_divisor(self):
        knob, _ = make()
        self.assertEqual(len(FakeCounter.made), 1)
        self.assertEqual(FakeCounter.made[0].pins, ("A", "B"))
        self.assertEqual(FakeCounter.made[0].divisor, 4)
        self.assertTrue(knob.enabled)

    def test_only_the_button_pin_is_read_by_hand(self):
        make()
        self.assertEqual(list(IO), ["SW"])

    def test_a_click_right_and_a_click_left_type_what_the_profile_says(self):
        knob, kb = make()
        FakeCounter.made[0].position = 1
        scan(knob, kb)
        FakeCounter.made[0].position = 0
        scan(knob, kb)
        self.assertEqual(kb.tapped, ["RIGHT", "LEFT"])

    def test_nothing_is_typed_while_the_knob_is_still(self):
        knob, kb = make()
        scan(knob, kb, 50)
        self.assertEqual(kb.tapped, [])

    def test_clicks_counted_while_the_loop_was_busy_are_all_typed_one_per_pass(self):
        knob, kb = make()
        FakeCounter.made[0].position = 4        # four clicks happened between two passes
        scan(knob, kb)
        self.assertEqual(kb.tapped, ["RIGHT"])   # one tap per pass, never two in one (they would merge into one key press)
        scan(knob, kb, 3)
        self.assertEqual(kb.tapped, ["RIGHT"] * 4)
        scan(knob, kb, 5)
        self.assertEqual(kb.tapped, ["RIGHT"] * 4)

    def test_more_turning_while_the_clicks_are_still_being_typed_adds_to_them(self):
        knob, kb = make()
        FakeCounter.made[0].position = 3
        scan(knob, kb)                          # 1 typed, 2 waiting
        FakeCounter.made[0].position = 5        # two more clicks meanwhile
        scan(knob, kb, 10)
        self.assertEqual(kb.tapped, ["RIGHT"] * 5)

    def test_turning_back_while_clicks_wait_cancels_them(self):
        knob, kb = make()
        FakeCounter.made[0].position = 3
        scan(knob, kb)                          # 1 typed, 2 waiting
        FakeCounter.made[0].position = 0        # turned back three clicks: net, the knob is where it started... 2 waiting - 3
        scan(knob, kb, 10)
        self.assertEqual(kb.tapped, ["RIGHT", "LEFT"])    # the one that was typed, then one left to bring it back

    def test_the_position_can_be_any_number_and_negative(self):
        knob, kb = make()
        FakeCounter.made[0].position = -2
        scan(knob, kb, 4)
        self.assertEqual(kb.tapped, ["LEFT", "LEFT"])

    def test_a_pad_that_starts_with_the_knob_off_its_zero_does_not_type_anything(self):
        IO.clear()
        FakeCounter.made = []
        counter = FakeCounter("A", "B")
        counter.position = 37
        knob = encoder_modes.EncoderModes("A", "B", "SW", actions=[("LEFT", "RIGHT", "PRESS")])
        kb = FakeKeyboard()
        with mock.patch.object(encoder_modes, "rotaryio", types.SimpleNamespace(IncrementalEncoder=lambda *a, **k: counter)):
            knob.during_bootup(kb)
        scan(knob, kb, 5)
        self.assertEqual(kb.tapped, [])

    def test_a_long_stall_never_types_a_long_burst(self):
        knob, kb = make()
        FakeCounter.made[0].position = 500
        scan(knob, kb, 100)
        self.assertEqual(kb.tapped, ["RIGHT"] * encoder_modes._MAX_BACKLOG)

    def test_reverse_swaps_the_directions(self):
        knob, kb = make(reverse=True)
        FakeCounter.made[0].position = 1
        scan(knob, kb)
        FakeCounter.made[0].position = 0
        scan(knob, kb)
        self.assertEqual(kb.tapped, ["LEFT", "RIGHT"])

    def test_the_layer_of_the_moment_decides_what_a_click_types(self):
        IO.clear()
        FakeCounter.made = []
        knob = encoder_modes.EncoderModes("A", "B", "SW", actions=[("L0", "R0", "P0"), ("L1", "R1", "P1")])
        kb = FakeKeyboard()
        with mock.patch.object(encoder_modes, "rotaryio", types.SimpleNamespace(IncrementalEncoder=FakeCounter)):
            knob.during_bootup(kb)
        kb.active_layers = [1]
        FakeCounter.made[0].position = 1
        scan(knob, kb)
        self.assertEqual(kb.tapped, ["R1"])

    def test_the_first_click_of_a_sleeping_pad_only_wakes_the_screen(self):
        knob, kb = make()
        knob.ui = FakeUi(asleep=True)
        FakeCounter.made[0].position = 3
        scan(knob, kb, 3)
        self.assertEqual(kb.tapped, ["RIGHT", "RIGHT"])      # the first click woke the screen, the other two typed
        self.assertGreaterEqual(knob.ui.woken, 1)

    def test_a_hardware_error_switches_the_knob_off_without_touching_the_keys(self):
        knob, kb = make()

        class Broken:
            @property
            def position(self):
                raise RuntimeError("PIO gone")

        knob._enc = Broken()
        with mock.patch("builtins.print"):
            scan(knob, kb)
        self.assertFalse(knob.enabled)
        scan(knob, kb)      # and nothing breaks afterwards
        self.assertEqual(kb.tapped, [])

    def test_the_button_still_works(self):
        knob, kb = make()
        t = [100.0]
        with mock.patch.object(encoder_modes.time, "monotonic", lambda: t[0]):
            IO["SW"].value = False       # pressed
            scan(knob, kb)
            t[0] += 0.05
            scan(knob, kb)
            self.assertEqual(kb.tapped, ["PRESS"])
            IO["SW"].value = True
            t[0] += 0.05
            scan(knob, kb, 2)
            t[0] += 0.05
            scan(knob, kb)
        self.assertEqual(kb.tapped, ["PRESS"])


class WithoutTheCounter(unittest.TestCase):
    """No rotaryio, or the chip refuses: the knob is read by looking at the two contacts, as it always was."""

    def test_it_looks_at_all_three_pins_itself(self):
        knob, _ = make(counter=False)
        self.assertEqual(sorted(IO), ["A", "B", "SW"])
        self.assertTrue(knob.enabled)

    def test_it_falls_back_when_the_chip_cannot_count(self):
        IO.clear()

        def refuse(*a, **k):
            raise ValueError("pin_b must be next to pin_a")

        knob = encoder_modes.EncoderModes("A", "B", "SW", actions=[("LEFT", "RIGHT", "PRESS")])
        with mock.patch.object(encoder_modes, "rotaryio", types.SimpleNamespace(IncrementalEncoder=refuse)):
            with mock.patch("builtins.print") as shown:
                knob.during_bootup(FakeKeyboard())
        self.assertEqual(sorted(IO), ["A", "B", "SW"])
        self.assertTrue(knob.enabled)
        self.assertIn("polling", " ".join(str(c.args[0]) for c in shown.call_args_list))

    def test_one_full_turn_of_the_contacts_types_one_click_each_way(self):
        knob, kb = make(counter=False)
        a, b = IO["A"], IO["B"]

        def step(av, bv):
            a.value, b.value = av, bv
            scan(knob, kb)

        # both contacts open at rest. One way round: A closes first, then B, then A opens, then B opens ...
        for av, bv in ((False, True), (False, False), (True, False), (True, True)):
            step(av, bv)
        self.assertEqual(kb.tapped, ["RIGHT"])
        # ... the other way round: B closes first
        for av, bv in ((True, False), (False, False), (False, True), (True, True)):
            step(av, bv)
        self.assertEqual(kb.tapped, ["RIGHT", "LEFT"])


if __name__ == "__main__":
    unittest.main()
