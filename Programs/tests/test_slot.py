# SPDX-License-Identifier: GPL-3.0-only
# The Studio slot: the spare layer that SnekPad Studio fills with the profile of an app the pad has no profile for
# (app_profiles.py: SLOT_BEGIN / SLOT_KEY / SLOT_END and the S flag on APP; config_loader.SlotBuilder).
# The serial handling runs with the fake CircuitPython / KMK modules of test_app_profiles_events.py, the builder with
# the real config_loader.py.
#
#     python -m unittest discover -s Programs/tests -v

import importlib.util
import json
import os
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))

import test_app_profiles_events as base  # noqa: E402
from test_app_profiles_events import Keyboard, SERIAL, app_profiles, feed, make_pad, say_hello, scan, sent  # noqa: E402

# the real config_loader, under its own name (the other tests put a fake one into sys.modules)
_spec = importlib.util.spec_from_file_location("real_config_loader_slot", os.path.join(HERE, "..", "config_loader.py"))
for _name in ("kmk.keys", "kmk.modules.macros"):
    sys.modules.setdefault(_name, type(sys)(_name))
if not hasattr(sys.modules["kmk.keys"], "KC"):
    sys.modules["kmk.keys"].KC = object()
for _attr in ("Delay", "Press", "Release", "Tap"):
    if not hasattr(sys.modules["kmk.modules.macros"], _attr):
        setattr(sys.modules["kmk.modules.macros"], _attr, object)
real = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(real)
import key_extras  # noqa: E402  (layer and tap / hold keys)
import slot_keys  # noqa: E402  (the slot builder lives here; config_loader.SlotBuilder loads it)


class Key(str):
    """A fake KMK key: calling it (a modifier) wraps the key it is given."""

    def __call__(self, *others):
        return Key("%s(%s)" % (self, ",".join(str(o) for o in others)))


class FakeKC:
    def __getattr__(self, name):
        return Key(name)


def action(**kw):
    return json.dumps(kw)


def key_lines(skip=(), bad=None):
    """The 15 SLOT_KEY lines of a profile: keys 0-10 are plain keys, 11 is FN, 12-14 the knob."""
    lines = []
    for n in range(15):
        if n in skip:
            continue
        if n == 11:
            a = action(type="fn")
        elif n >= 12:
            a = action(type="key", key="KNOB%d" % n)
        else:
            a = action(type="key", key="K%d" % n)
        label = "bad" if n == bad else "lb%d" % n
        lines.append("SLOT_KEY\t%d\t%s\t#%06x\t%s\n" % (n, label, 0x100000 + n, a))
    return lines


class FakeBuilder:
    """Stands in for config_loader.SlotBuilder in the serial tests (the real one is tested below)."""

    def __init__(self, name, knob_text, layers=0, base=0):
        self.layers, self.base = layers, base
        self.sub = []
        self.name = name[:12]
        self.knob_text = knob_text[:10]
        self.keys = [None] * 12
        self.labels = [""] * 12
        self.colors = [0] * 12
        self.knob = [None] * 3
        self.got = 0

    def add(self, index, label, color, action_text):
        if label == "bad":
            raise ValueError("bad key")
        a = json.loads(action_text)
        value = "FN" if a["type"] == "fn" else a.get("key", a["type"])
        if index < 12:
            self.keys[index], self.labels[index], self.colors[index] = value, label, int(color[1:], 16)
        else:
            self.knob[index - 12] = value
        self.got += 1

    def step(self, index, keys, wait):
        self.steps = getattr(self, "steps", []) + [(index, keys, int(wait))]

    def finish(self):
        if self.got != 15:
            raise ValueError("profile incomplete")
        return self


class Leds:
    layer = 3


class Ui:
    layer = 3


