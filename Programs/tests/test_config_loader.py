# SPDX-License-Identifier: GPL-3.0-only
# config_loader.py: the sleep time setting (settings.sleepMinutes) that SnekPad Studio sends, and how code.py
# turns it into the screen's dim / off times.
#
#     python -m unittest discover -s Programs/tests -v

import copy
import os
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

# fake KMK modules, only where the other firmware tests have not already made them
for name in ("kmk", "kmk.modules", "kmk.keys", "kmk.modules.macros"):
    sys.modules.setdefault(name, types.ModuleType(name))
if not hasattr(sys.modules["kmk.keys"], "KC"):
    sys.modules["kmk.keys"].KC = object()
for attr in ("Delay", "Press", "Release", "Tap"):
    if not hasattr(sys.modules["kmk.modules.macros"], attr):
        setattr(sys.modules["kmk.modules.macros"], attr, object)

# The firmware tests in test_app_profiles_events.py put a fake "config_loader" into sys.modules, so load the
# real file by path under its own name.
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("real_config_loader", os.path.join(HERE, "..", "config_loader.py"))
config_loader = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(config_loader)

PROFILE = {
    "id": "general",
    "name": "General",
    "match": {"windows": [], "macos": [], "titles": []},
    "keys": [{} for _ in range(12)],
    "encoder": {"cw": {}, "ccw": {}, "press": {}},
}


def config(settings=None):
    return {
        "schema_version": 1,
        "device": {"owner_screen": {"line1": "", "line2": "", "date": ""}},
        "settings": {"brightness": 0.4} if settings is None else settings,
        "profiles": [copy.deepcopy(PROFILE)],
    }


class SleepMinutesTests(unittest.TestCase):
    def test_the_default_is_two_minutes_when_the_config_has_none(self):
        self.assertEqual(config_loader.DEFAULT_SLEEP_MINUTES, 2)
        self.assertEqual(config_loader.sleep_minutes(config()), 2)

    def test_the_apps_value_is_used(self):
        for minutes in (0, 1, 2, 5, 60):
            cfg = config({"brightness": 0.4, "sleepMinutes": minutes})
            self.assertEqual(config_loader.sleep_minutes(cfg), minutes)

    def test_values_outside_the_range_are_refused(self):
        for bad in (-1, 61, 1000):
            with self.assertRaises(ValueError):
                config_loader.sleep_minutes(config({"brightness": 0.4, "sleepMinutes": bad}))

    def test_values_that_are_not_whole_numbers_are_refused(self):
        for bad in (1.5, 2.0, "2", None, True, False, [2]):
            with self.assertRaises(ValueError, msg=repr(bad)):
                config_loader.sleep_minutes(config({"brightness": 0.4, "sleepMinutes": bad}))


class CheckTests(unittest.TestCase):
    def test_a_config_without_the_setting_is_still_accepted(self):
        config_loader.check(config())          # an older app, or a config saved before the setting existed

    def test_a_config_with_the_setting_is_accepted(self):
        config_loader.check(config({"brightness": 0.4, "sleepMinutes": 7}))

    def test_a_bad_value_refuses_the_whole_push(self):
        with self.assertRaises(ValueError):
            config_loader.check(config({"brightness": 0.4, "sleepMinutes": 99}))


class CodePyTests(unittest.TestCase):
    """code.py turns the setting into the screen's times; its source is checked, it cannot run without hardware."""

    def setUp(self):
        with open(os.path.join(HERE, "..", "code.py"), encoding="utf-8") as f:
            self.code = f.read()

    def test_the_default_there_matches_the_loader(self):
        self.assertIn("SLEEP_MINUTES = %d " % config_loader.DEFAULT_SLEEP_MINUTES, self.code)

    def test_it_reads_the_apps_setting_and_survives_a_bad_one(self):
        self.assertIn("SLEEP_MINUTES = config_loader.sleep_minutes(CFG)", self.code)
        self.assertIn("config sleepMinutes ignored", self.code)

    def test_the_screen_gets_both_times_and_zero_means_never(self):
        self.assertIn("OLED_OFF_S = SLEEP_MINUTES * 60 if SLEEP_MINUTES else", self.code)
        self.assertIn("OLED_DIM_S = OLED_OFF_S // 2", self.code)
        self.assertIn("dim_s=OLED_DIM_S", self.code)
        self.assertIn("off_s=OLED_OFF_S", self.code)

    def test_the_live_view_reports_the_sleep_time_in_use(self):
        # GET_CFG: Studio reads it when the pad connects, so the app shows what the pad really uses
        self.assertIn('"s": SLEEP_MINUTES', self.code)

    def test_the_times_work_out_as_documented(self):
        def times(minutes):
            off = minutes * 60 if minutes else 1000000000
            return off // 2, off

        self.assertEqual(times(2), (60, 120))      # the default: dim after 1 minute, off after 2
        self.assertEqual(times(1), (30, 60))
        self.assertEqual(times(60), (1800, 3600))
        dim, off = times(0)
        self.assertGreater(dim, 10 * 365 * 24 * 3600)   # never, in practice
        self.assertGreater(off, dim)


if __name__ == "__main__":
    unittest.main()
