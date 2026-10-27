# SPDX-License-Identifier: GPL-3.0-only
# config_loader.py - loads, checks and saves the pad's config.json (sent by SnekPad Studio).
# Copy this file to the root of CIRCUITPY (next to code.py).
#
# The app sends its config over the second serial port (CFG_BEGIN / CFG_LINE / CFG_END);
# app_profiles.py receives it and calls save() here. On the next boot code.py calls load()
# and build_profiles() to turn it into the same profile dicts the built-in profiles use.
# If the file is missing, damaged, or can't be built, code.py keeps the built-in profiles,
# so a bad config can never leave the pad unusable.
#
# Saving needs the drive hidden (boot.py storage=False). With the drive visible the filesystem
# belongs to the computer and the board can't write to it: replug without the top-left key.

import json
import os

from kmk.keys import KC
from kmk.modules.macros import Delay, Press, Release, Tap

try:
    import storage
except ImportError:
    storage = None

try:
    from binascii import crc32 as _crc32_fast
except ImportError:
    _crc32_fast = None

PATH = "/config.json"
TMP = "/config.json.tmp"       # complete new file, until it replaces PATH
SCHEMA_VERSION = 1
MAX_PROFILES = 4               # still accepted so a config saved by an older app loads; code.py runs the first 3 (+ the Studio slot)
KEYS = 12
MAX_BYTES = 24000              # bigger than any real config; guards RAM
DEFAULT_SLEEP_MINUTES = 2      # settings.sleepMinutes when the config has none (an older app)
MAX_SLEEP_MINUTES = 60
EFFECTS = ("static", "rainbow", "ripple", "starry", "equalizer", "beat")   # the same names as in rgb_keys.py
RETIRED_EFFECTS = ("breathing", "cycle")   # Studio no longer offers these; a config that still has one means static
DEFAULT_EFFECT = "static"      # settings.effect when the config has none (an older app)

MODS = {"CTRL": "LCTL", "SHIFT": "LSFT", "ALT": "LALT", "GUI": "LGUI"}

SUB_LAYERS = 1                 # extra 12-key layers a profile may have (profile["layers"]); reached with a "layer" key
MIN_TAP_MS = 100               # tap_hold: how long a press counts as a tap / how long the window for a second tap is
MAX_TAP_MS = 1000
DEFAULT_TAP_MS = 250
PLAIN = ("none", "key", "consumer", "hotkey", "text", "sequence")   # what a tap_hold's tap / hold / double may be


def crc32(data, value=0):
    """CRC-32 of data; pass the previous result as value to continue over more data."""
    if _crc32_fast is not None:
        return _crc32_fast(data, value) & 0xFFFFFFFF
    crc = value ^ 0xFFFFFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xEDB88320 if crc & 1 else crc >> 1
    return crc ^ 0xFFFFFFFF


# ---------------------------------------------------------------- receiving
class Receiver:
    """Writes CFG_LINE chunks straight into the temporary file and checks length + CRC at the end.

    The text never sits in RAM as one string: next to KMK and the OLED the pad has no free block
    big enough for a 5 KB config. The file is parsed from flash afterwards (load_received)."""

    def __init__(self, length, crc):
        if length <= 0 or length > MAX_BYTES:
            raise ValueError("config too large")
        self.length = length
        self.crc = crc
        self.size = 0
        self.run = 0            # CRC so far
        self.f = open(TMP, "w")

    def add(self, chunk):
        self.size += len(chunk)
        if self.size > self.length:
            raise ValueError("longer than announced")
        self.run = crc32(chunk.encode("utf-8"), self.run)
        self.f.write(chunk)

    def finish(self):
        self.f.close()
        self.f = None
        if self.size != self.length:
            raise ValueError("length mismatch")
        if "%08x" % self.run != self.crc:
            raise ValueError("crc mismatch")

    def abort(self):
        """Throw the partial file away (refused, damaged or abandoned transfer)."""
        try:
            if self.f is not None:
                self.f.close()
        except Exception:
            pass
        self.f = None
        try:
            os.remove(TMP)
        except OSError:
            pass


def load_received():
    """The config that Receiver wrote, parsed straight from the file."""
    with open(TMP) as f:
        return json.load(f)


def commit():
    """Replace config.json with the received file (which has been checked completely first)."""
    try:
        os.remove(PATH)
    except OSError:
        pass
    os.rename(TMP, PATH)
    try:
        os.sync()
    except Exception:
        pass


# ---------------------------------------------------------------- file
def can_save():
    return storage is None or not storage.getmount("/").readonly