def make_slot_pad():
    """A pad with General + 2 profiles, the slot as a copy of General, and the utility layer after it."""
    pad, kb = make_pad()
    pad.profiles.append(("Studio", (), ()))
    keymap = [["g%d" % i for i in range(12)], ["c%d" % i for i in range(12)], ["t%d" % i for i in range(12)]]
    keymap += [keymap[0], ["u"] * 12]
    labels = [["gl"] * 12, ["cl"] * 12, ["tl"] * 12, None, ["ul"] * 12]
    colors = [[1] * 12, [2] * 12, [3] * 12, None, [4] * 12]
    names = ["General", "Code", "Term", "Studio", "UTILITY"]
    knob_text = ["KNOB:G", "KNOB:C", "KNOB:T", None, "KNOB:-"]
    enc = [("gl", "gr", "gp"), ("cl", "cr", "cp"), ("tl", "tr", "tp"), None, ("n", "n", "n")]
    labels[3], colors[3], knob_text[3], enc[3] = labels[0], colors[0], knob_text[0], enc[0]
    pad.slot = (3, keymap, labels, colors, names, knob_text, enc, "FNKEY")
    return pad, kb, keymap, labels, colors, names, knob_text, enc


def send_profile(pad, kb, name="OBS", knob="KNOB:SCN", **kw):
    SERIAL.out = b""
    feed(pad, kb, "SLOT_BEGIN\t%s\t%s\n" % (name, knob))
    for line in key_lines(**kw):
        feed(pad, kb, line)
    feed(pad, kb, "SLOT_END\n")


class LayerBuilder(FakeBuilder):
    """FakeBuilder that also makes the extra layers it was asked for."""

    def __init__(self, name, knob_text, layers=0, base=0):
        super().__init__(name, knob_text, layers, base)
        self.sub = [
            dict(keys=["S%d_%d" % (n, i) for i in range(12)], labels=["x%d" % n] * 12, colors=[n] * 12)
            for n in range(1, layers + 1)
        ]


def send_layered(pad, kb, layers, name="OBS"):
    SERIAL.out = b""
    feed(pad, kb, "SLOT_BEGIN\t%s\tKNOB:SCN\t%d\n" % (name, layers))
    for line in key_lines():
        feed(pad, kb, line)
    feed(pad, kb, "SLOT_END\n")


class ConfigPushErrors(unittest.TestCase):
    """A refused config push says why. A MemoryError has no text, which showed up in Studio as 'Could not send:' alone."""

    def test_running_out_of_ram_while_checking_a_config_says_so(self):
        pad, kb = make_pad()
        SERIAL.out = b""
        pad._cfg_error(MemoryError())
        self.assertIn("config too big for the pad's memory", sent())
        self.assertNotIn("ERR\t\n", sent())

    def test_other_reasons_are_passed_on(self):
        pad, kb = make_pad()
        SERIAL.out = b""
        pad._cfg_error(ValueError("unknown key FOO"))
        self.assertIn("ERR\tunknown key FOO", sent())


class ConfigPushFreesTheSlot(unittest.TestCase):
    """A config push gets all the RAM: the Studio profile on the slot is let go when the push starts."""

    class Receiver:
        def __init__(self, length, crc):
            self.length, self.crc = length, crc

        def abort(self):
            pass

    def setUp(self):
        base.config_loader.SlotBuilder = FakeBuilder
        for name, value in (("can_save", lambda: True), ("Receiver", self.Receiver)):
            patcher = mock.patch.object(base.config_loader, name, value, create=True)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_the_slot_profile_is_let_go_when_a_push_starts(self):
        pad, kb, keymap, labels, colors, names, knob_text, enc = make_slot_pad()
        send_profile(pad, kb)
        self.assertTrue(pad.slot_ready)
        SERIAL.out = b""
        feed(pad, kb, "CFG_BEGIN\t100\t00000000\n")
        self.assertEqual(sent(), "OK\n")
        self.assertFalse(pad.slot_ready)
        self.assertIs(keymap[3], keymap[0])          # the slot is General again
        self.assertEqual(pad.profiles[3], ("Studio", (), ()))

    def test_a_push_with_nothing_on_the_slot_is_unchanged(self):
        pad, kb, keymap, *_ = make_slot_pad()
        SERIAL.out = b""
        feed(pad, kb, "CFG_BEGIN\t100\t00000000\n")
        self.assertEqual(sent(), "OK\n")
        self.assertFalse(pad.slot_ready)


