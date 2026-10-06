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
MAX_PROFILES = 4
KEYS = 12
MAX_BYTES = 24000              # bigger than any real config; guards RAM

MODS = {"CTRL": "LCTL", "SHIFT": "LSFT", "ALT": "LALT", "GUI": "LGUI"}


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
    cfg["settings"]["brightness"], cfg["device"]["owner_screen"]


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


def _action(a):
    t = a["type"]
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
    """The same dicts as p_general() etc. in code.py. Raises if anything can't be built."""
    out = []
    for p in cfg["profiles"]:
        m = p["match"]
        enc = p["encoder"]
        out.append(dict(
            name=p["name"],
            # process names / bundle ids of both systems: the other system's names never match
            proc=tuple(s.lower() for s in m["windows"]) + tuple(s.lower() for s in m["macos"]),
            title=tuple(s.lower() for s in m["titles"]),
            keys=[_action(k["action"]) for k in p["keys"]],
            labels=[k["label"] for k in p["keys"]],
            colors=[_rgb(k["color"]) for k in p["keys"]],
            # (turn left, turn right, short press, top-bar text, press label)
            knob=(_action(enc["ccw"]), _action(enc["cw"]), _action(enc["press"]),
                  enc["label"], enc.get("pressLabel", "")),
        ))
    return out


def level_for(brightness, levels):
    """Index of the brightness step closest to the app's 0.05-0.5 setting."""
    best = 0
    for i in range(len(levels)):
        if abs(levels[i] - brightness) < abs(levels[best] - brightness):
            best = i
    return best
