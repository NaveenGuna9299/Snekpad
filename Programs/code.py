# SPDX-License-Identifier: GPL-3.0-only
# SnekPad firmware
# Board: Waveshare RP2040-Zero, CircuitPython 10.x + KMK
#
# Files on CIRCUITPY:  code.py  boot.py  oled_ui.py  app_profiles.py  rgb_keys.py  encoder_modes.py  kmk/  lib/
#
# Pin map (verify against Waveshare's pinout before ordering PCBs):
#   Matrix rows  GP0 GP1 GP2        Matrix cols  GP3 GP4 GP5 GP6   (COL2ROW)
#   Encoder      A=GP7  B=GP8  SW=GP9  (encoder_modes.py)
#   RGB data     GP10 (via level shifter)
#   OLED         SDA=GP14  SCL=GP15 (I2C1), address 0x3C
#   GP16 is the onboard LED: left alone.
#
# Layout: 3 rows x 4 columns = 12 keys. Key index = row * 4 + column.
#
# How the layers work: each PROFILE is one layer of 12 keys for one application.
# With the laptop helper running, the board switches to the profile of the
# focused window; anything it doesn't know gets "General".
# At most MAX_PROFILES profiles are kept in memory (General is always the first).

import gc
import os
import time

import board
import microcontroller

from kmk.kmk_keyboard import KMKKeyboard
from kmk.keys import KC
from kmk.modules import Module
from kmk.scanners import DiodeOrientation
from kmk.modules.layers import Layers
from kmk.modules.macros import Macros, Tap
from kmk.extensions.media_keys import MediaKeys

print("snekpad firmware starting")

# The profiles below are the built-in ones. If the app has sent a config (/config.json), that is used
# instead; if the file is missing or can't be built, the built-in profiles are used.
ENABLE_CONFIG = True
CFG = None
CONFIG_ERROR = None     # shown on the OLED at start-up when a saved config could not be used
if ENABLE_CONFIG:
    try:
        import config_loader

        CFG = config_loader.load()
        CONFIG_ERROR = config_loader.error
        print("config.json:", "loaded" if CFG else "none, using built-in profiles")
    except Exception as e:
        CONFIG_ERROR = "config: " + str(e)
        print("config.json ignored:", e)

# ---------------------------------------------------------------- settings
# Optional owner screen shown on the OLED when the pad is idle. Leave both
# names empty ("") to switch it off.
OWNER_LINE_1 = ""
OWNER_LINE_2 = ""
OWNER_DATE = ""

MAX_PROFILES = 4               # memory limit: General + up to 3 more (a 5th is ignored)

ENCODER_REVERSE = False        # True if the knob turns the wrong way
ENCODER_DIVISOR = 4            # raw pulses per click; 2 if a click needs two turns, 1 if it skips

ENABLE_ENCODER = True
ENABLE_OLED = True
ENABLE_RGB = True
ENABLE_APP_PROFILES = True     # needs boot.py + the SnekPad desktop app (or focus_sender.py) running
ENABLE_WATCHDOG = True         # reset the pad if the main loop stops for WATCHDOG_S seconds
WATCHDOG_S = 5.0               # the RP2040 allows up to about 8 s
TRIAL_OK_S = 15                # a firmware just installed from the app is kept once it has run this long (see fw_boot.py)

if CFG:   # owner screen from the app (the OLED size stays a hardware setting below)
    try:
        OWNER_LINE_1 = CFG["device"]["owner_screen"]["line1"]
        OWNER_LINE_2 = CFG["device"]["owner_screen"]["line2"]
        OWNER_DATE = CFG["device"]["owner_screen"]["date"]
    except Exception as e:
        print("config owner screen ignored:", e)

OLED_HEIGHT = 32               # the 0.91" 128x32 screen on the PCB
OLED_ROTATION = 0              # 180 if the screen turns out to be upside down
SLEEP_MINUTES = 2              # idle minutes before the screen and key LEDs switch off; 0 = never. The app's setting
                               # (settings.sleepMinutes in config.json, set in SnekPad Studio) overrides this default.
