# SPDX-License-Identifier: GPL-3.0-only
# The key LEDs (rgb_keys.py) follow the screen's dim / off steps, and flash the new profile's colour when the
# profile changes. Also the screen's idle_level() (oled_ui.py), which the LEDs follow.
#
#     python -m unittest discover -s Programs/tests -v

import os
import sys
import types
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

# fake CircuitPython / KMK modules, only where the other firmware tests have not already made them
for name in ("kmk", "kmk.modules", "kmk.keys", "neopixel", "busio", "displayio", "terminalio",
             "i2cdisplaybus", "adafruit_displayio_ssd1306", "adafruit_display_text"):
    sys.modules.setdefault(name, types.ModuleType(name))
if not hasattr(sys.modules["kmk.modules"], "Module"):
    sys.modules["kmk.modules"].Module = type("Module", (), {})
if not hasattr(sys.modules["kmk.keys"], "make_key"):
    sys.modules["kmk.keys"].make_key = lambda *args, **kwargs: None
if not hasattr(sys.modules["adafruit_display_text"], "label"):
    sys.modules["adafruit_display_text"].label = types.ModuleType("label")
sys.modules["neopixel"].GRB = "GRB"

import rgb_keys  # noqa: E402
import oled_ui  # noqa: E402

BLUE, RED, GREEN, DARK = 0x0000FF, 0xFF0000, 0x00FF00, 0


class FakeStrip:
    """Stands in for the NeoPixel strip: remembers what was last shown."""

    def __init__(self):
        self.px = [0] * 12
        self.brightness = 0
        self.shows = 0

    def __setitem__(self, i, v):
        self.px[i] = v

    def show(self):
        self.shows += 1


class FakeScreen:
    def __init__(self):
        self.level = 0

    def idle_level(self):
        return self.level


class FakeKeyboard:
    def __init__(self):
        self.active_layers = [0]


# profile 0: mostly blue, profile 1: mostly red, profile 2: all dark, then the utility layer (3)
COLORS = [
    [BLUE] * 8 + [GREEN] * 3 + [DARK],
    [RED] * 9 + [BLUE] * 2 + [DARK],
    [DARK] * 12,
    [GREEN] * 12,
]


class LedTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000.0
        self.patch = mock.patch.object(rgb_keys.time, "monotonic", lambda: self.now)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.leds = rgb_keys.RgbKeys(None, level=3)        # level 3 = 0.4
        self.leds.px = FakeStrip()
        self.leds.px.brightness = rgb_keys.LEVELS[3]
        self.leds.enabled = True
        self.leds.set_colors([list(row) for row in COLORS])
        self.leds.profile_layers = 3
        self.screen = FakeScreen()
        self.leds.ui = self.screen
        self.kb = FakeKeyboard()
        self.leds.layer = 0
        self.leds._paint()

    def tick(self, seconds=0.06):
        self.now += seconds
        self.leds.before_matrix_scan(self.kb)

    def shown(self):
        return self.leds.px.px

    # ------------------------------------------------------------ follows the screen
    def test_leds_stay_as_they_are_while_the_screen_is_in_use(self):
        self.tick()
        self.assertEqual(self.leds.px.brightness, rgb_keys.LEVELS[3])
        self.assertEqual(self.shown()[0], BLUE)

    def test_leds_drop_to_the_lowest_step_when_the_screen_dims(self):
        self.screen.level = 1
        self.tick()
        self.assertEqual(self.leds.px.brightness, rgb_keys.LEVELS[0])
        self.assertEqual(self.shown()[0], BLUE)           # still lit, just dim

    def test_leds_switch_off_when_the_screen_switches_off(self):
        self.screen.level = 2
        self.tick()
        self.assertEqual(self.shown(), [0] * 12)

    def test_leds_come_back_exactly_as_they_were(self):
        for level in (1, 2, 0):
            self.screen.level = level
            self.tick()
        self.assertEqual(self.leds.px.brightness, rgb_keys.LEVELS[3])
        self.assertEqual(self.shown()[0], BLUE)
        self.assertEqual(self.shown()[8], GREEN)

    def test_a_lower_brightness_setting_is_never_raised_by_dimming(self):
        self.leds._level = 0
        self.leds._apply_level()
        self.screen.level = 1
        self.tick()
        self.assertEqual(self.leds.px.brightness, rgb_keys.LEVELS[0])

    def test_the_brightness_keys_do_not_undo_the_dimming(self):
        self.screen.level = 1
        self.tick()
        self.leds._brighter()
        self.assertEqual(self.leds.px.brightness, rgb_keys.LEVELS[0])
        self.screen.level = 0
        self.tick()
        self.assertEqual(self.leds.px.brightness, rgb_keys.LEVELS[4])   # the step chosen meanwhile

    def test_the_toggle_key_still_works_and_off_stays_off_after_waking(self):
        self.leds._toggle()                 # LEDs switched off by the user
        self.screen.level = 2
        self.tick()
        self.screen.level = 0
        self.tick()
        self.assertEqual(self.shown(), [0] * 12)

    def test_without_a_screen_nothing_changes(self):
        self.leds.ui = None
        self.tick()
        self.assertEqual(self.leds.px.brightness, rgb_keys.LEVELS[3])
        self.assertEqual(self.shown()[0], BLUE)

    # ------------------------------------------------------------ flash on profile change
    def test_a_profile_change_flashes_the_new_profiles_main_colour(self):
        self.kb.active_layers[0] = 1
        self.tick()
        self.assertEqual(self.shown(), [RED] * 12)

    def test_the_flash_ends_and_the_key_colours_return(self):
        self.kb.active_layers[0] = 1
        self.tick()
        self.tick(rgb_keys.SWITCH_FLASH_S + 0.1)
        self.assertEqual(self.shown(), COLORS[1])

    def test_the_flash_lasts_a_short_moment(self):
        self.kb.active_layers[0] = 1
        self.tick()
        self.tick(rgb_keys.SWITCH_FLASH_S / 2)
        self.assertEqual(self.shown(), [RED] * 12)

    def test_no_flash_for_the_utility_layer_or_when_coming_back_from_it(self):
        self.kb.active_layers[0] = 3        # holding FN
        self.tick()
        self.assertEqual(self.shown(), COLORS[3])
        self.kb.active_layers[0] = 0        # let go
        self.tick()
        self.assertEqual(self.shown(), COLORS[0])

    def test_no_flash_while_the_leds_are_off(self):
        self.screen.level = 2
        self.tick()
        self.kb.active_layers[0] = 1
        self.tick()
        self.assertEqual(self.shown(), [0] * 12)
        self.screen.level = 0
        self.tick()
        self.assertEqual(self.shown(), COLORS[1])           # no late flash either

    def test_no_flash_for_the_first_paint_or_after_new_colours_are_set(self):
        self.leds.set_colors([list(row) for row in COLORS])  # forces a repaint, like a config push
        self.tick()
        self.assertEqual(self.shown(), COLORS[0])

    def test_a_profile_with_only_dark_keys_just_shows_its_keys(self):
        self.kb.active_layers[0] = 2
        self.tick()
        self.assertEqual(self.shown(), COLORS[2])

    def test_flash_is_off_unless_code_py_says_which_layers_are_profiles(self):
        self.leds.profile_layers = 0
        self.kb.active_layers[0] = 1
        self.tick()
        self.assertEqual(self.shown(), COLORS[1])

    def test_accent_is_the_most_common_lit_colour(self):
        self.assertEqual(self.leds._accent(0), BLUE)
        self.assertEqual(self.leds._accent(1), RED)
        self.assertEqual(self.leds._accent(2), 0)
        self.assertEqual(self.leds._accent(99), 0)

    def test_a_held_key_still_lights_white_when_there_is_no_flash(self):
        self.leds._down.add(2)
        self.leds._paint()
        self.assertEqual(self.shown()[2], rgb_keys.WHITE)


class ScreenIdleLevelTests(unittest.TestCase):
    """OledUI.idle_level(): the same dim / off thresholds the screen uses."""

    def make(self, idle, enabled=True, dim=120, off=600):
        ui = oled_ui.OledUI.__new__(oled_ui.OledUI)    # no hardware: only the fields idle_level reads
        ui.enabled = enabled
        ui._dim_s = dim
        ui._off_s = off
        ui.last_activity = 1000.0 - idle
        return ui

    def level(self, ui):
        with mock.patch.object(oled_ui.time, "monotonic", lambda: 1000.0):
            return ui.idle_level()

    def test_in_use(self):
        self.assertEqual(self.level(self.make(5)), 0)
        self.assertEqual(self.level(self.make(119.9)), 0)

    def test_dimmed(self):
        self.assertEqual(self.level(self.make(120)), 1)
        self.assertEqual(self.level(self.make(599)), 1)

    def test_off(self):
        self.assertEqual(self.level(self.make(600)), 2)
        self.assertEqual(self.level(self.make(99999)), 2)

    def test_a_screen_that_is_not_running_never_dims_the_leds(self):
        self.assertEqual(self.level(self.make(99999, enabled=False)), 0)

    def test_it_uses_the_screens_own_thresholds(self):
        self.assertEqual(self.level(self.make(30, dim=20, off=60)), 1)
        self.assertEqual(self.level(self.make(70, dim=20, off=60)), 2)


