# SPDX-License-Identifier: GPL-3.0-only
# fw_update.py: receiving a firmware update over the data serial port. It must only stage files, check every
# one, require the knob press, and throw everything away on any problem.
#
#     python -m unittest discover -s Programs/tests -v

import base64
import binascii
import os
import shutil
import sys
import tempfile
import types
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

# reuses the fake CircuitPython / KMK modules and the fake serial port from the firmware tests
import test_app_profiles_events as base  # noqa: E402,F401
from test_app_profiles_events import Keyboard, SERIAL, app_profiles, feed, make_pad, scan, sent  # noqa: E402

# fw_update uses config_loader.crc32 / can_save: give whatever fake is in sys.modules the real behaviour
_cl = sys.modules.setdefault("config_loader", types.ModuleType("config_loader"))
_cl.crc32 = lambda data, value=0: binascii.crc32(data, value) & 0xFFFFFFFF
_cl.can_save = lambda: True

import fw_boot  # noqa: E402
import fw_update  # noqa: E402

FILES = {
    "firmware.mpy": b"NEW-FIRMWARE-" + bytes(range(256)) * 3,
    "rgb_keys.mpy": b"NEW-RGB" * 40,
    "fw_update.mpy": b"NEW-UPDATER",
}
OLD_FILES = {"firmware.mpy": "OLD-A", "rgb_keys.mpy": "OLD-B", "config.json": "{mine}"}
CHUNK = 96


def crc(data):
    return "%08x" % (binascii.crc32(data) & 0xFFFFFFFF)


def parts(line):
    return line.split("\t")


class FakeUi:
    """The screen. suspended=True is the real pad's state during an update: the normal page was freed, only
    the small show_refused page can be shown."""

    def __init__(self, suspended=False):
        self.suspended = suspended
        self.notices = []
        self.refused = []
        self.calls = []
        self.cleared = 0

    def suspend(self):
        self.calls.append("suspend")
        self.suspended = True

    def show_refused(self, text, title="", footer=""):
        self.refused.append((title, text, footer))

    def show_notice(self, text, title="", footer="", seconds=None):
        self.notices.append((title, text, footer, seconds))

    def clear_notice(self):
        self.cleared += 1


class FakeEncoder:
    press_hook = None

    def press(self):
        """What EncoderModes does on a press: the hook may take it."""
        return self.press_hook is not None and self.press_hook()


class FakeHost:
    def __init__(self):
        self.out = []
        self.ui = FakeUi()
        self.encoder = FakeEncoder()
        self._rx = None
        self._reload_at = None

    def _write(self, data):
        self.out.append(data)

    def replies(self):
        return "".join(self.out).split("\n")[:-1]


class UpdateTestCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="fwupd_")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.saved_root = fw_boot.ROOT
        fw_boot.ROOT = self.dir
        self.addCleanup(setattr, fw_boot, "ROOT", self.saved_root)
        for name, content in OLD_FILES.items():
            self.write(name, content)
        patches = [
            mock.patch.object(fw_update, "_cp_version", lambda: "10.3.1"),
            mock.patch.object(fw_update, "_free", lambda: 1000000),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.can_save = True
        _cl.can_save = lambda: self.can_save
        self.host = FakeHost()
        self.up = fw_update.Updater(self.host, "0.3.3")
        self.addCleanup(self.up.abort)          # closes a file left open, before the folder is deleted
        self.now = 100.0

    def write(self, name, text):
        full = os.path.join(self.dir, name.replace("/", os.sep))
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w") as f:
            f.write(text)

    def read(self, name, binary=False):
        with open(os.path.join(self.dir, name.replace("/", os.sep)), "rb" if binary else "r") as f:
            return f.read()

    def has(self, name):
        return os.path.exists(os.path.join(self.dir, name.replace("/", os.sep)))

    # -- driving the receiver ----------------------------------------------------------
    def cmd(self, line, advance=0.01):
        self.now += advance
        self.up.handle(parts(line), self.now)

    def tick(self, seconds=0.05):
        self.now += seconds
        self.up.tick(self.now)

    def last(self):
        return self.host.replies()[-1] if self.host.replies() else None

    def begin(self, version="0.4.0", files=None, total=None, cp="10.3.1"):
        files = FILES if files is None else files
        total = sum(len(v) for v in files.values()) if total is None else total
        self.cmd("FW_BEGIN\t%s\t%d\t%d\t%s" % (version, len(files), total, cp))

    def confirm(self):
        self.assertTrue(self.host.encoder.press())      # the knob press the pad waits for
        self.tick()

    def begin_confirmed(self, **kw):
        self.begin(**kw)
        self.confirm()
        self.assertEqual(self.last(), "OK")

    def send_file(self, name, data=None, size=None, crc_hex=None, chunk=CHUNK):
        data = FILES[name] if data is None else data
        self.cmd("FW_FILE\t%s\t%d\t%s" % (name, len(data) if size is None else size, crc_hex or crc(data)))
        self.assertEqual(self.last(), "OK")
        for i in range(0, len(data), chunk):
            self.cmd("FW_DATA\t" + base64.b64encode(data[i:i + chunk]).decode())
        self.cmd("FW_FILE_END")

    def send_all(self):
        for name in FILES:
            self.send_file(name)
            self.assertEqual(self.last(), "OK", name)

    def assert_nothing_staged_or_changed(self):
        self.assertFalse(self.has("fw_new"))
        self.assertFalse(self.has("fw_apply"))
        self.assertEqual({n: self.read(n) for n in OLD_FILES}, OLD_FILES)
        self.assertEqual(self.up.state, fw_update.IDLE)
        self.assertIsNone(self.host.encoder.press_hook)


class InfoTests(unittest.TestCase):
    """FW_INFO is answered by app_profiles itself, never by loading the updater: the pad has no RAM to spare for that
    (loading it just to say which firmware is running failed on the real pad)."""

    FREE = 4096 * 250

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="fwinfo_")
        self.addCleanup(shutil.rmtree, self.dir, True)
        saved = app_profiles.FS_ROOT
        app_profiles.FS_ROOT = self.dir
        self.addCleanup(setattr, app_profiles, "FS_ROOT", saved)
        for p in (
            mock.patch.object(os, "statvfs", lambda path: (4096, 4096, 1000, 250, 250, 0, 0, 0, 0, 255), create=True),
            mock.patch.object(sys.implementation, "version", (10, 3, 1)),
        ):
            p.start()
            self.addCleanup(p.stop)
        sys.modules.pop("fw_update", None)
        self.pad, self.kb = make_pad()
        self.pad.ui = FakeUi()
        self.pad.encoder = FakeEncoder()

    def lines(self):
        return sent().split("\n")[:-1]

    def test_reports_versions_and_free_space(self):
        feed(self.pad, self.kb, "FW_INFO\n")
        self.assertEqual(self.lines(), ["FW_INFO\t%s\t10.3.1\t%d\t-" % (app_profiles.FIRMWARE_VERSION, self.FREE)])

    def test_reports_why_the_last_update_was_undone_once(self):
        with open(os.path.join(self.dir, "fw_failed"), "w") as f:
            f.write("new firmware did not start\n")
        feed(self.pad, self.kb, "FW_INFO\n")
        self.assertTrue(self.lines()[-1].endswith("\t%d\tnew firmware did not start" % self.FREE))
        self.assertFalse(os.path.exists(os.path.join(self.dir, "fw_failed")))
        feed(self.pad, self.kb, "FW_INFO\n")
        self.assertTrue(self.lines()[-1].endswith("\t-"))

    def test_the_reason_is_made_safe_for_the_wire(self):
        with open(os.path.join(self.dir, "fw_failed"), "w") as f:
            f.write("bad\tstuff é " + "x" * 100 + "\n")
        feed(self.pad, self.kb, "FW_INFO\n")
        reason = self.lines()[-1].split("\t", 4)[4]
        self.assertEqual(self.lines()[-1].count("\t"), 4)       # the tab in the reason did not add a field
        self.assertLessEqual(len(reason), 60)
        self.assertTrue(all(" " <= c <= "~" for c in reason))

    def test_it_never_loads_the_updater_and_leaves_the_screen_alone(self):
        feed(self.pad, self.kb, "FW_INFO\n")
        self.assertNotIn("fw_update", sys.modules)
        self.assertIsNone(self.pad._fw)
        self.assertEqual(self.pad.ui.calls, [])
        self.assertIsNone(self.pad._reload_at)

    def test_it_changes_nothing_on_the_pad(self):
        open(os.path.join(self.dir, "firmware.mpy"), "w").write("X")
        feed(self.pad, self.kb, "FW_INFO\n")
        self.assertEqual(sorted(os.listdir(self.dir)), ["firmware.mpy"])

    def test_it_works_without_a_filesystem_to_ask(self):
        with mock.patch.object(os, "statvfs", side_effect=OSError("no"), create=True):
            feed(self.pad, self.kb, "FW_INFO\n")
        self.assertTrue(self.lines()[-1].startswith("FW_INFO\t"))
        self.assertEqual(self.lines()[-1].split("\t")[3], "0")


