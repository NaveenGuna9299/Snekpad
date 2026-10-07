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
        pad._last_tick = 0  # skip the 50 ms throttle
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

    def test_hello_is_answered_with_the_version(self):
        pad, kb = make_pad()
        feed(pad, kb, "HELLO\n")
        self.assertTrue(sent().startswith("HELLO\t2\n"))

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


if __name__ == "__main__":
    unittest.main()