class FakeBus:
    def __init__(self, fail=False):
        self.sent = []
        self.fail = fail

    def send(self, command, data):
        if self.fail:
            raise OSError("bus error")
        self.sent.append((command, bytes(data)))


class FakeDisplay:
    brightness = 1.0


class ScreenPanelTests(unittest.TestCase):
    """The screen really switches off (SSD1306 0xAE) instead of only going to contrast 0, and back on (0xAF)."""

    def make(self, bus=None):
        ui = oled_ui.OledUI.__new__(oled_ui.OledUI)    # no hardware
        ui.display = FakeDisplay()
        ui._bus = bus if bus is not None else FakeBus()
        ui._panel_on = True
        ui._level = 1.0
        return ui

    def test_level_zero_switches_the_panel_off(self):
        ui = self.make()
        ui._set_level(0.0)
        self.assertEqual(ui._bus.sent, [(0xAE, b"")])
        self.assertEqual(ui.display.brightness, 0.0)

    def test_dimming_keeps_the_panel_on(self):
        ui = self.make()
        ui._set_level(0.25)
        self.assertEqual(ui._bus.sent, [])
        self.assertEqual(ui.display.brightness, 0.25)

    def test_waking_switches_the_panel_on_before_raising_the_brightness(self):
        ui = self.make()
        ui._set_level(0.0)
        ui._set_level(1.0)
        self.assertEqual(ui._bus.sent, [(0xAE, b""), (0xAF, b"")])
        self.assertEqual(ui.display.brightness, 1.0)

    def test_going_from_dim_to_off_to_dim_again(self):
        ui = self.make()
        for level in (0.25, 0.0, 0.25):
            ui._set_level(level)
        self.assertEqual([c for c, _ in ui._bus.sent], [0xAE, 0xAF])

    def test_the_same_level_twice_sends_nothing_more(self):
        ui = self.make()
        ui._set_level(0.0)
        ui._set_level(0.0)
        self.assertEqual(len(ui._bus.sent), 1)

    def test_a_bus_error_never_breaks_the_screen_and_the_level_still_changes(self):
        ui = self.make(FakeBus(fail=True))
        ui._set_level(0.0)
        self.assertEqual(ui.display.brightness, 0.0)
        self.assertTrue(ui._panel_on)           # still believed on, so a later wake tries again
        ui._set_level(1.0)
        self.assertEqual(ui.display.brightness, 1.0)

    def test_before_setup_there_is_no_bus_and_nothing_breaks(self):
        ui = self.make()
        ui._bus = None
        ui._set_level(0.0)
        self.assertEqual(ui.display.brightness, 0.0)


class BrightnessSavingTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000.0
        patch = mock.patch.object(rgb_keys.time, "monotonic", lambda: self.now)
        patch.start()
        self.addCleanup(patch.stop)
        self.saved = []
        self.leds = rgb_keys.RgbKeys(None, level=3, on_level=self.saved.append)
        self.leds.px = FakeStrip()
        self.leds.enabled = True
        self.leds.set_colors([list(row) for row in COLORS])
        self.kb = FakeKeyboard()

    def tick(self, seconds):
        self.now += seconds
        self.leds.before_matrix_scan(self.kb)

    def test_nothing_is_saved_until_a_key_changed_the_level(self):
        self.tick(10)
        self.assertEqual(self.saved, [])

    def test_the_step_is_saved_after_the_keys_have_settled(self):
        self.leds._dimmer()
        self.tick(0.06)
        self.assertEqual(self.saved, [])                    # not yet: more key presses may follow
        self.tick(rgb_keys.SAVE_AFTER_S)
        self.assertEqual(self.saved, [2])
        self.tick(10)
        self.assertEqual(self.saved, [2])                   # once, not at every scan

    def test_several_presses_in_a_row_are_saved_once_with_the_last_step(self):
        self.leds._dimmer()
        self.tick(0.5)
        self.leds._dimmer()
        self.tick(0.5)
        self.leds._dimmer()
        self.tick(rgb_keys.SAVE_AFTER_S + 0.1)
        self.assertEqual(self.saved, [0])

    def test_the_toggle_key_saves_nothing(self):
        self.leds._toggle()
        self.tick(10)
        self.assertEqual(self.saved, [])

    def test_a_failing_save_never_switches_the_leds_off(self):
        def boom(level):
            raise OSError("flash busy")

        self.leds._on_level = boom
        self.leds._brighter()
        self.tick(rgb_keys.SAVE_AFTER_S + 0.1)
        self.assertTrue(self.leds.enabled)

    def test_without_a_saver_the_keys_still_work(self):
        self.leds._on_level = None
        self.leds._dimmer()
        self.tick(rgb_keys.SAVE_AFTER_S + 0.1)
        self.assertEqual(self.leds._level, 2)


if __name__ == "__main__":
    unittest.main()
