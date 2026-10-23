# SPDX-License-Identifier: GPL-3.0-only
# Runs the pad's serial handling (app_profiles.py) on a normal Python, with fake CircuitPython and
# KMK modules, so the protocol can be checked without hardware:
#
#     python -m unittest discover -s Programs/tests -v
#
# It cannot prove anything about the real USB port or timing: that still needs a pad.

import os
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))


class FakeSerial:
    def __init__(self):
        self.incoming = b""
        self.out = b""
        self.connected = True
        self.out_waiting = 0
        self.write_timeout = None

    @property
    def in_waiting(self):
        return len(self.incoming)

    def read(self, n):
        data, self.incoming = self.incoming[:n], self.incoming[n:]
        return data

    def write(self, data):
        self.out += data
        return len(data)


SERIAL = FakeSerial()

usb_cdc = types.ModuleType("usb_cdc")
usb_cdc.data = SERIAL
supervisor = types.ModuleType("supervisor")
supervisor.reload = lambda: None
config_loader = types.ModuleType("config_loader")
kmk = types.ModuleType("kmk")
kmk_modules = types.ModuleType("kmk.modules")


class Module:
    pass


kmk_modules.Module = Module
for name, mod in (("usb_cdc", usb_cdc), ("supervisor", supervisor), ("config_loader", config_loader),
                  ("kmk", kmk), ("kmk.modules", kmk_modules)):
    sys.modules[name] = mod

import app_profiles  # noqa: E402  (needs the fake modules above)


class Keyboard:
    def __init__(self):
        self.active_layers = [0]


def make_pad():
    SERIAL.incoming = b""
    SERIAL.out = b""
    SERIAL.connected = True
    SERIAL.out_waiting = 0
    pad = app_profiles.AppProfiles([("General", [], []), ("Code", ["code"], []), ("Term", ["wt"], [])])
    kb = Keyboard()
    pad.during_bootup(kb)
    return pad, kb


def scan(pad, kb, n=1):
    for _ in range(n):
        pad._last_ms = -1000  # skip the 50 ms throttle (the next scan is then more than 50 ms after it)
        pad.before_matrix_scan(kb)


def feed(pad, kb, text):
    SERIAL.incoming += text.encode()
    scan(pad, kb)


def say_hello(pad, kb):
    """Complete the handshake, let the pad report its current profile, and start from clean output."""
    feed(pad, kb, "HELLO\n")
    scan(pad, kb, 2)
    SERIAL.out = b""


def sent():
    return SERIAL.out.decode()


