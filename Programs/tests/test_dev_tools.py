# SPDX-License-Identifier: GPL-3.0-only
# The development-only key test tools (Programs/dev/dev_tools.py): the TEST command, knob events and the
# "dev" flag in HELLO. A customer pad does not have this file (see test_app_profiles_events.py).
#
#     python -m unittest discover -s Programs/tests -v

import os
import sys
import types
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "dev"))

# reuses the fake CircuitPython / KMK modules and the fake serial port from the firmware tests
import test_app_profiles_events as base  # noqa: E402,F401
from test_app_profiles_events import Keyboard, SERIAL, app_profiles, feed, say_hello, scan, sent  # noqa: E402

# the knob module also needs digitalio
sys.modules.setdefault("digitalio", types.ModuleType("digitalio"))

import dev_tools  # noqa: E402

KEY = object()      # stands in for a KMK key


def make_dev_pad():
    SERIAL.incoming = b""
    SERIAL.out = b""
    SERIAL.connected = True
    SERIAL.out_waiting = 0
    pad = dev_tools.DevAppProfiles([("General", [], []), ("Code", ["code"], []), ("Term", ["wt"], [])])
    kb = Keyboard()
    pad.during_bootup(kb)
    return pad, kb


class FakeKeyboard:
    def __init__(self):
        self.active_layers = [0]
        self.tapped = []

    def tap_key(self, key):
        self.tapped.append(key)


class SplitTests(unittest.TestCase):
    """The customer firmware must not depend on, or even mention, the development tools."""

    PROGRAMS = os.path.join(HERE, "..")

    def read(self, name):
        with open(os.path.join(self.PROGRAMS, name), encoding="utf-8") as f:
            return f.read()

    def test_production_modules_never_import_the_dev_tools(self):
        for name in ("app_profiles.py", "encoder_modes.py", "config_loader.py", "rgb_keys.py", "oled_ui.py", "boot.py"):
            self.assertNotIn("dev_tools", self.read(name), name)

    def test_code_py_only_probes_for_the_dev_tools(self):
        code = self.read("code.py")
        self.assertIn("try:\n    import dev_tools\nexcept ImportError:\n    dev_tools = None", code)
        self.assertEqual(code.count("import dev_tools"), 1)

    def test_the_default_build_does_not_include_the_dev_tools(self):
        build = self.read("build_mpy.py")
        modules = [l for l in build.splitlines() if l.startswith("MODULES")][0]
        self.assertNotIn("dev_tools", modules)
        self.assertIn("if args.dev:", build)

    def test_the_dev_file_lives_outside_the_production_folder(self):
        self.assertTrue(os.path.exists(os.path.join(self.PROGRAMS, "dev", "dev_tools.py")))
        self.assertFalse(os.path.exists(os.path.join(self.PROGRAMS, "dev_tools.py")))


class DevHelloTests(unittest.TestCase):
    def test_hello_says_this_is_a_dev_pad(self):
        pad, kb = make_dev_pad()
        feed(pad, kb, "HELLO\n")
        self.assertEqual(sent().split("\n")[0], "HELLO\t2\t%s\tdev" % app_profiles.FIRMWARE_VERSION)

    def test_the_normal_behaviour_is_unchanged(self):
        pad, kb = make_dev_pad()
        say_hello(pad, kb)
        feed(pad, kb, "APP\tCode.exe\tmain.py\n")
        scan(pad, kb)
        self.assertEqual(kb.active_layers[-1], 1)
        self.assertIs(pad.process_key(kb, KEY, True, 3), KEY)
        self.assertIs(pad.process_key(kb, KEY, False, 3), KEY)


class TestModeTests(unittest.TestCase):
    """Test mode: the pad reports keys but types nothing, and only while the app keeps saying TEST."""

    def setUp(self):
        self.now = 1000.0
        self.patch = mock.patch.object(dev_tools.time, "monotonic", lambda: self.now)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def start(self):
        pad, kb = make_dev_pad()
        say_hello(pad, kb)
        return pad, kb

    def test_keys_are_typed_normally_without_test_mode(self):
        pad, kb = self.start()
        self.assertIs(pad.process_key(kb, KEY, True, 3), KEY)
        self.assertIs(pad.process_key(kb, KEY, False, 3), KEY)

    def test_test_mode_swallows_the_press_and_the_release(self):
        pad, kb = self.start()
        feed(pad, kb, "TEST\n")
        self.assertIsNone(pad.process_key(kb, KEY, True, 3))
        self.assertIsNone(pad.process_key(kb, KEY, False, 3))

    def test_test_mode_still_reports_every_key(self):
        pad, kb = self.start()
        feed(pad, kb, "TEST\n")
        pad.process_key(kb, KEY, True, 9)
        pad.process_key(kb, KEY, False, 9)
        scan(pad, kb)
        self.assertIn("EVT\tkey\t9\t1\n", sent())
        self.assertIn("EVT\tkey\t9\t0\n", sent())

    def test_test_mode_needs_no_hello_to_stop_typing(self):
        pad, kb = make_dev_pad()        # an app that sends TEST without HELLO
        feed(pad, kb, "TEST\n")
        self.assertIsNone(pad.process_key(kb, KEY, True, 0))

    def test_test_mode_ends_by_itself_when_the_app_goes_quiet(self):
        pad, kb = self.start()
        feed(pad, kb, "TEST\n")
        self.assertTrue(pad.test_active())
        self.now += dev_tools.TEST_HOLD_S - 0.1
        self.assertTrue(pad.test_active())
        self.now += 0.2
        self.assertFalse(pad.test_active())
        self.assertIs(pad.process_key(kb, KEY, True, 3), KEY)
        self.assertIs(pad.process_key(kb, KEY, False, 3), KEY)

    def test_each_test_line_extends_test_mode(self):
        pad, kb = self.start()
        for _ in range(5):
            feed(pad, kb, "TEST\n")
            self.now += 1.0
        self.assertTrue(pad.test_active())

    def test_a_key_pressed_in_test_mode_is_not_released_if_test_mode_ends_while_held(self):
        pad, kb = self.start()
        feed(pad, kb, "TEST\n")
        self.assertIsNone(pad.process_key(kb, KEY, True, 3))
        self.now += 10                  # test mode over, the key is still down
        self.assertIsNone(pad.process_key(kb, KEY, False, 3))   # KMK never pressed it, so nothing to release
        self.assertIs(pad.process_key(kb, KEY, True, 3), KEY)   # and the next press types normally

    def test_a_key_pressed_before_test_mode_still_gets_its_release(self):
        pad, kb = self.start()
        self.assertIs(pad.process_key(kb, KEY, True, 3), KEY)
        feed(pad, kb, "TEST\n")
        self.assertIs(pad.process_key(kb, KEY, False, 3), KEY)  # else the key would stay down on the computer

    def test_held_key_count_still_works_in_test_mode(self):
        pad, kb = self.start()
        feed(pad, kb, "TEST\n")
        pad.process_key(kb, KEY, True, 3)
        self.assertEqual(pad._held, 1)
        pad.process_key(kb, KEY, False, 3)
        self.assertEqual(pad._held, 0)

    def test_test_sends_no_reply(self):
        pad, kb = self.start()
        feed(pad, kb, "TEST\n")
        self.assertEqual(sent(), "")

    def test_other_lines_still_reach_the_normal_handler(self):
        pad, kb = self.start()
        feed(pad, kb, "PING\n")
        self.assertEqual(sent(), "PONG\n")