if CFG:
    try:
        SLEEP_MINUTES = config_loader.sleep_minutes(CFG)
    except Exception as e:
        print("config sleepMinutes ignored:", e)
OLED_OFF_S = SLEEP_MINUTES * 60 if SLEEP_MINUTES else 1000000000    # the screen really switches off, the LEDs with it
OLED_DIM_S = OLED_OFF_S // 2   # half way there, the screen dims and the LEDs drop to their lowest step
RGB_START_LEVEL = 3            # 0-4 index into LEVELS in rgb_keys.py (3 = 40% brightness)

# ---------------------------------------------------------------- keyboard
keyboard = KMKKeyboard()
keyboard.col_pins = (board.GP3, board.GP4, board.GP5, board.GP6)
keyboard.row_pins = (board.GP0, board.GP1, board.GP2)
keyboard.diode_orientation = DiodeOrientation.COL2ROW

# Modules and extensions must exist before KC.MO / KC.MACRO / KC.VOLD / KC.LED_* are used below.
layers = Layers()
macros = Macros()
keyboard.modules = [layers, macros]
keyboard.extensions.append(MediaKeys())

# Per-key RGB: created now so KC.LED_TOG / LED_DIM / LED_BRT exist for the utility layer.
leds = None
if ENABLE_RGB:
    from rgb_keys import RgbKeys, LEVELS

    if CFG:
        try:
            RGB_START_LEVEL = config_loader.level_for(CFG["settings"]["brightness"], LEVELS)
        except Exception as e:
            print("config brightness ignored:", e)
    leds = RgbKeys(board.GP10, level=RGB_START_LEVEL)
    keyboard.modules.append(leds)


# ---------------------------------------------------------------- helpers
# Each helper falls back to a dead key (and prints why) if the macro API
# differs in your KMK version, so one bad macro can't stop the whole file loading.
def txt(s):
    """Type text, no Enter (cursor stays so you can review or finish it)."""
    try:
        return KC.MACRO(s)
    except Exception as e:
        print("macro error:", e)
        return KC.NO


def cmd(s):
    """Type text then press Enter."""
    try:
        return KC.MACRO(s, Tap(KC.ENTER))
    except Exception as e:
        print("macro error:", e)
        return KC.NO


def seq(*actions):
    """Press a sequence of keys, e.g. seq(Tap(KC.ESC), Tap(KC.A))."""
    try:
        return KC.MACRO(*actions)
    except Exception as e:
        print("macro error:", e)
        return KC.NO


def C(k):
    return KC.LCTL(k)


def CS(k):
    return KC.LCTL(KC.LSFT(k))


# ---------------------------------------------------------------- colours
OFF = 0x000000
RED = 0xFF2020
ORANGE = 0xFF7000
YELLOW = 0xFFC000
GREEN = 0x00E060
CYAN = 0x00C8C8
BLUE = 0x2060FF
PURPLE = 0xA040FF
PINK = 0xFF40A0
WHITE = 0xC0C0C0
DIM = 0x303030

# ---------------------------------------------------------------- profiles
# Each profile is a dict:
#   name    shown on the OLED when the app matches
#   proc    process names that select it (lower case, no .exe; trailing * = starts with)
#   title   words in the window title that select it
#   keys    12 keys, row by row (3 rows x 4 columns). "FN" = hold for the utility layer
#   labels  12 short labels (5 characters max) for the on-screen legend
#   colors  12 key colours, 0xRRGGBB, same order as keys
#   knob    (turn left, turn right, press, top-bar text, press label)
#           the press label is kept for the app's config but no longer shown on the pad.
# Profile 0 must be General: it has no matches and is used for every other app.