class EventTests(unittest.TestCase):
    def test_nothing_is_reported_before_hello(self):
        pad, kb = make_pad()
        pad.process_key(kb, None, True, 3)
        kb.active_layers[-1] = 1
        scan(pad, kb, 3)
        self.assertEqual(sent(), "")

    def test_hello_is_answered_with_the_protocol_and_firmware_version(self):
        pad, kb = make_pad()
        feed(pad, kb, "HELLO\n")
        self.assertEqual(sent().split("\n")[0], "HELLO\t2\t%s" % app_profiles.FIRMWARE_VERSION)

    def test_firmware_version_is_x_y_z(self):
        parts = app_profiles.FIRMWARE_VERSION.split(".")
        self.assertEqual(len(parts), 3)
        self.assertTrue(all(p.isdigit() for p in parts))

    def test_the_customer_firmware_has_no_key_test_tools(self):
        # TEST, knob events and the dev flag live in dev/dev_tools.py, which a customer pad does not have
        pad, kb = make_pad()
        feed(pad, kb, "HELLO\n")
        self.assertNotIn("dev", sent().split("\n")[0].split("\t"))
        scan(pad, kb, 2)
        SERIAL.out = b""                # start from clean output, after the usual first profile report
        feed(pad, kb, "TEST\n")
        key = object()
        self.assertIs(pad.process_key(kb, key, True, 3), key)
        self.assertIs(pad.process_key(kb, key, False, 3), key)
        self.assertFalse(hasattr(pad, "test_active"))
        self.assertFalse(hasattr(pad, "report_knob"))
        self.assertEqual(sent(), "")

    def test_current_profile_is_reported_after_hello_then_only_on_change(self):
        pad, kb = make_pad()
        feed(pad, kb, "HELLO\n")
        scan(pad, kb, 2)
        self.assertEqual(sent().count("EVT\tlayer\t0\n"), 1)
        kb.active_layers[-1] = 2
        scan(pad, kb, 3)
        self.assertEqual(sent().count("EVT\tlayer\t2\n"), 1)
        self.assertEqual(sent().count("EVT\tlayer"), 2)

    def test_key_down_and_up(self):
        pad, kb = make_pad()
        say_hello(pad, kb)
        SERIAL.out = b""
        pad.process_key(kb, None, True, 5)
        pad.process_key(kb, None, False, 5)
        scan(pad, kb)
        self.assertEqual(sent(), "EVT\tkey\t5\t1\nEVT\tkey\t5\t0\n")

    def test_keys_without_a_matrix_position_or_out_of_range_are_ignored(self):
        pad, kb = make_pad()
        say_hello(pad, kb)
        SERIAL.out = b""
        pad.process_key(kb, None, True, None)
        pad.process_key(kb, None, True, 12)
        pad.process_key(kb, None, True, -1)
        scan(pad, kb)
        self.assertEqual(sent(), "")

    def test_the_queue_is_capped(self):
        pad, kb = make_pad()
        say_hello(pad, kb)
        for _ in range(100):
            pad.process_key(kb, None, True, 1)
        self.assertEqual(len(pad._evq), app_profiles.EVENT_QUEUE_MAX)

    def test_a_closed_port_stops_events_until_the_next_hello(self):
        pad, kb = make_pad()
        say_hello(pad, kb)
        SERIAL.connected = False
        SERIAL.out = b""
        pad.process_key(kb, None, True, 1)
        scan(pad, kb)
        self.assertEqual(sent(), "")
        self.assertFalse(pad.events)
        pad.process_key(kb, None, True, 2)  # no longer queued
        self.assertEqual(pad._evq, [])
        SERIAL.connected = True
        feed(pad, kb, "HELLO\n")
        self.assertTrue(pad.events)

    def test_a_host_that_does_not_read_gets_no_events(self):
        pad, kb = make_pad()
        say_hello(pad, kb)
        SERIAL.out = b""
        SERIAL.out_waiting = app_profiles.EVENT_BACKLOG + 1
        pad.process_key(kb, None, True, 1)
        scan(pad, kb)
        self.assertEqual(sent(), "")
        self.assertEqual(pad._evq, [])

    def test_events_wait_while_a_config_is_arriving(self):
        pad, kb = make_pad()
        say_hello(pad, kb)
        SERIAL.out = b""
        pad._rx = object()  # a transfer is in progress
        pad._rx_t = 1e12  # not timed out
        pad.process_key(kb, None, True, 4)
        pad._send_events()
        self.assertEqual(sent(), "")
        self.assertEqual(len(pad._evq), 1)
        pad._rx = None
        pad._send_events()
        self.assertEqual(sent(), "EVT\tkey\t4\t1\n")

    def test_a_failing_event_write_turns_events_off_but_not_the_pad(self):
        pad, kb = make_pad()
        say_hello(pad, kb)
        pad.process_key(kb, None, True, 1)

        def boom(_data):
            raise OSError("port gone")

        pad._write = boom
        scan(pad, kb)
        self.assertFalse(pad.events)
        self.assertTrue(pad.enabled)  # profile switching keeps running


class UnchangedBehaviour(unittest.TestCase):
    def test_ping_still_gets_pong_and_unknown_lines_are_ignored(self):
        pad, kb = make_pad()
        feed(pad, kb, "PING\nSOMETHING\tELSE\n")
        self.assertEqual(sent(), "PONG\n")

    def test_the_focused_app_still_switches_the_profile(self):
        pad, kb = make_pad()
        feed(pad, kb, "APP\tCode.exe\tmain.py\n")
        scan(pad, kb)
        self.assertEqual(kb.active_layers[-1], 1)

    def test_an_old_app_that_never_says_hello_gets_no_events(self):
        pad, kb = make_pad()
        feed(pad, kb, "APP\tCode.exe\tmain.py\n")
        pad.process_key(kb, None, True, 3)
        scan(pad, kb, 3)
        self.assertEqual(sent(), "")


class FakeLeds:
    """Stands in for RgbKeys: remembers the music numbers it was given."""

    def __init__(self, effect="equalizer"):
        self.effect = effect
        self.calls = []

    def music(self, *numbers):
        self.calls.append(numbers)


def make_music_pad(effect="equalizer", leds=True):
    SERIAL.incoming = b""
    SERIAL.out = b""
    SERIAL.connected = True
    SERIAL.out_waiting = 0
    fake = FakeLeds(effect) if leds else None
    pad = app_profiles.AppProfiles([("General", [], []), ("Code", ["code"], [])], leds=fake)
    kb = Keyboard()
    pad.during_bootup(kb)
    return pad, kb, fake


def music_line(*numbers):
    """What Studio sends: M and one character per number, 48 + the number."""
    return b"M" + bytes(48 + n for n in numbers) + b"\n"