class KnobEventTests(unittest.TestCase):
    def test_nothing_is_reported_before_hello(self):
        pad, kb = make_dev_pad()
        pad.report_knob("cw")
        scan(pad, kb, 2)
        self.assertEqual(sent(), "")

    def test_turns_and_presses_are_reported_after_hello(self):
        pad, kb = make_dev_pad()
        say_hello(pad, kb)
        for name in ("cw", "ccw", "press"):
            pad.report_knob(name)
        scan(pad, kb)
        self.assertEqual(sent(), "EVT\tknob\tcw\nEVT\tknob\tccw\nEVT\tknob\tpress\n")

    def test_a_fast_spin_cannot_flood_the_queue(self):
        pad, kb = make_dev_pad()
        say_hello(pad, kb)
        for _ in range(200):
            pad.report_knob("cw")
        self.assertLessEqual(len(pad._evq), app_profiles.EVENT_QUEUE_MAX)


class FakeApps:
    def __init__(self, muted=False):
        self.muted = muted
        self.reported = []

    def test_active(self):
        return self.muted

    def report_knob(self, name):
        self.reported.append(name)


def make_knob(reverse=False, apps=None):
    # per layer: (turn left, turn right, press)
    knob = dev_tools.DevEncoderModes(None, None, None, actions=[("LEFT", "RIGHT", "PRESS")], reverse=reverse)
    knob.apps = apps
    return knob


class DevEncoderTests(unittest.TestCase):
    def test_turns_and_presses_type_normally_and_are_reported(self):
        apps = FakeApps()
        knob, kb = make_knob(apps=apps), FakeKeyboard()
        knob._turn(kb, 1)
        knob._turn(kb, -1)
        knob._press_down(kb)
        self.assertEqual(kb.tapped, ["RIGHT", "LEFT", "PRESS"])
        self.assertEqual(apps.reported, ["cw", "ccw", "press"])

    def test_a_reversed_knob_reports_the_direction_it_acts_on(self):
        apps = FakeApps()
        knob, kb = make_knob(reverse=True, apps=apps), FakeKeyboard()
        knob._turn(kb, 1)
        self.assertEqual(apps.reported, ["ccw"])
        self.assertEqual(kb.tapped, ["LEFT"])

    def test_nothing_is_typed_while_muted_but_everything_is_reported(self):
        apps = FakeApps(muted=True)
        knob, kb = make_knob(apps=apps), FakeKeyboard()
        knob._turn(kb, 1)
        knob._turn(kb, -1)
        knob._press_down(kb)
        self.assertEqual(kb.tapped, [])
        self.assertEqual(apps.reported, ["cw", "ccw", "press"])

    def test_typing_comes_back_when_the_mute_ends(self):
        apps = FakeApps(muted=True)
        knob, kb = make_knob(apps=apps), FakeKeyboard()
        knob._turn(kb, 1)
        apps.muted = False
        knob._turn(kb, 1)
        self.assertEqual(kb.tapped, ["RIGHT"])

    def test_the_knob_works_without_the_app_module(self):
        knob, kb = make_knob(), FakeKeyboard()
        knob._turn(kb, 1)
        knob._press_down(kb)
        self.assertEqual(kb.tapped, ["RIGHT", "PRESS"])

    def test_a_failing_report_never_breaks_the_knob(self):
        class Broken(FakeApps):
            def report_knob(self, name):
                raise RuntimeError("boom")

        knob, kb = make_knob(apps=Broken()), FakeKeyboard()
        knob._turn(kb, 1)
        knob._turn(kb, 1)
        self.assertEqual(kb.tapped, ["RIGHT", "RIGHT"])
        self.assertIsNone(knob.apps)        # given up after the first failure


if __name__ == "__main__":
    unittest.main()
