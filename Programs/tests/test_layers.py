# SPDX-License-Identifier: GPL-3.0-only
# Extra layers per profile ("layers" + the "layer" key) and tap_hold keys: config_loader.check / build_profiles / _action.
#
#     python -m unittest discover -s Programs/tests -v

import copy
import importlib.util
import os
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

for _name in ("kmk", "kmk.modules", "kmk.keys", "kmk.modules.macros"):
    sys.modules.setdefault(_name, type(sys)(_name))
if not hasattr(sys.modules["kmk.keys"], "KC"):
    sys.modules["kmk.keys"].KC = object()
for _attr in ("Delay", "Press", "Release", "Tap"):
    if not hasattr(sys.modules["kmk.modules.macros"], _attr):
        setattr(sys.modules["kmk.modules.macros"], _attr, object)

_spec = importlib.util.spec_from_file_location("real_config_loader_layers", os.path.join(HERE, "..", "config_loader.py"))
real = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(real)

import key_extras  # noqa: E402  (layer and tap / hold keys; config_loader loads it when a profile has one)
import slot_keys  # noqa: E402  (the slot builder; config_loader.SlotBuilder loads it)


class Key(str):
    """A fake KMK key; calling it records the call, e.g. KC.MO(5) -> "MO(5)"."""

    def __call__(self, *args, **kw):
        extra = ["%s=%s" % (k, kw[k]) for k in sorted(kw)]
        return Key("%s(%s)" % (self, ",".join([str(a) for a in args] + extra)))


class FakeKC:
    """Like KMK's KC, HT and TD exist only after their module was added to the keyboard."""

    def __init__(self):
        self.modules = set()

    def __getattr__(self, name):
        if name in ("HT", "TD") and name not in self.modules:
            raise AttributeError(name)
        return Key(name)


class FakeKeyboard:
    def __init__(self, kc):
        self.modules = []
        self._kc = kc

    def add(self, module):
        self.modules.append(module)


def key(label="x", action=None):
    return {"label": label, "color": "#112233", "action": action or {"type": "key", "key": "A"}}


def profile(pid="general", layers=None, keys=None):
    keys = keys or [key() for _ in range(12)]
    keys[11] = key("FN", {"type": "fn"})
    p = {
        "id": pid, "name": pid.title(),
        "match": {"windows": [], "macos": [], "titles": []},
        "keys": keys,
        "encoder": {"label": "K", "cw": {"type": "key", "key": "A"}, "ccw": {"type": "key", "key": "B"},
                    "press": {"type": "none"}},
    }
    if layers is not None:
        p["layers"] = layers
    return p


def config(*profiles):
    return {
        "schema_version": 1,
        "device": {"owner_screen": {"line1": "", "line2": "", "date": ""}},
        "settings": {"brightness": 0.4},
        "profiles": list(profiles),
    }


def layer_key(mode="hold", layer=1):
    return key("L2", {"type": "layer", "mode": mode, "layer": layer})


def sub_layer(n=12):
    return {"keys": [key("s%d" % i, {"type": "key", "key": "F%d" % (i + 1)}) for i in range(n)]}


class Base(unittest.TestCase):
    def setUp(self):
        self.kc = FakeKC()
        self.kb = FakeKeyboard(self.kc)
        self.kb.modules = _Modules(self.kc)
        for p in (
            mock.patch.object(real, "KC", self.kc),
            mock.patch.object(real, "Tap", lambda k: ("tap", k)),
            mock.patch.object(real, "Press", lambda k: ("press", k)),
            mock.patch.object(real, "Release", lambda k: ("release", k)),
            mock.patch.object(real, "Delay", lambda ms: ("delay", ms)),
            mock.patch.object(real, "keyboard", self.kb),
            mock.patch.object(slot_keys, "KC", self.kc),
            mock.patch.object(slot_keys, "Delay", lambda ms: ("delay", ms)),
            mock.patch.object(key_extras, "KC", self.kc),
            mock.patch.object(key_extras, "_need", lambda keyboard, name: self._need(name)),
        ):
            p.start()
            self.addCleanup(p.stop)

    def _need(self, name):
        # stands in for the real _need: "adds the module" by making KC.HT / KC.TD exist
        self.kc.modules.add(name)
        self.kb.modules.append(name)
        return getattr(self.kc, name)


class _Modules(list):
    def __init__(self, kc):
        super().__init__()


