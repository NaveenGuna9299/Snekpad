# SPDX-License-Identifier: GPL-3.0-only
# dev_tools.py - DEVELOPMENT ONLY tools for the desktop app's key test. NOT part of the customer firmware.
#
# This file is only built and written to the pad by `flash_pad.ps1 -Dev`. A normal (customer) flash does not
# build it and removes it from the pad, and code.py then uses the plain AppProfiles / EncoderModes.
#
# What it adds:
#   TEST            from the app, every second while its key test screen is open. For TEST_HOLD_S after the
#                   last one the pad still reports every key (EVT key) but types nothing on the computer,
#                   so testing a key cannot run its shortcut (Ctrl+W, Win+Shift+S, ...). If the app stops
#                   sending (closed, crashed, cable pulled) the keys come back by themselves.
#   EVT knob cw|ccw|press   every knob turn / press, also while the typing is muted.
#   HELLO reply gets a fourth field, "dev", so the app knows this pad has the tools.

import time

from app_profiles import AppProfiles
from encoder_modes import EncoderModes

TEST_HOLD_S = 3.0       # test mode lasts this long after each TEST line


class _NoTap:
    """Stands in for the keyboard while muted: everything works except typing a key."""

    def __init__(self, kb):
        self._kb = kb

    def __getattr__(self, name):
        return getattr(self._kb, name)

    def tap_key(self, key):
        pass


class DevAppProfiles(AppProfiles):
    def __init__(self, *args, **kwargs):
        AppProfiles.__init__(self, *args, **kwargs)
        self.test_until = 0         # test mode lasts until this time; the app's TEST lines keep extending it
        self._muted = set()         # keys whose press was not typed, so their release is not typed either

    def test_active(self):
        return time.monotonic() < self.test_until

    def report_knob(self, name):
        # EVT<TAB>knob<TAB>cw|ccw|press. Like key events it only goes out after HELLO.
        if self.events:
            self._queue_event("EVT\tknob\t%s\n" % name)

    def _hello_reply(self):
        return AppProfiles._hello_reply(self) + "\tdev"

    def _line(self, raw, now):
        if raw.rstrip(b"\r") == b"TEST":
            self.test_until = now + TEST_HOLD_S
            return
        AppProfiles._line(self, raw, now)

    def process_key(self, keyboard, key, is_pressed, int_coord):
        key = AppProfiles.process_key(self, keyboard, key, is_pressed, int_coord)   # held count + EVT key
        if int_coord is not None:
            # Test mode: swallow the press, and its release too (KMK would otherwise release a key it
            # never pressed). A key pressed before test mode began keeps its normal release.
            if is_pressed:
                if self.test_active():
                    self._muted.add(int_coord)
                    return None
                self._muted.discard(int_coord)
            elif int_coord in self._muted:
                self._muted.discard(int_coord)
                return None
        return key


class DevEncoderModes(EncoderModes):
    def __init__(self, *args, **kwargs):
        EncoderModes.__init__(self, *args, **kwargs)
        self.apps = None            # the DevAppProfiles: where knob events go and whether typing is muted

    def _muted(self):
        return self.apps is not None and self.apps.test_active()

    def _report(self, name):
        if self.apps is not None:
            try:
                self.apps.report_knob(name)     # a failing report must never break the knob
            except Exception as e:
                print("dev_tools knob report error:", e)
                self.apps = None

    def _turn(self, kb, d):
        self._report("ccw" if (d > 0) == self._reverse else "cw")   # the direction it acts on, as the base class does
        EncoderModes._turn(self, _NoTap(kb) if self._muted() else kb, d)

    def _press_down(self, kb):
        self._report("press")
        EncoderModes._press_down(self, _NoTap(kb) if self._muted() else kb)


print("dev_tools loaded (development flash)")