class BeginTests(UpdateTestCase):
    def err(self):
        self.assertTrue(self.last().startswith("ERR\t"), self.last())
        return self.last()

    def test_waits_for_the_knob_and_says_nothing_yet(self):
        self.begin()
        self.assertEqual(self.host.replies(), [])
        self.assertEqual(self.up.state, fw_update.CONFIRM)
        self.assertTrue(self.has("fw_new"))
        title, text, _, seconds = self.host.ui.notices[-1]
        self.assertIn("UPDATE", title)
        self.assertIn("knob", text)
        self.assertGreater(seconds, fw_update.CONFIRM_S)

    def test_the_knob_press_allows_it_and_is_not_typed(self):
        self.begin()
        self.assertTrue(self.host.encoder.press())      # consumed by the prompt
        self.tick()
        self.assertEqual(self.last(), "OK")
        self.assertEqual(self.up.state, fw_update.RECEIVING)
        self.assertFalse(self.host.encoder.press())     # the hook is gone: presses type normally again

    def test_nothing_is_allowed_without_the_press(self):
        self.begin()
        for _ in range(int(fw_update.CONFIRM_S) + 5):
            self.tick(1.0)
            if self.up.state == fw_update.IDLE:
                break
        self.assertEqual(self.last(), "ERR\tnot confirmed on the pad")
        self.assert_nothing_staged_or_changed()

    def test_no_data_is_accepted_before_the_press(self):
        self.begin()
        self.cmd("FW_FILE\tfirmware.mpy\t5\t00000000")
        self.assertEqual(self.last(), "ERR\tno update in progress")

    def test_refused_while_a_config_is_arriving(self):
        self.host._rx = object()
        self.begin()
        self.assertEqual(self.err(), "ERR\tbusy")

    def test_refused_when_the_drive_is_visible(self):
        self.can_save = False
        self.begin()
        self.assertIn("drive is visible", self.err())
        self.assert_nothing_staged_or_changed()

    def test_refused_for_another_circuitpython_version(self):
        self.begin(cp="9.2.0")
        self.assertIn("needs CircuitPython 9.2.0", self.err())
        self.assert_nothing_staged_or_changed()

    def test_refused_when_the_flash_is_too_full(self):
        with mock.patch.object(fw_update, "_free", lambda: 1000):
            self.begin()
        self.assertEqual(self.err(), "ERR\tnot enough free space")

    def test_refused_while_the_last_update_is_still_on_trial(self):
        self.write("fw_try", "0.3.9")
        self.begin()
        self.assertIn("still being checked", self.err())

    def test_refused_without_a_knob_to_confirm_with(self):
        self.host.encoder = None
        self.begin()
        self.assertIn("no knob", self.err())

    def test_refused_for_nonsense(self):
        for line in ("FW_BEGIN", "FW_BEGIN\t0.4.0\tx\t10\t10.3.1", "FW_BEGIN\tv1\t1\t10\t10.3.1",
                     "FW_BEGIN\t0.4.0\t0\t10\t10.3.1", "FW_BEGIN\t0.4.0\t1\t0\t10.3.1",
                     "FW_BEGIN\t0.4.0\t99\t10\t10.3.1", "FW_BEGIN\t0.4.0\t1\t99999999\t10.3.1"):
            self.cmd(line)
            self.assertTrue(self.last().startswith("ERR\t"), line)
            self.assertEqual(self.up.state, fw_update.IDLE, line)

    def test_a_second_begin_while_one_is_running_is_refused(self):
        self.begin()
        self.begin()
        self.assertEqual(self.err(), "ERR\tbusy")

    def test_an_old_backup_is_cleared_and_live_files_are_untouched(self):
        self.write("fw_old/firmware.mpy", "ancient")
        self.begin()
        self.assertFalse(self.has("fw_old"))
        self.assertEqual({n: self.read(n) for n in OLD_FILES}, OLD_FILES)


