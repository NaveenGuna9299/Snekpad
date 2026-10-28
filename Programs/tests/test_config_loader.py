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
import unittest.mock

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


class EffectTests(unittest.TestCase):
    def test_a_config_without_an_effect_is_static(self):
        self.assertEqual(config_loader.effect(config()), "static")

    def test_every_effect_is_accepted(self):
        for name in config_loader.EFFECTS:
            self.assertEqual(config_loader.effect(config({"brightness": 0.4, "effect": name})), name)

    def test_the_names_match_the_ones_rgb_keys_draws(self):
        self.assertEqual(config_loader.EFFECTS, ("static", "rainbow", "ripple", "starry", "equalizer", "beat"))

    def test_the_two_effects_taken_out_mean_static_so_an_old_config_still_loads(self):
        for old in config_loader.RETIRED_EFFECTS:
            cfg = config({"brightness": 0.4, "effect": old, "breathingColor": "#112233"})
            self.assertEqual(config_loader.effect(cfg), "static")
            config_loader.check(cfg)                            # not refused: the pad keeps its profiles

    def test_an_unknown_effect_is_refused(self):
        for bad in ("disco", "", None, 3, True):
            with self.assertRaises(ValueError):
                config_loader.effect(config({"brightness": 0.4, "effect": bad}))

    def test_check_refuses_an_unknown_effect_so_a_bad_push_is_not_saved(self):
        with self.assertRaises(ValueError):
            config_loader.check(config({"brightness": 0.4, "effect": "disco"}))
        config_loader.check(config({"brightness": 0.4, "effect": "ripple"}))


class CodePyEffectTests(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(HERE, "..", "code.py"), encoding="utf-8") as f:
            self.code = f.read()

    def test_it_reads_the_effect_and_survives_a_bad_one(self):
        self.assertIn("config_loader.effect(CFG)", self.code)
        self.assertIn("config effect ignored", self.code)
        self.assertIn("effect=LED_EFFECT", self.code)

    def test_the_live_view_reports_the_effect(self):
        self.assertIn('"e": leds.effect', self.code)

    def test_there_is_no_breathing_colour_any_more(self):
        self.assertNotIn("breath", self.code)


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

    def test_a_brightness_set_with_the_keys_wins_over_the_apps_and_a_push_keeps_it(self):
        self.assertIn("_cl.saved_level(len(LEVELS))", self.code)
        self.assertIn("RGB_START_LEVEL = _saved", self.code)
        self.assertIn("on_level=LEVEL_SAVER", self.code)
        self.assertIn("saved brightness ignored", self.code)           # a failure falls back to the app's value
        with open(os.path.join(HERE, "..", "app_profiles.py"), encoding="utf8") as f:
            profiles = f.read()
        self.assertNotIn("forget_level", profiles)                      # a pushed config leaves it alone

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


class FakeNvm:
    """microcontroller.nvm: a byte array that starts erased (0xFF) like new flash."""

    def __init__(self):
        self.data = bytearray([0xFF] * 8)
        self.writes = 0

    def __getitem__(self, i):
        return self.data[i]

    def __setitem__(self, i, v):
        self.writes += 1
        self.data[i] = v


class SavedBrightnessTests(unittest.TestCase):
    def setUp(self):
        self.nvm = FakeNvm()
        fake = types.ModuleType("microcontroller")
        fake.nvm = self.nvm
        patch = unittest.mock.patch.dict(sys.modules, {"microcontroller": fake})
        patch.start()
        self.addCleanup(patch.stop)

    def test_a_pad_that_was_never_set_has_no_saved_step(self):
        self.assertIsNone(config_loader.saved_level(5))      # erased flash: 0xFF
        self.nvm.data[3] = 0
        self.assertIsNone(config_loader.saved_level(5))

    def test_a_saved_step_comes_back_after_a_power_off(self):
        for step in range(5):
            config_loader.save_level(step)
            self.assertEqual(config_loader.saved_level(5), step)

    def test_the_other_bytes_are_never_touched(self):
        before = bytes(self.nvm.data)
        config_loader.save_level(2)
        self.assertEqual(bytes(self.nvm.data[:3]), before[:3])     # the stub's and fw_boot's bytes
        self.assertEqual(bytes(self.nvm.data[4:]), before[4:])

    def test_a_step_outside_the_list_is_ignored(self):
        config_loader.save_level(4)
        self.assertIsNone(config_loader.saved_level(3))      # fewer steps than the one saved

    def test_the_same_step_is_not_written_again(self):
        config_loader.save_level(3)
        writes = self.nvm.writes
        config_loader.save_level(3)
        self.assertEqual(self.nvm.writes, writes)           # flash wears with every write

    def test_a_pad_without_nvm_just_works(self):
        with unittest.mock.patch.dict(sys.modules, {"microcontroller": types.ModuleType("microcontroller")}):
            self.assertIsNone(config_loader.saved_level(5))
            config_loader.save_level(2)                      # prints, never raises


class SavedLedStateTests(unittest.TestCase):
    """The LED toggle key (hold FN) is remembered across a push, which restarts the pad, and across a power-off."""

    def setUp(self):
        self.nvm = FakeNvm()
        fake = types.ModuleType("microcontroller")
        fake.nvm = self.nvm
        patch = unittest.mock.patch.dict(sys.modules, {"microcontroller": fake})
        patch.start()
        self.addCleanup(patch.stop)

    def test_a_pad_that_never_used_the_key_has_no_saved_state(self):
        self.assertIsNone(config_loader.saved_leds_on())        # erased flash: 0xFF
        self.nvm.data[4] = 0
        self.assertIsNone(config_loader.saved_leds_on())

    def test_off_and_on_come_back(self):
        config_loader.save_leds_on(False)
        self.assertIs(config_loader.saved_leds_on(), False)
        config_loader.save_leds_on(True)
        self.assertIs(config_loader.saved_leds_on(), True)

    def test_it_uses_its_own_byte_and_touches_no_other(self):
        before = bytes(self.nvm.data)
        config_loader.save_leds_on(False)
        after = bytes(self.nvm.data)
        self.assertEqual([i for i in range(len(before)) if before[i] != after[i]], [4])
        config_loader.save_level(2)                             # the brightness byte is separate
        self.assertIs(config_loader.saved_leds_on(), False)
        self.assertEqual(config_loader.saved_level(5), 2)

    def test_the_same_state_is_not_written_again(self):
        config_loader.save_leds_on(False)
        writes = self.nvm.writes
        config_loader.save_leds_on(False)
        self.assertEqual(self.nvm.writes, writes)

    def test_a_pad_without_nvm_just_works(self):
        with unittest.mock.patch.dict(sys.modules, {"microcontroller": types.ModuleType("microcontroller")}):
            self.assertIsNone(config_loader.saved_leds_on())
            config_loader.save_leds_on(False)                    # prints, never raises

    def test_code_py_starts_the_leds_in_the_saved_state_and_hands_them_the_saver(self):
        with open(os.path.join(HERE, "..", "code.py"), encoding="utf8") as f:
            code = f.read()
        self.assertIn("LEDS_ON = _cl.saved_leds_on() is not False", code)
        self.assertIn("on=LEDS_ON, on_toggle=LEDS_SAVER", code)


if __name__ == "__main__":
    unittest.main()