def p_general():
    return dict(
        name="General", proc=(), title=(),
        keys=[C(KC.C), C(KC.V), C(KC.X), C(KC.Z),
              C(KC.Y), C(KC.A), C(KC.S), C(KC.F),
              C(KC.T), C(KC.W), KC.LGUI(KC.LSFT(KC.S)), "FN"],
        labels=["copy", "paste", "cut", "undo", "redo", "all", "save", "find",
                "tab+", "close", "snip", "FN"],
        colors=[BLUE, BLUE, BLUE, ORANGE,
                ORANGE, CYAN, GREEN, CYAN,
                PURPLE, RED, YELLOW, DIM],
        knob=(KC.VOLD, KC.VOLU, KC.MUTE, "KNOB:VOL", "MUTE"),
    )


def p_vscode():
    return dict(
        name="VS Code", proc=("code", "cursor"), title=(),
        keys=[C(KC.P), CS(KC.P), C(KC.GRV), C(KC.B),
              C(KC.SLSH), KC.F12, CS(KC.F), KC.F5,
              C(KC.S), C(KC.Z), KC.LSFT(KC.LALT(KC.F)), "FN"],
        labels=["open", "cmd", "term", "side", "cmnt", "def", "find", "debug",
                "save", "undo", "fmt", "FN"],
        colors=[CYAN, CYAN, PURPLE, PURPLE,
                YELLOW, BLUE, BLUE, GREEN,
                GREEN, ORANGE, PINK, DIM],
        knob=(C(KC.PGUP), C(KC.PGDN), C(KC.S), "KNOB:TAB", "SAVE"),
    )


def p_terminal():
    return dict(
        name="Terminal",
        proc=("windowsterminal", "wt", "powershell", "pwsh", "cmd", "mintty", "git-bash", "conhost"),
        title=(),
        keys=[C(KC.C), C(KC.L), seq(Tap(KC.UP), Tap(KC.ENTER)), C(KC.R),
              cmd("git status"), cmd("git pull"), txt("git push"), txt('git commit -m "'),
              cmd("npm run dev"), cmd("npm test"), cmd("python"), "FN"],
        labels=["^C", "clear", "rerun", "hist", "stat", "pull", "push", "comm",
                "dev", "test", "py", "FN"],
        colors=[RED, YELLOW, ORANGE, PURPLE,
                GREEN, GREEN, CYAN, CYAN,
                BLUE, BLUE, PINK, DIM],
        knob=(KC.LSFT(KC.PGUP), KC.LSFT(KC.PGDN), KC.ENTER, "KNOB:SCRL", "ENTER"),
    )


def p_browser():
    return dict(
        name="Browser", proc=("chrome", "msedge", "firefox", "brave", "opera", "vivaldi"), title=(),
        keys=[KC.F12, KC.F5, CS(KC.R), CS(KC.C),
              CS(KC.J), C(KC.T), C(KC.W), CS(KC.T),
              C(KC.L), KC.LALT(KC.LEFT), KC.LALT(KC.RIGHT), "FN"],
        labels=["tools", "reld", "hard", "insp", "cons", "tab+", "close", "reopn",
                "url", "back", "fwd", "FN"],
        colors=[PURPLE, GREEN, GREEN, CYAN,
                CYAN, BLUE, RED, ORANGE,
                YELLOW, WHITE, WHITE, DIM],
        knob=(C(KC.PGUP), C(KC.PGDN), KC.MPLY, "KNOB:TAB", "PLAY"),
    )


# Order = layer number. The first profile must be General.
# Add more p_*() functions above and list them here; only MAX_PROFILES are used.
PROFILES = None
if CFG:
    try:
        PROFILES = config_loader.build_profiles(CFG)
        print("profiles from config.json:", len(PROFILES))
    except Exception as e:
        print("config.json can't be built, using built-in profiles:", e)
        CONFIG_ERROR = "can't build: " + str(e)
        PROFILES = None
CFG = None      # free the memory
if PROFILES is None:
    PROFILES = [p_general(), p_vscode(), p_terminal(), p_browser()]
if len(PROFILES) > MAX_PROFILES:
    print("only", MAX_PROFILES, "profiles fit in memory, ignoring", len(PROFILES) - MAX_PROFILES)
    PROFILES = PROFILES[:MAX_PROFILES]

N = len(PROFILES)
UTIL_LAYER = N                 # the utility layer sits after the last profile
FN = KC.MO(UTIL_LAYER)         # hold the bottom-right key for the utility layer