class OutOfMemoryBuilder(FakeBuilder):
    def add(self, index, label, color, action_text):
        if label == "bad":
            raise MemoryError()         # KMK makes a key the first time it is asked for: no RAM left
        super().add(index, label, color, action_text)


class SlotOutOfMemory(unittest.TestCase):
    def test_running_out_of_ram_while_building_says_so(self):
        base.config_loader.SlotBuilder = OutOfMemoryBuilder
        pad, kb, keymap, *_ = make_slot_pad()
        send_profile(pad, kb, bad=3)
        self.assertIn("profile too big for the pad", sent())
        self.assertFalse(pad.slot_ready)
        self.assertIs(keymap[3], keymap[0])      # the slot is General again


class SlotLayers(unittest.TestCase):
    """A Studio-only profile's extra layers go after the utility layer and are let go with the profile."""

    def setUp(self):
        base.config_loader.SlotBuilder = LayerBuilder

    def lists(self, *parts):
        return [len(x) for x in parts]

    def test_the_builder_is_told_how_many_layers_and_where_they_will_be(self):
        made = []
        orig = LayerBuilder.__init__

        def spy(self, *a):
            made.append(a)
            orig(self, *a)

        pad, kb, *_ = make_slot_pad()
        with mock.patch.object(LayerBuilder, "__init__", spy):
            send_layered(pad, kb, 2)
        self.assertEqual(made, [("OBS", "KNOB:SCN", 2, 5)])        # the slot is layer 3, the utility layer 4, so the first is 5

    def test_the_extra_layers_are_added_after_the_utility_layer(self):
        pad, kb, keymap, labels, colors, names, knob_text, enc = make_slot_pad()
        send_layered(pad, kb, 2)
        self.assertEqual(self.lists(keymap, labels, colors, names, knob_text, enc), [7] * 6)
        self.assertEqual(keymap[5][0], "S1_0")
        self.assertEqual(keymap[6][0], "S2_0")
        self.assertEqual((names[5], names[6]), ("OBS 2", "OBS 3"))
        self.assertEqual(knob_text[5], "KNOB:SCN")
        self.assertEqual(enc[5], enc[3])                # the knob keeps the profile's actions on a layer

    def test_a_profile_without_layers_adds_nothing(self):
        pad, kb, keymap, *_ = make_slot_pad()
        send_layered(pad, kb, 0)
        self.assertEqual(len(keymap), 5)

    def test_the_next_profile_lets_the_layers_go(self):
        pad, kb, keymap, labels, colors, names, knob_text, enc = make_slot_pad()
        send_layered(pad, kb, 2)
        send_layered(pad, kb, 1, name="Next")
        self.assertEqual(self.lists(keymap, labels, colors, names, knob_text, enc), [6] * 6)
        self.assertEqual(names[5], "Next 2")

    def test_a_layer_that_is_switched_on_is_switched_off_when_it_goes(self):
        pad, kb, keymap, *_ = make_slot_pad()
        send_layered(pad, kb, 2)
        kb.active_layers = [5, 3]           # holding a layer key of the slot's profile
        send_layered(pad, kb, 0, name="Next")
        self.assertEqual(kb.active_layers, [3])
        self.assertEqual(len(keymap), 5)

    def test_when_nothing_is_left_it_falls_back_to_general(self):
        pad, kb, keymap, *_ = make_slot_pad()
        send_layered(pad, kb, 1)
        kb.active_layers = [5]
        send_layered(pad, kb, 0, name="Next")
        self.assertEqual(kb.active_layers, [0])

    def test_too_little_ram_takes_the_layers_out_again(self):
        pad, kb, keymap, *_ = make_slot_pad()
        with mock.patch.object(app_profiles.gc, "mem_free", create=True, return_value=app_profiles.SLOT_MIN_FREE - 1):
            send_layered(pad, kb, 2)
        self.assertEqual(len(keymap), 5)
        self.assertFalse(pad.slot_ready)


