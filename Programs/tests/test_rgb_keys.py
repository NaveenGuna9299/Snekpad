# SPDX-License-Identifier: GPL-3.0-only
# The key LEDs (rgb_keys.py) follow the screen's dim / off steps, and flash the new profile's colour when the
# profile changes. Also the screen's idle_level() (oled_ui.py), which the LEDs follow.
#
#     python -m unittest discover -s Programs/tests -v

import itertools
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
FRAME_S = rgb_keys.FRAME_MS / 1000 + 0.0006      # one frame of a moving effect, and a hair more
RAINBOW_S = rgb_keys.RAINBOW_MS / 1000
LOOP_S = rgb_keys.LOOP_MS / 1000
RIPPLE_LIFE_S = rgb_keys.RIPPLE_LIFE_MS / 1000
TWINKLE_S = rgb_keys.TWINKLE_MS / 1000


class FakeStrip:
    """Stands in for the NeoPixel strip: remembers what was last shown."""

    def __init__(self):
        self.px = [0] * 12
        self.brightness = 0
        self.shows = 0

    def __setitem__(self, i, v):
        self.px[i] = v

    def fill(self, v):
        self.px = [v] * 12

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


class EffectTests(unittest.TestCase):
    """The moving effects. Everything but static makes its own random colours."""

    def setUp(self):
        self.now = 1000.0
        patch = mock.patch.object(rgb_keys.time, "monotonic", lambda: self.now)
        patch.start()
        self.addCleanup(patch.stop)
        self.kb = FakeKeyboard()

    def make(self, effect, level=3):
        leds = rgb_keys.RgbKeys(None, level=level, effect=effect)
        leds.px = FakeStrip()
        leds.enabled = True
        leds.set_colors([list(row) for row in COLORS])
        leds.profile_layers = 3
        leds.layer = 0
        leds._apply_level()
        return leds

    def tick(self, leds, seconds=0.06):
        self.now += seconds
        leds.before_matrix_scan(self.kb)

    def press(self, leds, key):
        leds.process_key(self.kb, None, True, key)
        leds.process_key(self.kb, None, False, key)

    def key(self, leds, i):
        """What key i shows, as three 0-255 channels."""
        v = leds.px.px[rgb_keys.LED_FOR_KEY[i]]
        return (v >> 16) & 255, (v >> 8) & 255, v & 255

    def lit(self, leds):
        return [i for i in range(12) if leds.px.px[rgb_keys.LED_FOR_KEY[i]]]

    # ------------------------------------------------------------ static and the flash
    def test_static_shows_the_key_colours_and_keeps_its_flash(self):
        leds = self.make("static")
        self.tick(leds)
        self.assertEqual(leds.px.px, COLORS[0])
        self.assertEqual(leds.px.brightness, rgb_keys.LEVELS[3])
        self.kb.active_layers[0] = 1
        self.tick(leds)
        self.assertEqual(leds.px.px, [RED] * 12)        # the profile flash is only for static

    def test_no_moving_effect_flashes_on_a_profile_change(self):
        for name in ("rainbow", "ripple", "starry"):
            leds = self.make(name)
            self.kb.active_layers[0] = 0
            self.tick(leds)
            self.kb.active_layers[0] = 1
            self.tick(leds)
            self.assertEqual(leds._flash_until, 0, name)

    def test_the_per_key_colours_are_not_used_by_the_moving_effects(self):
        for name in ("ripple", "starry"):
            leds = self.make(name)
            for _ in range(60):
                self.tick(leds, 0.07)
                self.assertNotIn(GREEN, leds.px.px, name)       # the profile's green keys never show

    # ------------------------------------------------------------ rainbow
    def test_rainbow_gives_each_column_its_own_colour_and_the_rows_the_same(self):
        leds = self.make("rainbow")
        self.tick(leds)
        columns = [self.key(leds, c) for c in range(4)]
        self.assertEqual(len(set(columns)), 4)
        for row in range(3):
            self.assertEqual([self.key(leds, row * 4 + c) for c in range(4)], columns)

    def test_rainbow_flows_from_the_left_to_the_right(self):
        leds = self.make("rainbow")
        self.tick(leds)
        left = self.key(leds, 0)
        for _ in range(int(rgb_keys.RAINBOW_SPREAD / rgb_keys.WHEEL * RAINBOW_S / FRAME_S) + 1):
            self.tick(leds, FRAME_S)
        # the colour the first column had a moment ago is now on the second one
        for got, want in zip(self.key(leds, 1), left):
            self.assertAlmostEqual(got, want, delta=4)

    def test_rainbow_goes_round_in_four_seconds(self):
        leds = self.make("rainbow")
        self.tick(leds)
        start = self.key(leds, 0)
        for _ in range(int(RAINBOW_S / FRAME_S)):
            self.tick(leds, FRAME_S)
        for got, want in zip(self.key(leds, 0), start):
            self.assertAlmostEqual(got, want, delta=4)

    # ------------------------------------------------------------ ripple
    def test_ripple_leaves_the_keys_dark_until_a_key_is_pressed(self):
        leds = self.make("ripple")
        shows = leds.px.shows
        for _ in range(10):
            self.tick(leds)
        self.assertEqual(leds.px.px, [0] * 12)
        self.assertEqual(leds.px.shows, shows)                  # nothing is sent while nothing moves

    def test_ripple_spreads_from_the_pressed_key_in_a_random_colour_and_dies_away(self):
        leds = self.make("ripple")
        with mock.patch.object(rgb_keys.random, "randrange", lambda n: 0):     # the colour is red
            self.press(leds, 5)
        self.tick(leds, 0.05)
        r, g, b = self.key(leds, 5)
        self.assertGreater(r, 30)                               # the pressed key is the centre
        self.assertEqual((g, b), (0, 0))                        # in the ripple's colour, not white
        self.assertEqual(self.key(leds, 11), (0, 0, 0))         # the far corner is not reached yet
        self.tick(leds, 0.2)                                    # the ring has moved out to the neighbours
        self.assertGreater(sum(self.key(leds, 6)), 0)
        for _ in range(int(RIPPLE_LIFE_S / 0.06) + 3):
            self.tick(leds, 0.06)
        self.assertEqual(leds.px.px, [0] * 12)
        shows = leds.px.shows
        for _ in range(10):
            self.tick(leds)
        self.assertEqual(leds.px.shows, shows)                  # quiet again

    def test_every_ripple_has_its_own_random_colour(self):
        leds = self.make("ripple")
        with mock.patch.object(rgb_keys.random, "randrange", mock.Mock(side_effect=[0, 512])):
            self.press(leds, 0)
            self.press(leds, 11)
        self.assertEqual(leds._rp_c[:2], [0xFF0000, 0x00FF00])

    def test_only_a_few_ripples_run_at_once_and_the_oldest_goes_first(self):
        leds = self.make("ripple")
        for k in range(rgb_keys.MAX_RIPPLES + 3):
            self.tick(leds, 0.05)                                   # the effects' clock moves between presses
            self.press(leds, k)
        self.assertEqual(len(leds._rp_t), rgb_keys.MAX_RIPPLES)
        self.assertEqual(sorted(leds._rp_k), [3, 4, 5, 6])

    def test_the_ripple_distances_are_right(self):
        self.assertEqual(rgb_keys.DIST[0 * 12 + 0], 0)
        self.assertEqual(rgb_keys.DIST[0 * 12 + 1], 16)         # next key along
        self.assertEqual(rgb_keys.DIST[0 * 12 + 4], 16)         # next key down
        self.assertEqual(rgb_keys.DIST[0 * 12 + 5], 22)         # diagonal: 1.41 keys
        self.assertEqual(rgb_keys.DIST[0 * 12 + 11], rgb_keys.DIST[11 * 12 + 0])

    # ------------------------------------------------------------ starry night
    def test_starry_is_dark_between_the_stars_and_twinkles_random_keys_in_random_colours(self):
        leds = self.make("starry")
        start = lambda n: 0 if n in (rgb_keys.TWINKLE_ONE_IN, rgb_keys.WHEEL) else 1    # a star, key 1, red
        none = lambda n: 1 if n == rgb_keys.TWINKLE_ONE_IN else 0                       # no new stars
        with mock.patch.object(rgb_keys.random, "randrange", none):
            self.tick(leds)
        self.assertEqual(leds.px.px, [0] * 12)
        with mock.patch.object(rgb_keys.random, "randrange", start):
            self.tick(leds, FRAME_S)                            # a star starts on key 1
        with mock.patch.object(rgb_keys.random, "randrange", none):
            for _ in range(8):
                self.tick(leds, TWINKLE_S / 16)                 # half way: at its brightest
        r, g, b = self.key(leds, 1)
        self.assertGreater(r, 30)
        self.assertEqual((g, b), (0, 0))                        # red, the colour that was drawn
        self.assertEqual(self.lit(leds), [1])

    def test_a_star_fades_out_completely(self):
        leds = self.make("starry")
        leds._st_t[2] = leds._ms
        leds._st_c[2] = 0x00FF00
        with mock.patch.object(rgb_keys.random, "randrange", lambda n: 1 if n == rgb_keys.TWINKLE_ONE_IN else 0):
            for _ in range(int(TWINKLE_S / 0.06) + 3):
                self.tick(leds)
        self.assertEqual(leds.px.px, [0] * 12)
        self.assertEqual(leds._st_t[2], -1)

    def test_there_are_never_more_than_a_few_stars(self):
        leds = self.make("starry")
        keys = itertools.count()
        pick = lambda n: 0 if n in (rgb_keys.TWINKLE_ONE_IN, rgb_keys.WHEEL) else next(keys) % n    # always a new star
        with mock.patch.object(rgb_keys.random, "randrange", pick):
            for _ in range(200):
                self.tick(leds, FRAME_S)
                self.assertLessEqual(len(self.lit(leds)), rgb_keys.MAX_STARS)

    # ------------------------------------------------------------ smoothness
    def test_a_moving_effect_is_drawn_at_full_precision_with_the_brightness_applied_in_the_firmware(self):
        leds = self.make("rainbow")
        self.assertEqual(leds.px.brightness, 1.0)
        self.tick(leds)
        self.assertLessEqual(max(max(self.key(leds, i)) for i in range(12)), int(255 * rgb_keys.LEVELS[3]) + 1)

    def test_the_rainbow_changes_in_tiny_steps_from_frame_to_frame(self):
        leds = self.make("rainbow", level=0)                      # the dimmest step, where stepping shows most
        previous = None
        biggest = 0
        for _ in range(int(RAINBOW_S / FRAME_S)):
            self.tick(leds, FRAME_S)
            now = self.key(leds, 0)
            if previous:
                biggest = max(biggest, max(abs(a - b) for a, b in zip(now, previous)))
            previous = now
        self.assertLessEqual(biggest, 2)

    def test_there_is_no_flicker_between_frames_that_show_the_same_thing(self):
        # no rounding error is carried from one frame to the next: the same moment gives the same picture
        for name in ("rainbow",):
            leds = self.make(name, level=0)
            leds._tt = 3000
            leds._paint_moving()
            first = list(leds.px.px)
            for _ in range(50):
                leds._paint_moving()
                self.assertEqual(leds.px.px, first, name)

    def test_the_brightness_is_the_colour_times_the_step_rounded(self):
        leds = self.make("rainbow", level=0)
        leds._tt = 3000
        leds._paint_moving()
        c = rgb_keys._wheel(0 * rgb_keys.RAINBOW_SPREAD - 3000 * rgb_keys.WHEEL // rgb_keys.RAINBOW_MS)
        want = tuple(int(((c >> s) & 255) * rgb_keys.LEVELS[0] + 0.5) for s in (16, 8, 0))
        for got, w in zip(self.key(leds, 0), want):
            self.assertAlmostEqual(got, w, delta=1)

    def test_a_frame_makes_no_new_lists(self):
        leds = self.make("ripple")
        self.press(leds, 5)
        rt = leds._rp_t
        for _ in range(5):
            self.tick(leds)
        self.assertIs(leds._rp_t, rt)

    def test_the_effect_clock_stays_exact_however_long_the_pad_has_been_on(self):
        def picture():
            leds = self.make("rainbow")
            out = []
            for _ in range(int(RAINBOW_S / FRAME_S)):
                self.tick(leds, FRAME_S)
                out.append(self.key(leds, 2))
            return out

        self.now = 1000.0
        short = picture()
        self.now = 3_000_000.0                                  # more than a month of uptime
        long_ = picture()
        for a, b in zip(short, long_):
            for x, y in zip(a, b):
                self.assertAlmostEqual(x, y, delta=2)           # the same colours, however long the pad has been on

    def test_the_clock_wraps_after_a_whole_number_of_trips_round_the_wheel(self):
        self.assertEqual(rgb_keys.LOOP_MS % rgb_keys.RAINBOW_MS, 0)

    # ------------------------------------------------------------ the rest of the pad's behaviour
    def test_the_utility_layer_shows_its_own_colours_and_the_normal_brightness(self):
        leds = self.make("rainbow")
        self.tick(leds)
        self.assertEqual(leds.px.brightness, 1.0)
        self.kb.active_layers[0] = 3
        self.tick(leds)
        self.assertEqual(leds.px.px, COLORS[3])
        self.assertEqual(leds.px.brightness, rgb_keys.LEVELS[3])
        self.kb.active_layers[0] = 0                            # let go: the effect is back
        self.tick(leds)
        self.assertEqual(leds.px.brightness, 1.0)
        self.assertNotEqual(leds.px.px, COLORS[0])

    def test_a_moving_effect_stays_off_while_the_leds_are_off(self):
        leds = self.make("rainbow")
        self.tick(leds)
        leds._toggle()
        self.tick(leds)
        self.assertEqual(leds.px.px, [0] * 12)
        leds._toggle()
        leds.ui = FakeScreen()
        leds.ui.level = 2
        self.tick(leds)
        self.assertEqual(leds.px.px, [0] * 12)
        leds.ui.level = 0
        self.tick(leds)
        self.assertGreater(len(set(leds.px.px)), 1)             # and comes back

    def test_the_brightness_keys_and_dimming_work_with_an_effect(self):
        leds = self.make("rainbow", level=4)
        self.tick(leds)
        bright = max(self.key(leds, 0))
        leds._dimmer()
        leds._dimmer()
        self.tick(leds)
        self.assertLess(max(self.key(leds, 0)), bright)
        leds.ui = FakeScreen()
        leds.ui.level = 1                                       # the screen dims: the lowest step
        self.tick(leds)
        self.assertLessEqual(max(self.key(leds, 0)), int(255 * rgb_keys.LEVELS[0]) + 1)

    def test_the_soft_start_applies_to_effects_too(self):
        leds = self.make("rainbow")
        leds._ramp = 0.0
        self.tick(leds)
        self.assertEqual(leds.px.px, [0] * 12)

    def test_every_colour_is_a_valid_rgb_value(self):
        for name in ("rainbow", "ripple", "starry"):
            leds = self.make(name, level=4)
            self.press(leds, 3)
            for _ in range(120):
                self.tick(leds, 0.05)
                self.assertTrue(all(0 <= c <= 0xFFFFFF and isinstance(c, int) for c in leds.px.px), name)

    def test_the_colour_wheel(self):
        self.assertEqual(rgb_keys._wheel(0), 0xFF0000)
        self.assertEqual(rgb_keys._wheel(256), 0xFFFF00)
        self.assertEqual(rgb_keys._wheel(512), 0x00FF00)
        self.assertEqual(rgb_keys._wheel(1024), 0x0000FF)
        self.assertEqual(rgb_keys._wheel(1536), 0xFF0000)               # once round
        self.assertEqual(rgb_keys._wheel(1536 * 2 + 700), rgb_keys._wheel(700))
        for n in range(0, 1536, 7):
            c = rgb_keys._wheel(n)
            channels = [(c >> 16) & 255, (c >> 8) & 255, c & 255]
            self.assertEqual(max(channels), 255)                # always fully bright and saturated
            self.assertEqual(min(channels), 0)

    def test_nothing_in_a_frame_needs_a_decimal_number_beyond_a_few_per_frame(self):
        # the effect code works in whole numbers: the state it keeps is all whole numbers
        for name in ("rainbow", "ripple", "starry"):
            leds = self.make(name)
            self.press(leds, 2)
            for _ in range(30):
                self.tick(leds, FRAME_S)
            for attr in ("_ms", "_tt", "_g", "_c"):
                self.assertIsInstance(getattr(leds, attr), int, (name, attr))


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


class SoftStartTests(unittest.TestCase):
    """At power-up the LEDs wait for USB and then fade in, so the pad never pulls its full current at once."""

    def setUp(self):
        self.now = 1000.0
        patch = mock.patch.object(rgb_keys.time, "monotonic", lambda: self.now)
        patch.start()
        self.addCleanup(patch.stop)
        self.strip = FakeStrip()
        fake_neopixel = mock.Mock(return_value=self.strip)
        fake_neopixel.GRB = "GRB"
        patch2 = mock.patch.object(rgb_keys, "neopixel", types.SimpleNamespace(NeoPixel=fake_neopixel, GRB="GRB"))
        patch2.start()
        self.addCleanup(patch2.stop)
        self.leds = rgb_keys.RgbKeys(None, level=3)
        self.leds.set_colors([list(row) for row in COLORS])
        self.kb = FakeKeyboard()
        self.leds.during_bootup(self.kb)

    def tick(self, seconds):
        self.now += seconds
        self.leds.before_matrix_scan(self.kb)

    def start(self):
        """The first scan: the soft start begins here."""
        self.tick(0.06)

    def test_the_leds_start_dark(self):
        self.assertEqual(self.strip.brightness, 0)

    def test_the_screens_start_up_logo_does_not_use_up_the_fade(self):
        # oled_ui.during_bootup sleeps about 2 s before the first scan: the LEDs must still start from dark
        self.now += 2.0
        self.start()
        self.assertEqual(self.strip.brightness, 0)
        self.tick(rgb_keys.START_DELAY_S + rgb_keys.RAMP_S / 2)
        self.assertGreater(self.strip.brightness, 0)
        self.assertLess(self.strip.brightness, rgb_keys.LEVELS[3])

    def test_they_stay_dark_while_usb_enumerates(self):
        self.start()
        for _ in range(int(rgb_keys.START_DELAY_S / 0.06)):
            self.tick(0.06)
        self.assertEqual(self.strip.brightness, 0)

    def test_then_they_fade_up_in_steps_never_jumping(self):
        self.start()
        self.tick(rgb_keys.START_DELAY_S + 0.01)
        seen = []
        for _ in range(int(rgb_keys.RAMP_S / 0.06) + 5):
            self.tick(0.06)
            seen.append(self.strip.brightness)
        self.assertEqual(seen, sorted(seen))                          # only ever up
        self.assertAlmostEqual(seen[-1], rgb_keys.LEVELS[3])          # ends at the chosen level
        steps = [b - a for a, b in zip([0] + seen, seen)]
        self.assertLess(max(steps), rgb_keys.LEVELS[3] / 10)          # no step is more than a tenth of the way

    def test_a_dimmer_level_is_reached_too(self):
        self.start()
        self.leds._dimmer()
        self.tick(rgb_keys.START_DELAY_S + rgb_keys.RAMP_S + 0.1)
        self.assertAlmostEqual(self.strip.brightness, rgb_keys.LEVELS[2])

    def test_the_keys_work_during_the_fade(self):
        self.start()
        self.tick(rgb_keys.START_DELAY_S + 0.5)
        self.leds._brighter()
        self.assertLess(self.strip.brightness, rgb_keys.LEVELS[4])    # still part of the way
        self.tick(rgb_keys.RAMP_S)
        self.assertAlmostEqual(self.strip.brightness, rgb_keys.LEVELS[4])

    def test_once_up_the_fade_does_no_more_work(self):
        self.start()
        self.tick(rgb_keys.START_DELAY_S + rgb_keys.RAMP_S + 0.1)
        shows = self.strip.shows
        for _ in range(20):
            self.tick(0.06)
        self.assertEqual(self.strip.shows, shows)

    def test_a_module_without_a_start_time_is_not_faded(self):
        leds = rgb_keys.RgbKeys(None, level=3)
        self.assertEqual(leds._ramp, 1.0)


if __name__ == "__main__":
    unittest.main()