# Utility layer: bootloader, reload, LED controls, jump to a layer.
# Bootloader needs bottom-right held + top-left pressed, so it can't happen by accident.
if ENABLE_RGB:
    led_keys = [KC.LED_TOG, KC.LED_DIM, KC.LED_BRT]
else:
    led_keys = [KC.NO] * 3

UTILITY_KEYS = [
    KC.BOOTLOADER, KC.RELOAD, led_keys[0], led_keys[1],
    led_keys[2], KC.NO, KC.NO, KC.NO,
    KC.NO, KC.TO(0), KC.TO(1), KC.TRNS,
]
UTILITY_LABELS = ["BOOT", "RELD", "LED", "DIM", "BRIT", "", "", "",
                  "", "L0", "L1", ""]
UTILITY_COLORS = [RED, ORANGE, GREEN, WHITE,
                  WHITE, OFF, OFF, OFF,
                  OFF, CYAN, CYAN, DIM]

keymap = []
LABELS = []
LAYER_NAMES = []
KNOB_TEXT = []
ENC_MAP = []
COLORS = []
for i, p in enumerate(PROFILES):
    keymap.append([FN if k == "FN" else k for k in p["keys"]])
    LABELS.append(p["labels"])
    COLORS.append(p["colors"])
    LAYER_NAMES.append(p["name"])
    left, right, press, text, _ = p["knob"]   # the press label is no longer shown on the pad
    KNOB_TEXT.append(text)
    ENC_MAP.append((left, right, press))

keymap.append(UTILITY_KEYS)
LABELS.append(UTILITY_LABELS)
COLORS.append(UTILITY_COLORS)
LAYER_NAMES.append("UTILITY")
KNOB_TEXT.append("KNOB:-")
ENC_MAP.append((KC.NO, KC.NO, KC.NO))

keyboard.keymap = keymap

# ---------------------------------------------------------------- development tools
# dev_tools.py exists on the pad only after a development flash (flash_pad.ps1 -Dev): it adds what the
# desktop app's key test needs (the TEST command, knob events). A customer pad does not have the file,
# so nothing on the computer can silence its keys through the serial port.
try:
    import dev_tools
except ImportError:
    dev_tools = None

# ---------------------------------------------------------------- encoder
# Idle (first touch only wakes the screen), then turn = the profile's knob action and
# press = the profile's press action. Per layer: (turn left, turn right, press). See encoder_modes.py.
encoder = None
if ENABLE_ENCODER:
    from encoder_modes import EncoderModes

    if dev_tools is not None:
        EncoderModes = dev_tools.DevEncoderModes
    encoder = EncoderModes(
        board.GP7, board.GP8, board.GP9,
        actions=ENC_MAP,
        reverse=ENCODER_REVERSE,
        divisor=ENCODER_DIVISOR,
    )
    keyboard.modules.append(encoder)

# ---------------------------------------------------------------- RGB
if ENABLE_RGB:
    leds.set_colors(COLORS)
    leds.profile_layers = N         # a colour flash when the profile changes (not for the utility layer)

# ---------------------------------------------------------------- focused app
apps = None
if ENABLE_APP_PROFILES:
    from app_profiles import AppProfiles

    if dev_tools is not None:
        AppProfiles = dev_tools.DevAppProfiles

    def live_view():
        """What the pad shows right now, for the app's GET_CFG: per profile name, knob text, labels, colours."""
        import json

        profs = []
        for i in range(N):   # the utility layer is not a profile
            profs.append({
                "n": LAYER_NAMES[i],
                "k": KNOB_TEXT[i],
                "l": LABELS[i],
                "c": ["#%06x" % c for c in COLORS[i]],   # COLORS is what the LEDs show (set_key changes it in place)
            })
        return json.dumps({"h": OLED_HEIGHT, "s": SLEEP_MINUTES, "p": profs})

    apps = AppProfiles([(p["name"], p["proc"], p["title"]) for p in PROFILES], general=0, view=live_view, leds=leds)
    keyboard.modules.append(apps)
    if dev_tools is not None and encoder is not None:
        encoder.apps = apps     # knob events and the key test's silence
    apps.encoder = encoder      # the knob press that allows a firmware update