class MusicLineTests(unittest.TestCase):
    def test_the_five_numbers_reach_the_lights(self):
        pad, kb, leds = make_music_pad()
        SERIAL.incoming += music_line(0, 12, 33, 63, 7)
        scan(pad, kb)
        self.assertEqual(leds.calls, [(0, 12, 33, 63, 7)])

    def test_several_lines_in_one_read_are_all_used_in_order(self):
        pad, kb, leds = make_music_pad()
        SERIAL.incoming += music_line(1, 1, 1, 1, 0) + music_line(2, 2, 2, 2, 0) + music_line(3, 3, 3, 3, 9)
        scan(pad, kb)
        self.assertEqual([c[0] for c in leds.calls], [1, 2, 3])
        self.assertEqual(leds.calls[-1][4], 9)

    def test_a_line_split_across_two_reads_is_put_together(self):
        pad, kb, leds = make_music_pad()
        line = music_line(5, 6, 7, 8, 9)
        SERIAL.incoming += line[:3]
        scan(pad, kb)
        self.assertEqual(leds.calls, [])
        SERIAL.incoming += line[3:]
        scan(pad, kb)
        self.assertEqual(leds.calls, [(5, 6, 7, 8, 9)])

    def test_the_numbers_are_not_answered_and_not_mistaken_for_other_commands(self):
        pad, kb, leds = make_music_pad()
        SERIAL.incoming += music_line(63, 63, 63, 63, 63)
        scan(pad, kb)
        self.assertEqual(sent(), "")

    def test_a_pad_without_lights_just_ignores_them(self):
        pad, kb, _ = make_music_pad(leds=False)
        SERIAL.incoming += music_line(10, 10, 10, 10, 10)
        scan(pad, kb)                                                   # no error

    def test_a_short_or_broken_line_is_ignored_and_the_pad_keeps_working(self):
        pad, kb, leds = make_music_pad()
        SERIAL.incoming += b"M12\n" + b"M\n"
        scan(pad, kb)
        self.assertEqual(leds.calls, [])
        SERIAL.incoming += b"PING\n"
        scan(pad, kb)
        self.assertEqual(sent(), "PONG\n")

    def test_the_port_is_read_faster_with_a_music_effect(self):
        self.assertEqual(make_music_pad("equalizer")[0]._poll_ms, 20)
        self.assertEqual(make_music_pad("beat")[0]._poll_ms, 20)
        self.assertEqual(make_music_pad("rainbow")[0]._poll_ms, 50)
        self.assertEqual(make_music_pad(leds=False)[0]._poll_ms, 50)

    def test_other_commands_still_work_next_to_the_music(self):
        pad, kb, leds = make_music_pad()
        SERIAL.incoming += music_line(1, 2, 3, 4, 5) + b"APP\tCode.exe\tmain.py\n"
        scan(pad, kb)
        self.assertEqual(len(leds.calls), 1)
        self.assertEqual(kb.active_layers[-1], 1)


class ReadSizeTests(unittest.TestCase):
    """During a firmware update the pad reads from its port a little at a time (its RAM is too small for more)."""

    def setUp(self):
        self.sizes = []
        self._read = SERIAL.read

        def recording(n):
            self.sizes.append(n)
            return self._read(n)

        SERIAL.read = recording
        self.addCleanup(lambda: setattr(SERIAL, "read", self._read))

    def test_a_pile_of_lines_is_read_in_small_pieces_while_an_update_is_running(self):
        pad, kb = make_pad()
        pad._fw = types.SimpleNamespace(state=2, tick=lambda now: None)       # an update is receiving
        SERIAL.incoming += b"PING\n" * 200                                      # 1000 bytes waiting at once
        scan(pad, kb, 10)
        self.assertTrue(self.sizes)
        self.assertLessEqual(max(self.sizes), app_profiles.READ_MAX_WHILE_UPDATING)
        self.assertEqual(SERIAL.out.count(b"PONG\n"), 200)                      # nothing lost: all of it was answered

    def test_normally_everything_waiting_is_read_at_once(self):
        pad, kb = make_pad()
        SERIAL.incoming += b"PING\n" * 100
        scan(pad, kb)
        self.assertEqual(self.sizes, [500])
        self.assertEqual(SERIAL.out.count(b"PONG\n"), 100)

    def test_a_line_longer_than_the_limit_still_arrives_whole(self):
        pad, kb = make_pad()
        pad._fw = types.SimpleNamespace(state=2, tick=lambda now: None)
        line = b"FW_DATA\t" + b"A" * 300 + b"\n"                                # longer than one read
        SERIAL.incoming += line + b"PING\n"
        scan(pad, kb, 10)
        self.assertEqual(SERIAL.out.count(b"PONG\n"), 1)

    def test_the_limit_is_small_enough_for_a_pad_with_a_few_kb_free(self):
        self.assertLessEqual(app_profiles.READ_MAX_WHILE_UPDATING, 192)
        self.assertGreaterEqual(app_profiles.READ_MAX_WHILE_UPDATING, 96)       # a whole data line (about 72 bytes) fits


if __name__ == "__main__":
    unittest.main()