class SlotTransfer(unittest.TestCase):
    def setUp(self):
        base.config_loader.SlotBuilder = FakeBuilder

    def test_a_complete_profile_replaces_the_slot(self):
        pad, kb, keymap, labels, colors, names, knob_text, enc = make_slot_pad()
        send_profile(pad, kb)
        self.assertEqual(sent(), "OK\n" * 17)
        self.assertTrue(pad.slot_ready)
        self.assertEqual(keymap[3][:3], ["K0", "K1", "K2"])
        self.assertEqual(keymap[3][11], "FNKEY")          # the FN key is the pad's own, not a string
        self.assertEqual(labels[3][4], "lb4")
        self.assertEqual(colors[3][4], 0x100004)
        self.assertEqual((names[3], knob_text[3]), ("OBS", "KNOB:SCN"))
        self.assertEqual(enc[3], ("KNOB13", "KNOB12", "KNOB14"))    # (turn left, turn right, press)
        self.assertEqual(pad.profiles[3], ("OBS", (), ()))

    def test_a_profile_that_would_leave_too_little_ram_is_refused(self):
        pad, kb, keymap, labels, colors, names, knob_text, enc = make_slot_pad()
        with mock.patch.object(app_profiles.gc, "mem_free", create=True, return_value=app_profiles.SLOT_MIN_FREE - 1):
            send_profile(pad, kb)
        self.assertTrue(sent().endswith("ERR\tprofile too big for the pad\n"))
        self.assertEqual(sent().count("ERR"), 1)
        self.assertFalse(pad.slot_ready)
        self.assertIs(keymap[3], keymap[0])      # the slot is General again, never a profile the pad cannot afford
        self.assertEqual(pad.profiles[3], ("Studio", (), ()))

    def test_a_profile_that_leaves_enough_ram_is_accepted(self):
        pad, kb, keymap, *_ = make_slot_pad()
        with mock.patch.object(app_profiles.gc, "mem_free", create=True, return_value=app_profiles.SLOT_MIN_FREE):
            send_profile(pad, kb)
        self.assertEqual(sent(), "OK\n" * 17)
        self.assertTrue(pad.slot_ready)

    def test_a_refused_profile_does_not_stop_the_next_one(self):
        pad, kb, keymap, *_ = make_slot_pad()
        with mock.patch.object(app_profiles.gc, "mem_free", create=True, return_value=10):
            send_profile(pad, kb)
        with mock.patch.object(app_profiles.gc, "mem_free", create=True, return_value=9000):
            send_profile(pad, kb, name="Next")
        self.assertTrue(pad.slot_ready)
        self.assertEqual(pad.profiles[3][0], "Next")

    def test_the_other_layers_are_not_touched(self):
        pad, kb, keymap, labels, colors, names, knob_text, enc = make_slot_pad()
        send_profile(pad, kb)
        self.assertEqual(keymap[0][0], "g0")
        self.assertEqual((names[0], labels[0][0], colors[0][0], enc[0]), ("General", "gl", 1, ("gl", "gr", "gp")))
        self.assertEqual(keymap[4], ["u"] * 12)

    def test_the_old_profile_is_let_go_at_the_start_of_the_next_one(self):
        pad, kb, keymap, labels, colors, names, knob_text, enc = make_slot_pad()
        send_profile(pad, kb)
        SERIAL.out = b""
        feed(pad, kb, "SLOT_BEGIN\tNext\tKNOB\n")
        self.assertIs(keymap[3], keymap[0])      # General's lists again: the old profile is no longer in RAM
        self.assertIs(labels[3], labels[0])
        self.assertIs(colors[3], colors[0])
        self.assertFalse(pad.slot_ready)
        self.assertEqual(pad.profiles[3], ("Studio", (), ()))
        self.assertEqual(sent(), "OK\n")

    def test_a_broken_key_gives_an_error_and_leaves_the_slot_as_general(self):
        pad, kb, keymap, *_ = make_slot_pad()
        send_profile(pad, kb, bad=5)
        self.assertIn("ERR\tbad key\n", sent())
        self.assertFalse(pad.slot_ready)
        self.assertIs(keymap[3], keymap[0])
        self.assertTrue(sent().count("ERR") >= 2)      # the lines after it are refused too
        self.assertIn("ERR\tno SLOT_BEGIN\n", sent())

    def test_an_incomplete_profile_is_refused_at_the_end(self):
        pad, kb, keymap, *_ = make_slot_pad()
        send_profile(pad, kb, skip=(7,))
        self.assertTrue(sent().endswith("ERR\tprofile incomplete\n"))
        self.assertFalse(pad.slot_ready)
        self.assertIs(keymap[3], keymap[0])

    def test_a_stray_line_does_not_undo_a_finished_slot(self):
        pad, kb, keymap, *_ = make_slot_pad()
        send_profile(pad, kb)
        SERIAL.out = b""
        feed(pad, kb, "SLOT_END\n")
        feed(pad, kb, "SLOT_KEY\t0\tx\t#000000\t{}\n")
        self.assertEqual(sent(), "ERR\tno SLOT_BEGIN\n" * 2)
        self.assertTrue(pad.slot_ready)
        self.assertEqual(keymap[3][0], "K0")

    def test_an_unknown_slot_command_is_an_error(self):
        pad, kb, *_ = make_slot_pad()
        feed(pad, kb, "SLOT_BEGIN\tA\tB\n")
        SERIAL.out = b""
        feed(pad, kb, "SLOT_FOO\n")
        self.assertEqual(sent(), "ERR\tunknown command\n")
        self.assertFalse(pad.slot_ready)

    def test_a_pad_without_a_slot_says_so(self):
        pad, kb = make_pad()
        feed(pad, kb, "SLOT_BEGIN\tA\tB\n")
        self.assertEqual(sent(), "ERR\tno Studio slot\n")

    def test_the_slot_is_not_loaded_while_a_config_is_arriving(self):
        pad, kb, *_ = make_slot_pad()
        pad._rx = object()
        feed(pad, kb, "SLOT_BEGIN\tA\tB\n")
        self.assertIn("ERR\tno Studio slot", sent())
        pad._rx = None

    def test_a_transfer_that_goes_quiet_is_dropped(self):
        pad, kb, keymap, *_ = make_slot_pad()
        with mock.patch.object(app_profiles.time, "monotonic", return_value=100.0):
            feed(pad, kb, "SLOT_BEGIN\tA\tB\n")
            feed(pad, kb, key_lines()[0])
        self.assertIsNotNone(pad._sb)
        with mock.patch.object(app_profiles.time, "monotonic", return_value=100.0 + app_profiles.RX_TIMEOUT_S + 1):
            scan(pad, kb)
        self.assertIsNone(pad._sb)
        self.assertFalse(pad.slot_ready)
        self.assertIs(keymap[3], keymap[0])

    def test_the_port_is_read_on_every_scan_while_a_slot_arrives(self):
        pad, kb, *_ = make_slot_pad()
        feed(pad, kb, "SLOT_BEGIN\tA\tB\n")
        SERIAL.incoming = key_lines()[0].encode()
        pad._last_ms = app_profiles.ticks_ms()      # a scan right after the last one, inside the 50 ms throttle
        pad.before_matrix_scan(kb)
        self.assertEqual(SERIAL.incoming, b"")

    def test_events_wait_while_a_slot_is_arriving(self):
        pad, kb, *_ = make_slot_pad()
        say_hello(pad, kb)
        feed(pad, kb, "SLOT_BEGIN\tA\tB\n")
        pad.process_key(kb, "k", True, 3)
        SERIAL.out = b""
        scan(pad, kb, 2)
        self.assertNotIn("EVT", sent())

    def test_a_slot_that_is_on_screen_is_redrawn(self):
        pad, kb, *_ = make_slot_pad()
        pad.leds, pad.ui = Leds(), Ui()
        kb.active_layers = [3]
        send_profile(pad, kb)
        self.assertEqual((pad.leds.layer, pad.ui.layer), (-1, -1))

    def test_a_slot_that_is_not_on_screen_is_not_redrawn(self):
        pad, kb, *_ = make_slot_pad()
        pad.leds, pad.ui = Leds(), Ui()
        kb.active_layers = [1]
        send_profile(pad, kb)
        self.assertEqual((pad.leds.layer, pad.ui.layer), (3, 3))


