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
            mock.patch.object(real, "_need", self._need),
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


class LayerCheckTests(Base):
    def test_a_profile_without_layers_is_still_valid(self):
        real.check(config(profile()))

    def test_one_extra_layer_is_valid(self):
        keys = [key() for _ in range(12)]
        keys[0] = layer_key()
        real.check(config(profile(keys=keys, layers=[sub_layer()])))

    def test_more_extra_layers_than_allowed_are_refused(self):
        with self.assertRaises(ValueError):
            real.check(config(profile(layers=[sub_layer()] * (real.SUB_LAYERS + 1))))

    def test_a_layer_needs_twelve_keys(self):
        with self.assertRaises(ValueError):
            real.check(config(profile(layers=[sub_layer(11)])))

    def test_a_layer_key_without_the_layer_is_refused(self):
        keys = [key() for _ in range(12)]
        keys[0] = layer_key()
        with self.assertRaises(ValueError):
            real.check(config(profile(keys=keys)))

    def test_a_layer_key_inside_the_extra_layer_is_checked_too(self):
        sub = sub_layer()
        sub["keys"][0] = layer_key(layer=2)
        with self.assertRaises(ValueError):
            real.check(config(profile(layers=[sub])))


class LayerBuildTests(Base):
    def test_the_layer_key_points_at_the_first_index_after_the_utility_layer(self):
        keys = [key() for _ in range(12)]
        keys[0] = layer_key("hold")
        keys[1] = layer_key("toggle")
        built = real.build_profiles(config(profile(keys=keys, layers=[sub_layer()])))
        # one profile: 0 = profile, 1 = Studio slot, 2 = utility, 3 = its extra layer
        self.assertEqual(built[0]["keys"][0], "MO(3)")
        self.assertEqual(built[0]["keys"][1], "TG(3)")

    def test_indexes_follow_the_profile_order(self):
        k1 = [key() for _ in range(12)]
        k1[0] = layer_key()
        k2 = [key() for _ in range(12)]
        k2[0] = layer_key()
        built = real.build_profiles(config(
            profile("general"), profile("one", keys=k1, layers=[sub_layer()]), profile("two", keys=k2, layers=[sub_layer()])
        ))
        # three profiles: slot = 3, utility = 4, then one's layer = 5 and two's layer = 6
        self.assertEqual(built[1]["keys"][0], "MO(5)")
        self.assertEqual(built[2]["keys"][0], "MO(6)")

    def test_the_extra_layer_is_built_with_its_own_labels_and_colours(self):
        built = real.build_profiles(config(profile(layers=[sub_layer()])))
        sub = built[0]["sub"][0]
        self.assertEqual(sub["labels"][:2], ["s0", "s1"])
        self.assertEqual(sub["colors"][0], 0x112233)
        self.assertEqual(sub["keys"][0], "F1")

    def test_a_profile_without_layers_has_no_sub(self):
        self.assertEqual(real.build_profiles(config(profile()))[0]["sub"], [])

    def test_a_layer_key_is_a_dead_key_where_there_are_no_layers(self):
        self.assertEqual(real._action({"type": "layer", "mode": "hold", "layer": 1}), "NO")

    def test_the_knob_cannot_hold_a_layer_key_that_has_nothing_to_point_at(self):
        # the knob is built without a layer map, so a layer there is a dead key and cannot lock the pad
        self.assertEqual(real._action({"type": "layer", "mode": "toggle", "layer": 1}), "NO")


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


if __name__ == "__main__":
    unittest.main()
