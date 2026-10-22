# SPDX-License-Identifier: GPL-3.0-only
# The customer knob (encoder_modes.py) has no key test hooks: it types what the profile says, always.
# The development version with muting and knob events is tested in test_dev_tools.py.
#
#     python -m unittest discover -s Programs/tests -v

import os
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

# fake CircuitPython / KMK modules, only where the other firmware tests have not already made them
for name in ("digitalio", "kmk", "kmk.modules"):
    sys.modules.setdefault(name, types.ModuleType(name))
if not hasattr(sys.modules["kmk.modules"], "Module"):
    sys.modules["kmk.modules"].Module = type("Module", (), {})

import encoder_modes  # noqa: E402


class FakeKeyboard:
    def __init__(self):
        self.active_layers = [0]
        self.tapped = []

    def tap_key(self, key):
        self.tapped.append(key)


class CustomerKnobTests(unittest.TestCase):
    def make(self):
        # per layer: (turn left, turn right, press)
        return encoder_modes.EncoderModes(None, None, None, actions=[("LEFT", "RIGHT", "PRESS")])

    def test_turns_and_presses_type_what_the_profile_says(self):
        knob, kb = self.make(), FakeKeyboard()
        knob._turn(kb, 1)
        knob._turn(kb, -1)
        knob._press_down(kb)
        self.assertEqual(kb.tapped, ["RIGHT", "LEFT", "PRESS"])

    def test_it_has_no_test_hooks(self):
        knob = self.make()
        for name in ("mute", "report", "apps", "_muted", "_report"):
            self.assertFalse(hasattr(knob, name), name)


if __name__ == "__main__":
    unittest.main()