class SlotSteps(unittest.TestCase):
    def setUp(self):
        base.config_loader.SlotBuilder = FakeBuilder

    def test_a_step_line_reaches_the_builder_and_is_answered(self):
        pad, kb, *_ = make_slot_pad()
        feed(pad, kb, "SLOT_BEGIN\tA\tB\n")
        SERIAL.out = b""
        feed(pad, kb, 'SLOT_KEY\t0\tx\t#000000\t{"type":"sequence"}\n')
        feed(pad, kb, "SLOT_STEP\t0\tCTRL+K\t100\n")
        feed(pad, kb, "SLOT_STEP\t0\tENTER\t0\n")
        self.assertEqual(sent(), "OK\n" * 3)
        self.assertEqual(pad._sb.steps, [(0, "CTRL+K", 100), (0, "ENTER", 0)])

    def test_a_bad_step_drops_the_profile(self):
        pad, kb, keymap, *_ = make_slot_pad()
        feed(pad, kb, "SLOT_BEGIN\tA\tB\n")
        SERIAL.out = b""
        feed(pad, kb, "SLOT_STEP\t0\tCTRL\n")          # a field is missing
        self.assertTrue(sent().startswith("ERR"))
        self.assertIsNone(pad._sb)
        self.assertIs(keymap[3], keymap[0])