# ---------------------------------------------------------------- OLED
# Screens live in oled_ui.py (128x32). Needs adafruit_display_text and
# adafruit_displayio_ssd1306 in CIRCUITPY/lib (10.x bundle).
if ENABLE_OLED:
    from oled_ui import OledUI

    oled = OledUI(
        labels=LABELS,
        layer_names=LAYER_NAMES,
        knob_text=KNOB_TEXT,
        sda=board.GP14,
        scl=board.GP15,
        names=(OWNER_LINE_1, OWNER_LINE_2),
        date=OWNER_DATE,
        width=128,
        height=OLED_HEIGHT,
        rotation=OLED_ROTATION,
        dim_s=OLED_DIM_S,
        off_s=OLED_OFF_S,
        app=apps,
        notice=("CONFIG: " + CONFIG_ERROR) if CONFIG_ERROR else None,
    )
    keyboard.modules.append(oled)
    if encoder is not None:
        encoder.ui = oled
    if ENABLE_RGB:
        leds.ui = oled              # the key LEDs dim and switch off with the screen
    if apps is not None:
        apps.ui = oled      # refused config pushes show up on the screen

# ---------------------------------------------------------------- watchdog
class Heartbeat(Module):
    """Feeds the hardware watchdog on every pass of the main loop, so a frozen pad resets itself.
    After a minute of running normally it also clears the crash counter the code.py stub keeps in nvm.

    Off while developing: the watchdog can't be stopped once it is on, and it would reset the pad
    while you are at the console. It stays off if the file /nowatchdog exists or the drive is visible."""

    def __init__(self, timeout):
        self._timeout = timeout
        self._wdt = None
        self._t0 = time.monotonic()
        self._stable = False
        self._trial = False     # a firmware update installed at this start is on trial until it has run for a while

    def _dev_mode(self):
        try:
            os.stat("/nowatchdog")
            return True
        except OSError:
            pass
        try:
            import storage

            return storage.getmount("/").readonly   # the computer owns the drive
        except Exception:
            return False

    def during_bootup(self, keyboard):
        try:
            os.stat("/fw_try")
            self._trial = True
        except OSError:
            pass
        try:
            if self._dev_mode():
                print("watchdog off (dev mode)")
                return
            import watchdog

            w = microcontroller.watchdog
            w.timeout = self._timeout
            w.mode = watchdog.WatchDogMode.RESET
            self._wdt = w
            print("watchdog on:", self._timeout, "s")
        except Exception as e:
            print("watchdog error:", e)

    def before_matrix_scan(self, keyboard):
        if self._wdt is not None:
            self._wdt.feed()
        if self._trial and time.monotonic() - self._t0 > TRIAL_OK_S:
            self._trial = False
            try:
                os.remove("/fw_try")            # the new firmware ran fine: fw_boot keeps it
                microcontroller.nvm[2] = 0
                print("firmware update accepted")
            except Exception as e:
                print("fw_try:", e)
        if not self._stable and time.monotonic() - self._t0 > 60:
            self._stable = True
            try:
                microcontroller.nvm[0] = 0
            except Exception:
                pass
        return None

    def process_key(self, keyboard, key, is_pressed, int_coord):
        return key

    def after_matrix_scan(self, keyboard):
        return None

    def before_hid_send(self, keyboard):
        return None

    def after_hid_send(self, keyboard):
        return None

    def on_powersave_enable(self, keyboard):
        return None

    def on_powersave_disable(self, keyboard):
        return None


if ENABLE_WATCHDOG:
    keyboard.modules.append(Heartbeat(WATCHDOG_S))    # last, so it arms once everything else is up

# ---------------------------------------------------------------- go
gc.collect()
print("layers:", N + 1, "free RAM:", gc.mem_free())

if __name__ == "__main__":
    keyboard.go()