class TransferTests(UpdateTestCase):
    def test_a_complete_update_is_staged_and_committed(self):
        self.begin_confirmed()
        self.send_all()
        self.cmd("FW_COMMIT\t0.4.0")
        self.assertEqual(self.last(), "OK")
        self.assertEqual(self.read("fw_apply"), "0.4.0\n" + "\n".join(FILES) + "\n")
        for name, data in FILES.items():
            self.assertEqual(self.read("fw_new/" + name, True), data)
        self.assertIsNotNone(self.host._reload_at)
        self.assertEqual(self.up.state, fw_update.IDLE)

    def test_nothing_live_changes_while_the_firmware_runs(self):
        self.begin_confirmed()
        self.send_all()
        self.cmd("FW_COMMIT\t0.4.0")
        self.assertEqual({n: self.read(n) for n in OLD_FILES}, OLD_FILES)
        self.assertFalse(self.has("fw_update.mpy"))

    def test_the_staged_update_is_installed_by_the_next_start(self):
        self.begin_confirmed()
        self.send_all()
        self.cmd("FW_COMMIT\t0.4.0")
        nvm = bytearray(8)
        self.assertEqual(fw_boot.run(nvm), "trial")
        for name, data in FILES.items():
            self.assertEqual(self.read(name, True), data)
        self.assertEqual(self.read("config.json"), "{mine}")

    def test_a_file_arriving_in_odd_chunk_sizes_is_fine(self):
        self.begin_confirmed()
        for chunk in (1, 7, 96, 1000):
            self.up.abort()
            self.begin_confirmed()
            self.send_file("firmware.mpy", chunk=chunk)
            self.assertEqual(self.last(), "OK", chunk)

    def test_a_wrong_crc_drops_the_whole_update(self):
        self.begin_confirmed()
        self.send_file("firmware.mpy", crc_hex="deadbeef")
        self.assertEqual(self.last(), "ERR\tcrc mismatch")
        self.assert_nothing_staged_or_changed()
        self.assertIn("UPDATE FAILED", self.host.ui.notices[-1][0])

    def test_missing_data_is_noticed(self):
        self.begin_confirmed()
        data = FILES["rgb_keys.mpy"]
        self.send_file("rgb_keys.mpy", data=data[:-10], size=len(data), crc_hex=crc(data))
        self.assertEqual(self.last(), "ERR\tsize mismatch")
        self.assert_nothing_staged_or_changed()

    def test_too_much_data_is_noticed(self):
        self.begin_confirmed()
        data = FILES["rgb_keys.mpy"]
        self.send_file("rgb_keys.mpy", data=data + b"extra", size=len(data), crc_hex=crc(data))
        self.assertEqual(self.last(), "ERR\ttoo much data")
        self.assert_nothing_staged_or_changed()

    def test_damaged_base64_is_noticed(self):
        self.begin_confirmed()
        data = FILES["rgb_keys.mpy"]
        self.cmd("FW_FILE\trgb_keys.mpy\t%d\t%s" % (len(data), crc(data)))
        self.cmd("FW_DATA\t!!!not base64!!!")
        self.cmd("FW_FILE_END")
        self.assertTrue(self.last().startswith("ERR\t"))
        self.assert_nothing_staged_or_changed()

    def test_only_the_allowed_files_can_be_sent(self):
        self.begin_confirmed()
        for name in ("code.py", "boot.py", "fw_boot.mpy", "config.json", "../boot.py", "kmk/kmk_keyboard.mpy",
                     "lib/neopixel.mpy", "/code.py", "firmware.mpy.bak", "FIRMWARE.MPY", ""):
            self.cmd("FW_FILE\t%s\t10\t00000000" % name)
            self.assertEqual(self.last(), "ERR\tfile not allowed", repr(name))
        self.assertEqual(self.up.state, fw_update.RECEIVING)
        self.assertFalse(self.has("code.py"))
        self.assertEqual(os.listdir(os.path.join(self.dir, "fw_new")), [])

    def test_a_module_that_a_later_release_adds_can_be_sent(self):
        # a pad on this firmware must not need a flash from the computer because an update brought a new file
        self.begin_confirmed()
        self.send_file("later_module2.mpy", data=b"NEW-MODULE" * 20)
        self.assertEqual(self.last(), "OK")
        self.send_file("firmware.mpy")
        self.assertEqual(self.last(), "OK")

    def test_a_new_module_name_must_be_plain_and_must_not_take_the_place_of_something_the_pad_has(self):
        self.write("lib/neopixel.mpy", "LIB")
        os.makedirs(os.path.join(self.dir, "lib", "adafruit_pkg"))
        os.makedirs(os.path.join(self.dir, "kmk"))
        self.begin_confirmed()
        for name in ("fw_boot.mpy", "Capital.mpy", "1module.mpy", "with-dash.mpy", "two.dots.mpy", ".mpy", "x" * 29 + ".mpy",
                     "module.py", "module", "module.mpy ", "neopixel.mpy", "adafruit_pkg.mpy", "kmk.mpy", "lib.mpy"):
            self.cmd("FW_FILE\t%s\t10\t00000000" % name)
            self.assertEqual(self.last(), "ERR\tfile not allowed", repr(name))

    def test_the_same_file_twice_is_refused(self):
        self.begin_confirmed()
        self.send_file("firmware.mpy")
        self.cmd("FW_FILE\tfirmware.mpy\t10\t00000000")
        self.assertEqual(self.last(), "ERR\tfile not allowed")

    def test_a_file_that_is_too_big_or_empty_is_refused(self):
        self.begin_confirmed()
        for size in (0, -1, fw_update.MAX_FILE + 1):
            self.cmd("FW_FILE\tfirmware.mpy\t%d\t00000000" % size)
            self.assertTrue(self.last().startswith("ERR\t"), size)

    def test_a_new_file_cannot_start_before_the_last_one_ended(self):
        self.begin_confirmed()
        self.cmd("FW_FILE\tfirmware.mpy\t10\t00000000")
        self.cmd("FW_FILE\trgb_keys.mpy\t10\t00000000")
        self.assertEqual(self.last(), "ERR\tprevious file not finished")

    def test_committing_an_incomplete_update_is_refused_and_dropped(self):
        self.begin_confirmed()
        self.send_file("firmware.mpy")
        self.cmd("FW_COMMIT\t0.4.0")
        self.assertTrue(self.last().startswith("ERR\t"))
        self.assert_nothing_staged_or_changed()

    def test_committing_another_version_is_refused(self):
        self.begin_confirmed()
        self.send_all()
        self.cmd("FW_COMMIT\t9.9.9")
        self.assertEqual(self.last(), "ERR\tnot ready")
        self.assertFalse(self.has("fw_apply"))

    def test_committing_while_a_file_is_open_is_refused(self):
        self.begin_confirmed()
        self.cmd("FW_FILE\tfirmware.mpy\t10\t00000000")
        self.cmd("FW_COMMIT\t0.4.0")
        self.assertEqual(self.last(), "ERR\tnot ready")
        self.assertFalse(self.has("fw_apply"))

    def test_the_declared_total_has_to_match(self):
        self.begin_confirmed(total=sum(len(v) for v in FILES.values()) + 5)
        self.send_all()
        self.cmd("FW_COMMIT\t0.4.0")
        self.assertTrue(self.last().startswith("ERR\t"))
        self.assertFalse(self.has("fw_apply"))

    def test_going_quiet_drops_the_update(self):
        self.begin_confirmed()
        self.send_file("firmware.mpy")
        for _ in range(10):
            self.tick(1.0)
        self.assert_nothing_staged_or_changed()
        self.assertIn("timed out", self.host.ui.notices[-1][1])

    def test_going_quiet_in_the_middle_of_a_file_drops_the_update(self):
        self.begin_confirmed()
        self.cmd("FW_FILE\tfirmware.mpy\t100\t00000000")
        self.cmd("FW_DATA\t" + base64.b64encode(b"half").decode())
        for _ in range(10):
            self.tick(1.0)
        self.assert_nothing_staged_or_changed()

    def test_data_keeps_the_update_alive(self):
        self.begin_confirmed()
        self.cmd("FW_FILE\tfirmware.mpy\t%d\t%s" % (len(FILES["firmware.mpy"]), crc(FILES["firmware.mpy"])))
        for i in range(0, len(FILES["firmware.mpy"]), CHUNK):
            self.tick(fw_update.RX_TIMEOUT_S - 1)       # slow, but never quiet for long
            self.cmd("FW_DATA\t" + base64.b64encode(FILES["firmware.mpy"][i:i + CHUNK]).decode())
        self.assertEqual(self.up.state, fw_update.RECEIVING)

    def test_abort_clears_everything_and_answers_ok(self):
        self.begin_confirmed()
        self.send_file("firmware.mpy")
        self.cmd("FW_ABORT")
        self.assertEqual(self.last(), "OK")
        self.assert_nothing_staged_or_changed()

    def test_abort_during_the_prompt_takes_the_prompt_off_the_screen(self):
        self.begin()
        self.cmd("FW_ABORT")
        self.assertEqual(self.host.ui.cleared, 1)
        self.assertIsNone(self.host.encoder.press_hook)

    def test_commands_without_an_update_are_refused_and_stray_data_is_ignored(self):
        for line in ("FW_FILE\tfirmware.mpy\t1\t0", "FW_FILE_END", "FW_COMMIT\t0.4.0"):
            self.cmd(line)
            self.assertEqual(self.last(), "ERR\tno update in progress", line)
        n = len(self.host.replies())
        self.cmd("FW_DATA\tAAAA")
        self.assertEqual(len(self.host.replies()), n)       # not a word

    def test_unknown_commands_are_refused(self):
        self.begin_confirmed()
        self.cmd("FW_FROBNICATE")
        self.assertEqual(self.last(), "ERR\tunknown command")

    def test_a_failed_update_can_be_started_again(self):
        self.begin_confirmed()
        self.send_file("firmware.mpy", crc_hex="deadbeef")
        self.begin_confirmed()
        self.send_all()
        self.cmd("FW_COMMIT\t0.4.0")
        self.assertEqual(self.last(), "OK")