class PadProfileTests(Base):
    """The pad's own profiles have no layers and no double tap: they would cost RAM at start-up, where the screen needs it."""

    def test_a_plain_profile_is_valid(self):
        real.check(config(profile()))

    def test_layers_are_refused(self):
        with self.assertRaises(ValueError):
            real.check(config(profile(layers=[sub_layer()])))

    def test_a_layer_key_is_refused(self):
        keys = [key() for _ in range(12)]
        keys[0] = layer_key()
        with self.assertRaises(ValueError):
            real.check(config(profile(keys=keys)))

    def test_a_double_tap_is_refused(self):
        keys = [key() for _ in range(12)]
        keys[0] = key("x", {"type": "tap_hold", "tap": {"type": "key", "key": "A"}, "double": {"type": "key", "key": "B"}})
        with self.assertRaises(ValueError):
            real.check(config(profile(keys=keys)))

    def test_a_hold_that_is_a_layer_is_refused(self):
        keys = [key() for _ in range(12)]
        keys[0] = key("x", {"type": "tap_hold", "tap": {"type": "key", "key": "A"},
                            "hold": {"type": "layer", "mode": "hold", "layer": 1}})
        with self.assertRaises(ValueError):
            real.check(config(profile(keys=keys)))

    def test_tap_and_hold_are_fine_and_build(self):
        keys = [key() for _ in range(12)]
        keys[0] = key("x", {"type": "tap_hold", "tap": {"type": "key", "key": "A"}, "hold": {"type": "key", "key": "B"}})
        cfg = config(profile(keys=keys))
        real.check(cfg)
        self.assertEqual(real.build_profiles(cfg)[0]["keys"][0], "HT(A,B,prefer_hold=False,tap_interrupted=False,tap_time=250)")

    def test_building_a_pad_profile_without_a_layer_map_refuses_layer_and_double(self):
        for a in (
            {"type": "layer", "mode": "hold", "layer": 1},
            {"type": "tap_hold", "tap": {"type": "key", "key": "A"}, "double": {"type": "key", "key": "B"}},
        ):
            with self.assertRaises(ValueError):
                real._action(a)


class SlotBuilderTests(Base):
    """A Studio-only profile (the slot) may have up to 2 extra layers and use double tap."""

    def make(self, layers, base=5):
        return real.SlotBuilder("Studio", "KNOB:X", layers, base)

    def feed(self, b, count, layer_key=None, first=0):
        for n in range(first, count):
            a = {"type": "fn"} if n in (11, 26, 38) else {"type": "key", "key": "K%d" % n}
            if layer_key and n == layer_key[0]:
                a = layer_key[1]
            b.add(n, "l%d" % n, "#%06x" % (0x100000 + n), __import__("json").dumps(a))
        return b

    def test_two_layers_make_39_keys(self):
        b = self.feed(self.make(2), 39)
        self.assertEqual(b.finish().COUNT, 39)
        self.assertEqual(len(b.sub), 2)
        self.assertEqual(b.sub[0]["keys"][0], "K15")
        self.assertEqual(b.sub[1]["keys"][0], "K27")
        self.assertEqual(b.sub[1]["labels"][0], "l27")
        self.assertEqual(b.sub[1]["colors"][1], 0x10001C)

    def test_without_layers_it_is_the_old_15_keys(self):
        b = self.feed(self.make(0), 15)
        self.assertEqual(b.finish().COUNT, 15)
        self.assertEqual(b.sub, [])

    def test_missing_keys_of_a_layer_are_refused(self):
        b = self.feed(self.make(1), 20)
        with self.assertRaises(ValueError):
            b.finish()

    def test_more_than_two_layers_are_refused(self):
        with self.assertRaises(ValueError):
            self.make(3)

    def test_a_key_past_the_last_layer_is_refused(self):
        with self.assertRaises(ValueError):
            self.make(1).add(27, "x", "#000000", '{"type":"none"}')

    def test_a_layer_key_points_at_the_index_the_layers_will_have(self):
        b = self.make(2, base=6)
        b.add(0, "a", "#000000", '{"type":"layer","mode":"hold","layer":1}')
        b.add(1, "b", "#000000", '{"type":"layer","mode":"toggle","layer":2}')
        self.assertEqual(b.keys[0], "MO(6)")
        self.assertEqual(b.keys[1], "TG(7)")

    def test_a_layer_key_to_a_layer_the_profile_lacks_is_refused(self):
        with self.assertRaises(ValueError):
            self.make(1).add(0, "a", "#000000", '{"type":"layer","mode":"hold","layer":2}')

    def test_double_tap_and_a_layer_hold_work_in_the_slot(self):
        b = self.make(1, base=5)
        b.add(0, "a", "#000000", '{"type":"tap_hold","tap":{"type":"key","key":"A"},"double":{"type":"key","key":"B"}}')
        b.add(1, "b", "#000000", '{"type":"tap_hold","tap":{"type":"key","key":"A"},"hold":{"type":"layer","mode":"hold","layer":1}}')
        self.assertEqual(b.keys[0], "TD(A,B,tap_time=250)")
        self.assertEqual(b.keys[1], "HT(A,MO(5),prefer_hold=False,tap_interrupted=False,tap_time=250)")

    def test_a_sequence_on_a_layer_is_built_from_its_steps(self):
        b = self.make(1)
        b.add(15, "s", "#000000", '{"type":"sequence"}')
        b.step(15, "CTRL+C", "0")
        b.add(16, "n", "#000000", '{"type":"none"}')
        self.assertEqual(len(b.sub[0]["keys"][0:1]), 1)
        self.assertIsNotNone(b.sub[0]["keys"][0])