class SlotFlag(unittest.TestCase):
    def setUp(self):
        base.config_loader.SlotBuilder = FakeBuilder

    def test_the_flag_puts_the_app_on_the_slot(self):
        pad, kb, *_ = make_slot_pad()
        send_profile(pad, kb)
        feed(pad, kb, "APP\tobs64\tOBS Studio\tS\n")
        self.assertEqual(kb.active_layers[-1], 3)
        self.assertEqual(pad.app_label, "OBS")

    def test_without_the_flag_the_pad_matches_by_itself(self):
        pad, kb, *_ = make_slot_pad()
        send_profile(pad, kb)
        feed(pad, kb, "APP\tcode\tx\n")
        self.assertEqual(kb.active_layers[-1], 1)
        feed(pad, kb, "APP\tobs64\tOBS Studio\tS\n")
        feed(pad, kb, "APP\tnotepad\tx\n")
        self.assertEqual(kb.active_layers[-1], 0)

    def test_the_flag_without_a_loaded_slot_falls_back_to_the_pads_own_match(self):
        pad, kb, *_ = make_slot_pad()
        feed(pad, kb, "APP\tcode\tx\tS\n")
        self.assertEqual(kb.active_layers[-1], 1)       # not the empty slot
        feed(pad, kb, "APP\tobs64\tx\tS\n")
        self.assertEqual(kb.active_layers[-1], 0)

    def test_an_old_style_app_line_is_unchanged(self):
        pad, kb, *_ = make_slot_pad()
        feed(pad, kb, "APP\twt\tTerminal\n")
        self.assertEqual(kb.active_layers[-1], 2)

    def test_the_slot_is_reported_as_the_active_profile(self):
        pad, kb, *_ = make_slot_pad()
        say_hello(pad, kb)
        send_profile(pad, kb)
        feed(pad, kb, "APP\tobs64\tx\tS\n")
        scan(pad, kb, 2)
        self.assertIn("EVT\tlayer\t3\n", sent())

    def test_the_slot_never_matches_an_app_by_itself(self):
        pad, kb, *_ = make_slot_pad()
        send_profile(pad, kb)
        feed(pad, kb, "APP\tstudio\tOBS\n")
        self.assertEqual(kb.active_layers[-1], 0)