def save(text):
    """Write the new file completely first, only then replace the old one."""
    if not can_save():
        raise OSError("drive is visible: replug without holding the top-left key")
    with open(TMP, "w") as f:
        f.write(text)
        f.flush()
    try:
        os.remove(PATH)
    except OSError:
        pass
    os.rename(TMP, PATH)
    try:
        os.sync()
    except Exception:
        pass


error = None    # why the saved file could not be used, if there is one but it is bad


def _read(path):
    global error
    try:
        with open(path) as f:
            cfg = json.load(f)
        check(cfg)
        return cfg
    except Exception as e:
        if not isinstance(e, OSError):     # OSError = no such file: nothing saved yet, not an error
            error = "bad config.json: " + str(e)
            print("config_loader:", path, "not usable:", e)
        return None


def load():
    """The saved config as a dict, or None. If power was lost between removing the old file
    and renaming the new one, the complete new file is still there as TMP. When there is a
    file but it can't be used, `error` says why (code.py shows it on the OLED)."""
    global error
    error = None
    cfg = _read(PATH)
    problem = error
    if cfg is None:
        error = None
        cfg = _read(TMP)
        error = None if cfg is not None else (problem or error)
    else:
        error = None
    return cfg


# ---------------------------------------------------------------- checking
def sleep_minutes(cfg):
    """Minutes of idle time before the screen and key LEDs switch off (0 = never). Missing = the default."""
    v = cfg["settings"].get("sleepMinutes", DEFAULT_SLEEP_MINUTES)
    if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v <= MAX_SLEEP_MINUTES:
        raise ValueError("sleepMinutes must be 0 to %d" % MAX_SLEEP_MINUTES)
    return v


def effect(cfg):
    """The key LED effect (one of EFFECTS). Missing = the default."""
    v = cfg["settings"].get("effect", DEFAULT_EFFECT)
    if v in RETIRED_EFFECTS:        # a pad that was set to one of these before they were taken out keeps its config
        return DEFAULT_EFFECT
    if v not in EFFECTS:
        raise ValueError("effect must be one of: " + ", ".join(EFFECTS))
    return v


def check(cfg):
    """Raises ValueError (or KeyError/TypeError) if the structure is not what the firmware needs."""
    if cfg["schema_version"] != SCHEMA_VERSION:
        raise ValueError("unknown schema_version")
    profiles = cfg["profiles"]
    if not 1 <= len(profiles) <= MAX_PROFILES:
        raise ValueError("1 to %d profiles" % MAX_PROFILES)
    if profiles[0]["id"] != "general":
        raise ValueError("first profile must be General")
    for p in profiles:
        if len(p["keys"]) != KEYS:
            raise ValueError("a profile needs %d keys" % KEYS)
        if not p["name"]:
            raise ValueError("profile without a name")
        p["match"]["windows"], p["match"]["macos"], p["match"]["titles"], p["encoder"]["cw"]
        subs = p.get("layers", [])
        if not isinstance(subs, list) or len(subs) > SUB_LAYERS:
            raise ValueError("a profile has at most %d extra layers" % SUB_LAYERS)
        for sub in subs:
            if len(sub["keys"]) != KEYS:
                raise ValueError("a layer needs %d keys" % KEYS)
        for k in p["keys"] + [k for sub in subs for k in sub["keys"]]:
            a = k.get("action")
            if a and a.get("type") == "layer" and not 1 <= a.get("layer", 0) <= len(subs):
                raise ValueError("a layer key points at a layer the profile does not have")
    cfg["settings"]["brightness"], cfg["device"]["owner_screen"]
    sleep_minutes(cfg)
    effect(cfg)


# ---------------------------------------------------------------- building
def _rgb(text):
    if len(text) != 7 or text[0] != "#":
        raise ValueError("bad colour " + text)
    return int(text[1:], 16)


def _kc(name):
    if name in MODS:
        name = MODS[name]
    try:
        return getattr(KC, name)
    except Exception:
        raise ValueError("unknown key " + name)


def _hold(keys):
    """Macro steps that press all the keys together, then release them."""
    ks = [_kc(k) for k in keys]
    if len(ks) == 1:
        return [Tap(ks[0])]
    return [Press(k) for k in ks] + [Release(k) for k in reversed(ks)]


def _combo(keys):
    """Modifiers + one key as a single KMK key, e.g. KC.LCTL(KC.LSFT(KC.P)). None if it needs a macro."""
    rest = [k for k in keys if k not in MODS]
    if len(rest) != 1:
        return None
    key = _kc(rest[0])
    for m in reversed([k for k in keys if k in MODS]):
        key = _kc(m)(key)
    return key


keyboard = None     # set by code.py (attach): tap_hold needs the HoldTap / TapDance modules, which are added on first use


def attach(kb):
    global keyboard
    keyboard = kb