class ScreenTests(UpdateTestCase):
    """The pad's screen is 21 characters wide: nothing the update shows may be longer (the footer is not cut off)."""

    WIDTH = 21

    def assert_all_fit(self):
        self.assertGreater(len(self.host.ui.notices), 0)
        for title, text, footer, _ in self.host.ui.notices:
            for part in (title, text, footer):
                self.assertLessEqual(len(part), self.WIDTH, repr(part))

    def test_the_prompt_and_progress_messages_fit(self):
        self.begin(version="0.10.20")
        self.confirm()
        self.assert_all_fit()

    def test_every_failure_message_fits(self):
        for problem in ("crc mismatch", "size mismatch", "too much data", "bad data", "incomplete", "timed out"):
            self.host.ui.notices.clear()
            self.up.abort(problem)
            self.assert_all_fit()
        self.host.ui.notices.clear()
        self.up.abort("error: " + "x" * 40)         # an unexpected error: the pad cuts the text to the screen
        title, text, footer, _ = self.host.ui.notices[-1]
        self.assertLessEqual(len(footer), self.WIDTH)
        self.assertLessEqual(len(title), self.WIDTH)

    def test_the_prompt_stays_up_for_the_whole_wait(self):
        self.begin()
        self.assertGreater(self.host.ui.notices[-1][3], fw_update.CONFIRM_S)