class SlotBuilderTests(unittest.TestCase):
    """The real config_loader.SlotBuilder, with a fake KMK."""

    def setUp(self):
        patches = [
            mock.patch.object(real, "KC", FakeKC()),
            mock.patch.object(slot_keys, "KC", FakeKC()),
            mock.patch.object(key_extras, "KC", FakeKC()),
            mock.patch.object(slot_keys, "Delay", lambda ms: ("delay", ms)),
            mock.patch.object(real, "Tap", lambda k: ("tap", k)),
            mock.patch.object(real, "Press", lambda k: ("press", k)),
            mock.patch.object(real, "Release", lambda k: ("release", k)),
            mock.patch.object(real, "Delay", lambda ms: ("delay", ms)),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def full(self, builder):
        for n in range(15):
            a = {"type": "fn"} if n == 11 else {"type": "key", "key": "A"}
            builder.add(n, "lbl%d" % n, "#ff8000", json.dumps(a))
        return builder.finish()

    def test_a_whole_profile_is_built(self):
        b = self.full(real.SlotBuilder("A name that is too long", "KNOB:TOO-LONG-TEXT"))
        self.assertEqual((b.name, b.knob_text), ("A name that ", "KNOB:TOO-L"))
        self.assertEqual(b.keys[11], "FN")
        self.assertEqual(b.keys[0], "A")
        self.assertEqual(b.labels[3], "lbl3"[:5])
        self.assertEqual(b.labels[10], "lbl10"[:5])
        self.assertEqual(b.colors[0], 0xFF8000)
        self.assertEqual(b.knob, ["A", "A", "A"])

    def test_labels_are_cut_to_what_the_screen_shows(self):
        b = real.SlotBuilder("n", "k")
        b.add(0, "abcdefgh", "#000000", json.dumps({"type": "none"}))
        self.assertEqual(b.labels[0], "abcde")

    def test_an_empty_name_gets_a_default(self):
        self.assertEqual(real.SlotBuilder("", "").name, "Studio")

    def test_a_key_sent_twice_counts_once(self):
        b = self.full(real.SlotBuilder("n", "k"))
        b.add(2, "x", "#000000", json.dumps({"type": "none"}))
        self.assertEqual(b.finish().got, 15)

    def test_missing_keys_are_refused(self):
        b = real.SlotBuilder("n", "k")
        for n in range(14):
            b.add(n, "x", "#000000", json.dumps({"type": "none"}))
        with self.assertRaisesRegex(ValueError, "incomplete"):
            b.finish()

    def test_bad_input_is_refused(self):
        b = real.SlotBuilder("n", "k")
        for args in ((15, "x", "#000000", "{}"), (-1, "x", "#000000", "{}"), (0, "x", "000000", '{"type":"none"}'),
                     (0, "x", "#000000", "not json"), (0, "x", "#000000", '{"type":"nope"}')):
            with self.assertRaises((ValueError, KeyError), msg=repr(args)):
                b.add(*args)

    def test_hotkeys_text_and_sequences_build_like_a_pushed_config(self):
        b = real.SlotBuilder("n", "k")
        for n, a in enumerate((
            {"type": "hotkey", "keys": ["CTRL", "SHIFT", "P"]},
            {"type": "text", "text": "git status", "enter": True},
            {"type": "sequence", "steps": [{"keys": ["UP"], "wait": 100}, {"keys": ["ENTER"], "wait": 0}]},
            {"type": "consumer", "code": "MUTE"},
        )):
            b.add(n, "x", "#000000", json.dumps(a))
        self.assertEqual(b.keys[0], "LCTL(LSFT(P))")
        for n in (1, 2):
            self.assertTrue(b.keys[n].startswith("MACRO"))
        self.assertEqual(b.keys[3], "MUTE")

    STEPS = [{"keys": ["CTRL", "K"], "wait": 100}, {"keys": ["UP"], "wait": 250}, {"keys": ["ENTER"], "wait": 0}]

    def sequence_by_steps(self, steps, index=2, label="seq"):
        b = real.SlotBuilder("n", "k")
        b.add(index, label, "#000000", json.dumps({"type": "sequence"}))
        for s in steps:
            b.step(index, "+".join(s["keys"]), s["wait"])
        return b

    def test_a_sequence_sent_step_by_step_is_the_same_macro_as_a_pushed_one(self):
        pushed = real._action({"type": "sequence", "steps": self.STEPS})
        b = self.sequence_by_steps(self.STEPS)
        b._end_seq()
        self.assertEqual(b.keys[2], pushed)
        self.assertEqual(b.got, 1)

    def test_a_pause_after_the_last_step_is_not_used(self):
        steps = [{"keys": ["A"], "wait": 100}, {"keys": ["B"], "wait": 900}]
        b = self.sequence_by_steps(steps)
        b._end_seq()
        self.assertEqual(b.keys[2], real._action({"type": "sequence", "steps": steps}))

    def test_the_sequence_is_finished_by_the_next_key_or_by_the_end(self):
        b = self.sequence_by_steps(self.STEPS)
        self.assertIsNone(b.keys[2])
        b.add(3, "x", "#000000", json.dumps({"type": "none"}))
        self.assertIsNotNone(b.keys[2])
        self.assertEqual(b.got, 2)
        c = self.sequence_by_steps(self.STEPS, index=0)
        for n in range(1, 15):
            if n == 11:
                continue
            c.add(n, "x", "#000000", json.dumps({"type": "none"}))
        c.add(11, "FN", "#303030", json.dumps({"type": "fn"}))
        self.assertEqual(c.finish().got, 15)

    def test_the_label_and_colour_of_a_sequence_key_are_kept(self):
        b = self.sequence_by_steps(self.STEPS, label="abcdefg")
        self.assertEqual(b.labels[2], "abcde")

    def test_steps_without_a_sequence_are_refused(self):
        b = real.SlotBuilder("n", "k")
        with self.assertRaisesRegex(ValueError, "no sequence"):
            b.step(0, "A", 0)
        b.add(1, "x", "#000000", json.dumps({"type": "sequence"}))
        with self.assertRaisesRegex(ValueError, "no sequence"):
            b.step(0, "A", 0)               # the steps of another key

    def test_an_empty_sequence_is_refused(self):
        b = real.SlotBuilder("n", "k")
        b.add(1, "x", "#000000", json.dumps({"type": "sequence"}))
        with self.assertRaisesRegex(ValueError, "empty"):
            b.finish()

    def test_a_pause_out_of_range_is_refused(self):
        b = real.SlotBuilder("n", "k")
        b.add(1, "x", "#000000", json.dumps({"type": "sequence"}))
        for bad in ("-1", "2001", "x"):
            with self.assertRaises(ValueError, msg=bad):
                b.step(1, "A", bad)

    def test_no_sequence_on_the_knob(self):
        b = real.SlotBuilder("n", "k")
        with self.assertRaisesRegex(ValueError, "knob"):
            b.add(13, "", "#000000", json.dumps({"type": "sequence"}))

    def test_a_whole_sequence_given_in_one_piece_still_works(self):
        b = real.SlotBuilder("n", "k")
        b.add(0, "x", "#000000", json.dumps({"type": "sequence", "steps": self.STEPS}))
        self.assertEqual(b.keys[0], real._action({"type": "sequence", "steps": self.STEPS}))

    def test_a_pad_that_has_four_profiles_saved_still_accepts_the_config(self):
        self.assertEqual(real.MAX_PROFILES, 4)


if __name__ == "__main__":
    unittest.main()