class TapHoldTests(Base):
    TAP = {"type": "key", "key": "A"}
    HOLD = {"type": "key", "key": "B"}
    DOUBLE = {"type": "key", "key": "C"}

    def test_tap_and_hold(self):
        k = real._action({"type": "tap_hold", "tap": self.TAP, "hold": self.HOLD}, {})
        self.assertEqual(k, "HT(A,B,prefer_hold=False,tap_interrupted=False,tap_time=250)")
        self.assertIn("HT", self.kb.modules)
        self.assertNotIn("TD", self.kb.modules)

    def test_tap_and_double_tap(self):
        k = real._action({"type": "tap_hold", "tap": self.TAP, "double": self.DOUBLE}, {})
        self.assertEqual(k, "TD(A,C,tap_time=250)")
        self.assertIn("TD", self.kb.modules)
        self.assertNotIn("HT", self.kb.modules)

    def test_tap_hold_and_double_tap_together(self):
        k = real._action({"type": "tap_hold", "tap": self.TAP, "hold": self.HOLD, "double": self.DOUBLE, "ms": 400}, {})
        self.assertEqual(k, "TD(HT(A,B,prefer_hold=False,tap_interrupted=False,tap_time=400),C,tap_time=400)")

    def test_the_hold_can_be_a_layer_key(self):
        k = real._action(
            {"type": "tap_hold", "tap": self.TAP, "hold": {"type": "layer", "mode": "hold", "layer": 1}}, {1: 7}
        )
        self.assertEqual(k, "HT(A,MO(7),prefer_hold=False,tap_interrupted=False,tap_time=250)")

    def test_a_hold_or_a_double_is_required(self):
        with self.assertRaises(ValueError):
            real._action({"type": "tap_hold", "tap": self.TAP}, {})

    def test_the_time_is_limited(self):
        for ms in (99, 1001, True, "250"):
            with self.assertRaises(ValueError, msg=repr(ms)):
                real._action({"type": "tap_hold", "tap": self.TAP, "hold": self.HOLD, "ms": ms}, {})

    def test_tap_hold_does_not_nest_and_cannot_hold_fn(self):
        for inner in ({"type": "fn"}, {"type": "tap_hold", "tap": self.TAP, "hold": self.HOLD}):
            with self.assertRaises(ValueError):
                real._action({"type": "tap_hold", "tap": inner, "hold": self.HOLD}, {})

    def test_a_macro_can_be_the_tap_or_the_hold(self):
        seq = {"type": "sequence", "steps": [{"keys": ["A"], "wait": 0}]}
        real._action({"type": "tap_hold", "tap": seq, "hold": seq}, {})

    def test_the_modules_are_added_only_once_and_only_when_needed(self):
        real.build_profiles(config(profile()))
        self.assertEqual(self.kb.modules, [])


class NeedTests(unittest.TestCase):
    """The real _need. KMK does not raise for KC.HT before its module exists (it logs "Invalid key" and gives back a
    dead key), so the module must be added by name, once."""

    def setUp(self):
        self.kc = FakeKC()
        self.kc.modules = {"HT", "TD"}          # a fake KC that never raises, like KMK's
        self.kb = FakeKeyboard(self.kc)
        self.created = []
        for name, cls in (("kmk.modules.holdtap", "HoldTap"), ("kmk.modules.tapdance", "TapDance")):
            mod = type(sys)(name)
            setattr(mod, cls, self._factory(cls))
            p = mock.patch.dict(sys.modules, {name: mod})
            p.start()
            self.addCleanup(p.stop)
        for p in (mock.patch.object(key_extras, "KC", self.kc), mock.patch.object(key_extras, "_added", [])):
            p.start()
            self.addCleanup(p.stop)

    def _factory(self, cls):
        def make():
            self.created.append(cls)
            return cls
        return make

    def test_the_module_is_added_the_first_time_and_only_then(self):
        key_extras._need(self.kb, "HT")
        key_extras._need(self.kb, "HT")
        key_extras._need(self.kb, "TD")
        self.assertEqual(self.created, ["HoldTap", "TapDance"])
        self.assertEqual(self.kb.modules, ["HoldTap", "TapDance"])

    def test_without_a_keyboard_it_refuses(self):
        with self.assertRaises(ValueError):
            key_extras._need(None, "HT")


if __name__ == "__main__":
    unittest.main()