def _need(name):
    """KC.HT / KC.TD exist only once their module is in the keyboard. Adds it the first time a config uses it,
    so a pad whose config has no tap_hold keeps the RAM."""
    try:
        return getattr(KC, name)
    except Exception:
        pass
    if keyboard is None:
        raise ValueError("no support for " + name)
    if name == "HT":
        from kmk.modules.holdtap import HoldTap as Mod
    else:
        from kmk.modules.tapdance import TapDance as Mod
    keyboard.modules.append(Mod())
    return getattr(KC, name)


def _plain(a):
    if a["type"] not in PLAIN:
        raise ValueError("not allowed inside tap_hold: " + a["type"])
    return _action(a)


def _tap_hold(a, ctx):
    ms = a.get("ms", DEFAULT_TAP_MS)
    if isinstance(ms, bool) or not isinstance(ms, int) or not MIN_TAP_MS <= ms <= MAX_TAP_MS:
        raise ValueError("ms must be %d to %d" % (MIN_TAP_MS, MAX_TAP_MS))
    tap = _plain(a["tap"])
    hold, double = a.get("hold"), a.get("double")
    if hold is None and double is None:
        raise ValueError("tap_hold needs a hold or a double")
    if hold is not None:
        # a hold may also be a layer key, which is how a key becomes "tap = X, hold = layer"
        hold = _action(hold, ctx) if hold["type"] == "layer" else _plain(hold)
        tap = _need("HT")(tap, hold, prefer_hold=False, tap_interrupted=False, tap_time=ms)
    if double is not None:
        tap = _need("TD")(tap, _plain(double), tap_time=ms)
    return tap


def _action(a, ctx=None):
    """ctx: {layer number: index of that layer in the keymap} for the profile this key belongs to.
    None where there are no layers (the Studio slot): a layer key is a dead key there."""
    t = a["type"]
    if t == "layer":
        if ctx is None or a["layer"] not in ctx:
            return KC.NO
        if a["mode"] == "hold":
            return KC.MO(ctx[a["layer"]])
        if a["mode"] == "toggle":
            return KC.TG(ctx[a["layer"]])
        raise ValueError("unknown layer mode " + str(a["mode"]))
    if t == "tap_hold":
        if ctx is None and keyboard is None:
            return KC.NO
        return _tap_hold(a, ctx)
    if t == "none" or t == "layer_next":
        return KC.NO
    if t == "fn":
        return "FN"
    if t == "key":
        return _kc(a["key"])
    if t == "consumer":
        return _kc(a["code"])
    if t == "hotkey":
        key = _combo(a["keys"])
        return key if key is not None else KC.MACRO(*_hold(a["keys"]))
    if t == "text":
        if a.get("enter"):
            return KC.MACRO(a["text"], Tap(KC.ENTER))
        return KC.MACRO(a["text"])
    if t == "sequence":
        steps = a["steps"]
        acts = []
        for i, st in enumerate(steps):
            acts.extend(_hold(st["keys"]))
            if i < len(steps) - 1 and st["wait"] > 0:
                acts.append(Delay(st["wait"]))
        return KC.MACRO(*acts)
    raise ValueError("unknown action " + t)


def build_profiles(cfg):
    """The same dicts as p_general() etc. in code.py. Raises if anything can't be built.

    A profile with extra layers also gets sub=[{keys, labels, colors}, ...]. The keymap is laid out as
    profiles, Studio slot, utility layer, and then the extra layers in profile order, so profile p's layer s
    is at index first_sub_layer(cfg) + (the extra layers of the profiles before p) + s - 1."""
    out = []
    nxt = len(cfg["profiles"]) + 2      # after the profiles, the Studio slot and the utility layer
    for p in cfg["profiles"]:
        m = p["match"]
        enc = p["encoder"]
        subs = p.get("layers", [])
        ctx = {}
        for i in range(len(subs)):
            ctx[i + 1] = nxt + i
        nxt += len(subs)
        out.append(dict(
            name=p["name"],
            # process names / bundle ids of both systems: the other system's names never match
            proc=tuple(s.lower() for s in m["windows"]) + tuple(s.lower() for s in m["macos"]),
            title=tuple(s.lower() for s in m["titles"]),
            keys=[_action(k["action"], ctx) for k in p["keys"]],
            labels=[k["label"] for k in p["keys"]],
            colors=[_rgb(k["color"]) for k in p["keys"]],
            # (turn left, turn right, short press, top-bar text, press label)
            knob=(_action(enc["ccw"]), _action(enc["cw"]), _action(enc["press"]),
                  enc["label"], enc.get("pressLabel", "")),
            sub=[dict(
                keys=[_action(k["action"], ctx) for k in sub["keys"]],
                labels=[k["label"] for k in sub["keys"]],
                colors=[_rgb(k["color"]) for k in sub["keys"]],
            ) for sub in subs],
        ))
    return out