class SuspendedScreenTests(UpdateTestCase):
    """On the real pad the screen is freed (suspended) before the updater loads: there is no RAM for both. Then
    only the small page is shown, and whenever the update ends without installing, the pad restarts."""

    WIDTH = 21

    def setUp(self):
        super().setUp()
        self.host.ui = FakeUi(suspended=True)

    def restart_scheduled(self):
        import time as real_time

        at = self.host._reload_at
        return at is not None and real_time.monotonic() < at <= real_time.monotonic() + 3.5

    def test_the_prompt_and_progress_use_the_small_page_never_the_normal_one(self):
        self.begin()
        self.confirm()
        titles = [t for t, _, _ in self.host.ui.refused]
        self.assertIn("UPDATE 0.4.0", titles)
        self.assertIn("UPDATING", titles)
        self.assertEqual(self.host.ui.notices, [])

    def test_a_failed_update_says_why_and_restarts_the_pad_soon(self):
        self.begin_confirmed()
        self.send_file("firmware.mpy", crc_hex="deadbeef")
        title, text, footer = self.host.ui.refused[-1]
        self.assertEqual((title, text), ("UPDATE FAILED", "crc mismatch"))
        self.assertTrue(self.restart_scheduled())
        self.assert_nothing_staged_or_changed()

    def test_a_cancel_says_so_and_restarts_the_pad_soon(self):
        self.begin_confirmed()
        self.cmd("FW_ABORT")
        self.assertEqual(self.last(), "OK")
        self.assertEqual(self.host.ui.refused[-1][0], "UPDATE CANCELLED")
        self.assertTrue(self.restart_scheduled())

    def test_no_knob_press_says_so_and_restarts_the_pad_soon(self):
        self.begin()
        for _ in range(int(fw_update.CONFIRM_S) + 5):
            self.tick(1.0)
        self.assertEqual(self.host.ui.refused[-1][:2], ("UPDATE FAILED", "not confirmed"))
        self.assertTrue(self.restart_scheduled())

    def test_going_quiet_restarts_the_pad_soon(self):
        self.begin_confirmed()
        for _ in range(10):
            self.tick(1.0)
        self.assertEqual(self.host.ui.refused[-1][0], "UPDATE FAILED")
        self.assertTrue(self.restart_scheduled())

    def test_a_refused_start_shows_why_and_restarts_the_pad_soon(self):
        self.begin(cp="9.2.0")
        self.assertEqual(self.host.ui.refused[-1][0], "UPDATE REFUSED")
        self.assertIn("CircuitPython", self.host.ui.refused[-1][1])
        self.assertTrue(self.restart_scheduled())

    def test_every_refusal_does_this(self):
        for line in ("FW_BEGIN\t0.4.0\t0\t10\t10.3.1", "FW_BEGIN\tv1\t1\t10\t10.3.1"):
            self.host.ui.refused.clear()
            self.host._reload_at = None
            self.cmd(line)
            self.assertEqual(self.host.ui.refused[-1][0], "UPDATE REFUSED", line)
            self.assertTrue(self.restart_scheduled(), line)

    def test_busy_is_not_a_reason_to_touch_the_screen_or_restart(self):
        self.host._rx = object()                     # a config transfer is running
        self.begin()
        self.assertEqual(self.last(), "ERR\tbusy")
        self.assertEqual(self.host.ui.refused, [])
        self.assertIsNone(self.host._reload_at)

    def test_a_new_start_cancels_a_restart_left_over_from_a_dropped_update(self):
        self.begin_confirmed()
        self.cmd("FW_ABORT")
        self.assertTrue(self.restart_scheduled())
        self.begin()
        self.assertIsNone(self.host._reload_at)      # the new update goes on: the pad must not restart under it
        self.assertEqual(self.up.state, fw_update.CONFIRM)

    def test_a_committed_update_restarts_at_once_and_is_not_undone_by_the_cancel_restart(self):
        self.begin_confirmed()
        self.send_all()
        self.cmd("FW_COMMIT\t0.4.0")
        import time as real_time

        self.assertLess(self.host._reload_at, real_time.monotonic() + 1.0)   # about half a second

    def test_everything_shown_fits_the_screen(self):
        self.begin_confirmed()
        self.send_file("firmware.mpy", crc_hex="deadbeef")
        self.begin(cp="9.2.0")
        for title, text, footer in self.host.ui.refused:
            for part in (title, footer):                 # the text is cut to the line by the screen; these are not
                self.assertLessEqual(len(part), self.WIDTH, repr(part))


