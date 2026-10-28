# SPDX-License-Identifier: GPL-3.0-only
# key_extras.py - the layer key and the tap / hold / double tap key. Copy this file to the root of CIRCUITPY (next to
# config_loader.py).
#
# A file of its own so that a pad that does not use them does not carry it: config_loader.py imports it only when a
# profile has one of these keys. A pad's own profiles may have a tap / hold key; layers and double tap are for
# Studio-only profiles (see slot_keys.py).

from kmk.keys import KC

MIN_TAP_MS = 100               # tap_hold: how long a press counts as a tap / how long the window for a second tap is
MAX_TAP_MS = 1000
DEFAULT_TAP_MS = 250
PLAIN = ("none", "key", "consumer", "hotkey", "text", "sequence")   # what a tap_hold's tap / hold / double may be

_added = []         # the modules _need has added; KC.HT / KC.TD cannot be tested for, KMK hands back a dead key for a name it lacks


def _need(keyboard, name):
    """KC.HT / KC.TD exist only once their module is in the keyboard. Adds it the first time a profile uses it,
    so a pad that never needs it keeps the RAM."""
    if name not in _added:
        if keyboard is None:
            raise ValueError("no support for " + name)
        if name == "HT":
            from kmk.modules.holdtap import HoldTap as Mod
        else:
            from kmk.modules.tapdance import TapDance as Mod
        keyboard.modules.append(Mod())
        _added.append(name)
    return getattr(KC, name)


def build(action, keyboard, a, ctx):
    """A layer key or a tap_hold key. action = config_loader._action; ctx = {layer number: keymap index} for a Studio-only
    profile ({} when it has no layers), None for the pad's own profiles, which have no layers and no double tap."""
    if a["type"] == "layer":
        if ctx is None or a["layer"] not in ctx:
            raise ValueError("no such layer")
        if a["layer"] == 0:     # back to the main keys: the profile's own layer, with every other layer switched off
            return KC.TO(ctx[0])
        if a["mode"] == "hold":
            return KC.MO(ctx[a["layer"]])
        if a["mode"] == "toggle":
            return KC.TG(ctx[a["layer"]])
        raise ValueError("unknown layer mode " + str(a["mode"]))
    return _tap_hold(action, keyboard, a, ctx)


def _plain(action, a):
    if a["type"] not in PLAIN:
        raise ValueError("not allowed inside tap_hold: " + a["type"])
    return action(a)


def _tap_hold(action, keyboard, a, ctx):
    ms = a.get("ms", DEFAULT_TAP_MS)
    if isinstance(ms, bool) or not isinstance(ms, int) or not MIN_TAP_MS <= ms <= MAX_TAP_MS:
        raise ValueError("ms must be %d to %d" % (MIN_TAP_MS, MAX_TAP_MS))
    tap = _plain(action, a["tap"])
    hold, double = a.get("hold"), a.get("double")
    if hold is None and double is None:
        raise ValueError("tap_hold needs a hold or a double")
    if ctx is None and (double is not None or (hold is not None and hold["type"] == "layer")):
        raise ValueError("layers and double tap are for Studio-only profiles")
    if hold is not None:
        # a hold may also be a layer key, which is how a key becomes "tap = X, hold = layer"
        hold = build(action, keyboard, hold, ctx) if hold["type"] == "layer" else _plain(action, hold)
        tap = _need(keyboard, "HT")(tap, hold, prefer_hold=False, tap_interrupted=False, tap_time=ms)
    if double is not None:
        tap = _need(keyboard, "TD")(tap, _plain(action, double), tap_time=ms)
    return tap