class SlotBuilder:
    """The profile that SnekPad Studio sends for an app that has none of its own on the pad, built one line at a time.

    Studio keeps more profiles than the pad has room for and sends the one that fits the app in focus (SLOT_BEGIN,
    SLOT_KEY x 15, SLOT_END; see app_profiles.py). Each key is built as its line arrives, so the pad never holds the
    text of a whole profile. Keys 0-11 are the pad's keys (label, colour, action), 12-14 the knob (turn right, turn
    left, press; their label and colour are not used).

    A sequence is sent as {"type":"sequence"} (no steps) and then one SLOT_STEP line per step. Parsing all the steps as one
    block of JSON needs several KB of RAM for a moment, which the pad does not have; a step at a time needs next to
    nothing, and the macro is made when the next key (or the end) arrives."""

    COUNT = KEYS + 3

    def __init__(self, name, knob_text):
        self.name = name[:12] or "Studio"
        self.knob_text = knob_text[:10]
        self.keys = [None] * KEYS
        self.labels = [""] * KEYS
        self.colors = [0] * KEYS
        self.knob = [None] * 3
        self.got = 0
        self.seq = -1       # the key whose steps are arriving, -1 = none
        self.acts = None    # the macro steps so far
        self.wait = 0       # pause after the last step so far (only used if another step follows)

    def _store(self, index, action):
        if index < KEYS:
            if self.keys[index] is None:
                self.got += 1
            self.keys[index] = action
        else:
            if self.knob[index - KEYS] is None:
                self.got += 1
            self.knob[index - KEYS] = action

    def _end_seq(self):
        if self.seq >= 0:
            index, acts = self.seq, self.acts
            self.seq = -1
            self.acts = None
            if not acts:
                raise ValueError("empty sequence")
            self._store(index, KC.MACRO(*acts))

    def add(self, index, label, color, action_text):
        self._end_seq()
        if not 0 <= index < self.COUNT:
            raise ValueError("bad key number")
        a = json.loads(action_text)
        if a["type"] == "sequence" and "steps" not in a:
            if index >= KEYS:
                raise ValueError("no sequence on the knob")
            self.seq = index
            self.acts = []
            self.wait = 0
        else:
            self._store(index, _action(a))
        if index < KEYS:
            self.labels[index] = label[:5]
            self.colors[index] = _rgb(color)

    def step(self, index, keys, wait):
        """One step of the sequence that SLOT_KEY just announced: keys joined with '+', pause after it in ms."""
        if index != self.seq:
            raise ValueError("no sequence")
        pause = int(wait)
        if not 0 <= pause <= 2000:
            raise ValueError("bad pause")
        if self.wait:
            self.acts.append(Delay(self.wait))      # same rule as a pushed sequence: a pause only between steps
        self.acts.extend(_hold(keys.split("+")))
        self.wait = pause

    def finish(self):
        self._end_seq()
        if self.got != self.COUNT:
            raise ValueError("profile incomplete")
        return self


def level_for(brightness, levels):
    """Index of the brightness step closest to the app's 0.05-0.5 setting."""
    best = 0
    for i in range(len(levels)):
        if abs(levels[i] - brightness) < abs(levels[best] - brightness):
            best = i
    return best


# ---------------------------------------------------------------- brightness set on the pad
# The DIM / BRT keys change the LED brightness step. That choice is kept across a power-off in one byte of
# non-volatile memory (nvm[3]; nvm[0] to nvm[2] belong to the code.py stub and fw_boot.py), so the pad does not
# go back to the app's brightness every time the computer restarts. A byte that is not marked with LEVEL_MAGIC
# means "never changed on the pad": the app's setting (settings.brightness) is used. A config pushed from the
# app does not touch it, so a push never undoes a brightness chosen on the pad.
NVM_LEVEL = 3
LEVEL_MAGIC = 0xA0              # nvm[3] = LEVEL_MAGIC + step, anything else = not set


def saved_level(count):
    """The brightness step chosen with the keys on the pad (0 to count - 1), or None."""
    try:
        import microcontroller

        v = microcontroller.nvm[NVM_LEVEL] - LEVEL_MAGIC
        return v if 0 <= v < count else None
    except Exception:
        return None


def save_level(level):
    """Remember a step. Writes only when it differs: the memory is flash, which wears with every write."""
    try:
        import microcontroller

        v = LEVEL_MAGIC + level
        if microcontroller.nvm[NVM_LEVEL] != v:
            microcontroller.nvm[NVM_LEVEL] = v
    except Exception as e:
        print("brightness not saved:", e)