class PadIntegrationTests(unittest.TestCase):
    """The update through the real AppProfiles command loop (app_profiles.py), with fake serial and knob."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="fwpad_")
        self.addCleanup(shutil.rmtree, self.dir, True)
        saved = fw_boot.ROOT
        fw_boot.ROOT = self.dir
        self.addCleanup(setattr, fw_boot, "ROOT", saved)
        for name, content in OLD_FILES.items():
            with open(os.path.join(self.dir, name), "w") as f:
                f.write(content)
        self.addCleanup(sys.modules.pop, "fw_update", None)
        sys.modules["fw_update"] = fw_update
        for p in (
            mock.patch.object(fw_update, "_cp_version", lambda: "10.3.1"),
            mock.patch.object(fw_update, "_free", lambda: 1000000),
        ):
            p.start()
            self.addCleanup(p.stop)
        _cl.can_save = lambda: True
        self.pad, self.kb = make_pad()
        self.pad.encoder = FakeEncoder()
        self.pad.ui = FakeUi()

    def reply_lines(self):
        return sent().split("\n")[:-1]

    def test_the_screen_is_freed_before_the_updater_is_loaded(self):
        sys.modules.pop("fw_update", None)
        loaded_when_suspended = []
        real = self.pad.ui.suspend

        def suspend():
            loaded_when_suspended.append("fw_update" in sys.modules)
            real()

        self.pad.ui.suspend = suspend
        feed(self.pad, self.kb, "FW_BEGIN\t0.4.0\t1\t10\t10.3.1\n")   # the real module is imported by the command loop
        self.assertEqual(loaded_when_suspended, [False])    # not loaded yet when the screen was freed ...
        self.assertTrue(self.pad.ui.suspended)              # (the updater is dropped again once a start is refused)

    def test_only_an_update_start_frees_the_screen(self):
        for line in ("FW_INFO", "FW_DATA\tAAAA", "FW_ABORT", "FW_FILE_END"):
            sys.modules["fw_update"] = fw_update
            feed(self.pad, self.kb, line + "\n")
        self.assertEqual(self.pad.ui.calls, [])

    def test_a_refused_start_through_the_command_loop_restarts_the_pad_soon(self):
        sys.modules["fw_update"] = fw_update
        feed(self.pad, self.kb, "FW_BEGIN\t0.4.0\t1\t10\t9.2.0\n")
        self.assertTrue(self.reply_lines()[-1].startswith("ERR\t"))
        self.assertIsNotNone(self.pad._reload_at)
        self.assertEqual(self.pad.ui.refused[-1][0], "UPDATE REFUSED")

    def test_the_receiver_is_dropped_again_when_nothing_is_in_progress(self):
        sys.modules["fw_update"] = fw_update
        feed(self.pad, self.kb, "FW_BEGIN\t0.4.0\t1\t10\t9.2.0\n")      # refused: another CircuitPython
        self.assertIsNone(self.pad._fw)
        self.assertNotIn("fw_update", sys.modules)

    def test_only_an_update_start_loads_the_updater(self):
        sys.modules.pop("fw_update", None)
        for line in ("FW_INFO", "FW_DATA\tAAAA", "FW_ABORT", "FW_FILE\tfirmware.mpy\t1\t0", "FW_FILE_END",
                     "FW_COMMIT\t0.4.0", "FW_FROBNICATE"):
            feed(self.pad, self.kb, line + "\n")
            self.assertNotIn("fw_update", sys.modules, line)

    def test_a_stray_abort_is_answered_without_loading_anything(self):
        feed(self.pad, self.kb, "FW_ABORT\n")
        self.assertEqual(self.reply_lines()[-1], "OK")

    def test_other_commands_without_an_update_are_refused_without_loading_anything(self):
        for line in ("FW_FILE\tfirmware.mpy\t1\t0", "FW_FILE_END", "FW_COMMIT\t0.4.0", "FW_FROBNICATE"):
            feed(self.pad, self.kb, line + "\n")
            self.assertEqual(self.reply_lines()[-1], "ERR\tno update in progress", line)
        self.assertEqual(self.pad.ui.calls, [])

    def test_a_start_while_a_config_is_arriving_is_refused_before_touching_the_screen(self):
        self.pad._rx = object()
        feed(self.pad, self.kb, "FW_BEGIN\t0.4.0\t1\t10\t10.3.1\n")
        self.assertEqual(self.reply_lines()[-1], "ERR\tbusy")
        self.assertEqual(self.pad.ui.calls, [])
        self.assertIsNone(self.pad._reload_at)

    def test_a_full_update_through_the_command_loop(self):
        sys.modules["fw_update"] = fw_update        # the loop re-imports it; keep our patched copy
        total = sum(len(v) for v in FILES.values())
        feed(self.pad, self.kb, "FW_BEGIN\t0.4.0\t%d\t%d\t10.3.1\n" % (len(FILES), total))
        self.assertTrue(self.pad._fw_busy())
        self.assertEqual(self.reply_lines(), [])
        self.assertTrue(self.pad.encoder.press())
        scan(self.pad, self.kb)
        self.assertEqual(self.reply_lines()[-1], "OK")
        for name, data in FILES.items():
            lines = ["FW_FILE\t%s\t%d\t%s" % (name, len(data), crc(data))]
            lines += ["FW_DATA\t" + base64.b64encode(data[i:i + CHUNK]).decode() for i in range(0, len(data), CHUNK)]
            lines.append("FW_FILE_END")
            for line in lines:                  # a few hundred bytes at a time, like the USB port delivers
                feed(self.pad, self.kb, line + "\n")
        self.assertEqual(self.reply_lines().count("OK"), 1 + 2 * len(FILES))
        feed(self.pad, self.kb, "FW_COMMIT\t0.4.0\n")
        self.assertEqual(self.reply_lines()[-1], "OK")
        self.assertTrue(os.path.exists(os.path.join(self.dir, "fw_apply")))
        self.assertIsNotNone(self.pad._reload_at)
        self.assertFalse(self.pad._fw_busy())

    def test_a_config_push_is_refused_during_an_update(self):
        feed(self.pad, self.kb, "FW_BEGIN\t0.4.0\t1\t10\t10.3.1\n")
        self.assertTrue(self.pad._fw_busy())
        feed(self.pad, self.kb, "CFG_BEGIN\t10\t00000000\n")
        self.assertIn("ERR\tfirmware update in progress", self.reply_lines())
        self.assertIsNone(self.pad._rx)

    def test_events_wait_while_an_update_is_running(self):
        feed(self.pad, self.kb, "HELLO\n")
        scan(self.pad, self.kb, 2)
        SERIAL.out = b""
        feed(self.pad, self.kb, "FW_BEGIN\t0.4.0\t1\t10\t10.3.1\n")
        self.pad.process_key(self.kb, None, True, 4)
        scan(self.pad, self.kb, 3)
        self.assertNotIn("EVT", sent())

    def test_stray_data_does_not_load_the_receiver(self):
        sys.modules.pop("fw_update", None)
        feed(self.pad, self.kb, "FW_DATA\tAAAA\n")
        self.assertNotIn("fw_update", sys.modules)
        self.assertEqual(sent(), "")

    def test_a_pad_without_the_receiver_says_so_and_gets_its_screen_back(self):
        sys.modules["fw_update"] = None             # an import of this now raises ImportError
        feed(self.pad, self.kb, "FW_BEGIN\t0.4.0\t1\t10\t10.3.1\n")
        self.assertIn("ERR\tfirmware update not available", self.reply_lines())
        self.assertTrue(self.pad.ui.suspended)      # the screen had been freed for the update ...
        self.assertIsNotNone(self.pad._reload_at)   # ... so the pad restarts to bring it back
        self.assertIsNone(self.pad._fw)

    def test_the_knob_press_is_typed_normally_when_no_update_asks_for_it(self):
        self.assertFalse(self.pad.encoder.press())


if __name__ == "__main__":
    unittest.main()
