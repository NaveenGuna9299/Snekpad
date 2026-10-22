# SPDX-License-Identifier: GPL-3.0-only
# fw_boot.py: applying a staged firmware update at start-up, trial starts, and rolling back. The important
# part: a power cut after ANY single file operation must never leave a mix of old and new files.
#
#     python -m unittest discover -s Programs/tests -v

import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

import fw_boot  # noqa: E402

OLD_FILES = {"firmware.mpy": "OLD-A", "rgb_keys.mpy": "OLD-B", "config.json": "{mine}", "boot.py": "BOOT"}
NEW_FILES = {"firmware.mpy": "NEW-A", "rgb_keys.mpy": "NEW-B", "fw_update.mpy": "NEW-C"}   # fw_update.mpy is new


class PowerCut(BaseException):
    """The power went away in the middle of a file operation. A BaseException on purpose: nothing in the code
    under test gets to catch it, just like it cannot catch a real power cut."""


class FlashFs:
    """Wraps the real os for fw_boot: counts every change to the filesystem, can cut the power after N of
    them, and refuses to rename onto an existing file like the pad's FAT filesystem does."""

    def __init__(self, budget=None):
        self.budget = budget        # None = never cut
        self.ops = 0

    def _change(self):
        if self.budget is not None and self.ops >= self.budget:
            raise PowerCut()
        self.ops += 1

    stat = staticmethod(os.stat)
    listdir = staticmethod(os.listdir)

    def sync(self):
        pass

    def mkdir(self, path):
        self._change()
        os.mkdir(path)

    def rmdir(self, path):
        self._change()
        os.rmdir(path)

    def remove(self, path):
        self._change()
        os.remove(path)

    def rename(self, src, dst):
        self._change()
        if os.path.exists(dst):
            raise FileExistsError(dst)
        os.rename(src, dst)

    def open(self, path, mode="r"):
        if "w" in mode:
            self._change()          # creating / truncating a file is a change; a cut here leaves it empty
        return open(path, mode)


class FwBootTestCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="fwboot_")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.saved = (fw_boot.ROOT, fw_boot.os, getattr(fw_boot, "open", None))
        fw_boot.ROOT = self.dir
        self.set_fs(FlashFs())
        self.addCleanup(self.restore)
        self.nvm = bytearray(8)

    def restore(self):
        fw_boot.ROOT, fw_boot.os = self.saved[0], self.saved[1]
        if hasattr(fw_boot, "open"):
            del fw_boot.open

    def set_fs(self, fs):
        self.fs = fs
        fw_boot.os = fs
        fw_boot.open = fs.open

    # -- helpers ------------------------------------------------------------------------
    def path(self, name):
        return os.path.join(self.dir, name.lstrip("/").replace("/", os.sep))

    def write(self, name, text):
        os.makedirs(os.path.dirname(self.path(name)), exist_ok=True)
        with open(self.path(name), "w") as f:
            f.write(text)

    def read(self, name):
        with open(self.path(name)) as f:
            return f.read()

    def has(self, name):
        return os.path.exists(self.path(name))

    def files(self):
        """Every file on the fake pad, as {relative path: content}."""
        out = {}
        for d, _, names in os.walk(self.dir):
            for n in names:
                full = os.path.join(d, n)
                with open(full) as f:
                    out[os.path.relpath(full, self.dir).replace(os.sep, "/")] = f.read()
        return out

    def make_pad(self, staged=True):
        for n, c in OLD_FILES.items():
            self.write(n, c)
        if staged:
            for n, c in NEW_FILES.items():
                self.write("fw_new/" + n, c)
            self.write("fw_apply", "0.4.0\n" + "\n".join(NEW_FILES) + "\n")

    def live(self, names=None):
        return {n: self.read(n) for n in (names or list(OLD_FILES) + ["fw_update.mpy"]) if self.has(n)}

    def all_new(self):
        return all(self.has(n) and self.read(n) == c for n, c in NEW_FILES.items())

    def all_old(self):
        old_ok = all(self.read(n) == c for n, c in OLD_FILES.items())
        return old_ok and not self.has("fw_update.mpy")

    def assert_mine_untouched(self):
        self.assertEqual(self.read("config.json"), "{mine}")
        self.assertEqual(self.read("boot.py"), "BOOT")

    def boot(self, budget=None):
        self.set_fs(FlashFs(budget))
        return fw_boot.run(self.nvm)


class ApplyTests(FwBootTestCase):
    def test_nothing_to_do_on_a_normal_start(self):
        self.make_pad(staged=False)
        self.assertIsNone(self.boot())
        self.assertEqual(self.files(), {n: c for n, c in OLD_FILES.items()})

    def test_a_committed_update_is_installed_at_the_next_start(self):
        self.make_pad()
        self.assertEqual(self.boot(), "trial")
        self.assertTrue(self.all_new())
        self.assertEqual(self.read("fw_try"), "0.4.0")
        self.assertFalse(self.has("fw_apply"))
        self.assertFalse(self.has("fw_new"))
        self.assert_mine_untouched()

    def test_the_old_files_are_kept_as_a_backup(self):
        self.make_pad()
        self.boot()
        self.assertEqual(self.read("fw_old/firmware.mpy"), "OLD-A")
        self.assertEqual(self.read("fw_old/rgb_keys.mpy"), "OLD-B")
        self.assertFalse(self.has("fw_old/fw_update.mpy"))        # it did not exist before

    def test_an_update_that_is_not_committed_is_ignored(self):
        self.make_pad(staged=False)
        for n, c in NEW_FILES.items():
            self.write("fw_new/" + n, c)                          # staged, but no fw_apply marker
        self.assertIsNone(self.boot())
        self.assertTrue(self.all_old())

    def test_the_first_start_after_installing_is_trial_start_one(self):
        self.make_pad()
        self.boot()
        self.assertEqual(self.nvm[fw_boot.TRY_NVM], 1)

    def test_a_failure_to_install_undoes_the_update(self):
        self.make_pad()
        self.write("fw_old/firmware.mpy", "STALE")      # a backup that should not be there
        self.assertEqual(self.boot(), "rolled back")
        self.assertFalse(self.has("fw_apply"))
        self.assertTrue(self.has("fw_failed"))
        self.assertIn("install failed", self.read("fw_failed"))
        self.assert_mine_untouched()


class PowerCutTests(FwBootTestCase):
    def boots_until_settled(self, limit=6):
        for _ in range(limit):
            self.boot()
            if not self.has("fw_apply") and not self.has("fw_rollback"):
                return
        self.fail("never settled")

    def total_ops(self, setup):
        setup()
        self.boot()
        return self.fs.ops

    def test_a_power_cut_at_every_step_of_the_install_still_ends_fully_updated(self):
        n = self.total_ops(self.make_pad)
        self.assertGreater(n, 8)                    # sanity: there are plenty of steps to cut at
        for cut in range(n + 1):
            shutil.rmtree(self.dir)
            os.makedirs(self.dir)
            self.nvm = bytearray(8)
            self.make_pad()
            try:
                self.boot(budget=cut)
            except PowerCut:
                pass
            self.boots_until_settled()
            self.assertTrue(self.all_new(), "cut after %d operations" % cut)
            self.assertTrue(self.has("fw_try"), "cut after %d operations" % cut)
            self.assertFalse(self.has("fw_new"), "cut after %d operations" % cut)
            self.assertEqual(self.read("fw_old/firmware.mpy"), "OLD-A", "cut after %d operations" % cut)
            self.assertEqual(self.read("fw_old/rgb_keys.mpy"), "OLD-B", "cut after %d operations" % cut)
            self.assert_mine_untouched()

    def test_a_power_cut_at_every_step_never_leaves_a_mix_during_the_install(self):
        n = self.total_ops(self.make_pad)
        for cut in range(n + 1):
            shutil.rmtree(self.dir)
            os.makedirs(self.dir)
            self.nvm = bytearray(8)
            self.make_pad()
            try:
                self.boot(budget=cut)
            except PowerCut:
                pass
            # the live files are each either the old or the new version of themselves, and the journal says which
            # way to finish: whatever is in place, the next start must end fully new (checked above)
            for name, new in (("firmware.mpy", "NEW-A"), ("rgb_keys.mpy", "NEW-B")):
                if self.has(name):
                    self.assertIn(self.read(name), (OLD_FILES[name], new), "cut after %d" % cut)

    def prepare_trial_that_fails(self):
        self.make_pad()
        self.assertEqual(self.boot(), "trial")      # start 1 under trial; it will crash again and again

    def test_a_firmware_that_keeps_failing_is_rolled_back_after_its_trial_starts(self):
        self.prepare_trial_that_fails()
        self.assertEqual(self.boot(), "trial")      # start 2
        self.assertEqual(self.boot(), "trial")      # start 3
        self.assertEqual(self.boot(), "rolled back")    # start 4: out of tries
        self.assertTrue(self.all_old())
        self.assertFalse(self.has("fw_try"))
        self.assertFalse(self.has("fw_old"))
        self.assertFalse(self.has("fw_rollback"))
        self.assertEqual(self.nvm[fw_boot.TRY_NVM], 0)
        self.assertEqual(self.read("fw_failed"), "new firmware did not start")
        self.assert_mine_untouched()

    def test_after_a_rollback_the_next_starts_are_plain(self):
        self.prepare_trial_that_fails()
        for _ in range(3):
            self.boot()
        self.assertIsNone(self.boot())
        self.assertTrue(self.all_old())

    def test_a_firmware_that_proves_itself_is_kept(self):
        self.prepare_trial_that_fails()
        os.remove(self.path("fw_try"))              # code.py's heartbeat does this after a while
        self.nvm[fw_boot.TRY_NVM] = 0
        for _ in range(10):
            self.assertIsNone(self.boot())
        self.assertTrue(self.all_new())
        self.assertFalse(self.has("fw_failed"))

    def test_a_power_cut_at_every_step_of_the_rollback_still_ends_fully_old(self):
        self.prepare_trial_that_fails()
        for _ in range(2):
            self.boot()                              # starts 2 and 3 under trial; start 4 will roll back
        snapshot = self.files()
        nvm = bytes(self.nvm)
        self.set_fs(FlashFs())
        fw_boot.run(self.nvm)
        n = self.fs.ops
        self.assertGreater(n, 8)
        for cut in range(n + 1):
            shutil.rmtree(self.dir)
            os.makedirs(self.dir)
            for name, content in snapshot.items():
                self.write(name, content)
            self.nvm = bytearray(nvm)
            try:
                self.boot(budget=cut)
            except PowerCut:
                pass
            for _ in range(4):
                self.boot()
            self.assertTrue(self.all_old(), "cut after %d operations" % cut)
            self.assertFalse(self.has("fw_try"), "cut after %d operations" % cut)
            self.assertFalse(self.has("fw_old"), "cut after %d operations" % cut)
            self.assertFalse(self.has("fw_rollback"), "cut after %d operations" % cut)
            self.assertTrue(self.has("fw_failed"), "cut after %d operations" % cut)
            self.assert_mine_untouched()

    def test_a_file_the_update_added_is_removed_by_the_rollback(self):
        self.prepare_trial_that_fails()
        self.assertTrue(self.has("fw_update.mpy"))
        for _ in range(3):
            self.boot()
        self.assertFalse(self.has("fw_update.mpy"))


class StateMarkerTests(FwBootTestCase):
    def test_a_rollback_that_was_interrupted_is_finished_first(self):
        self.make_pad(staged=False)
        self.write("fw_rollback", "why\n")
        self.write("fw_old/names", "firmware.mpy\n")
        self.write("fw_old/had", "firmware.mpy\n")
        self.write("fw_old/firmware.mpy", "OLD-A")
        self.write("firmware.mpy", "NEW-A")
        self.assertEqual(self.boot(), "rolled back")
        self.assertEqual(self.read("firmware.mpy"), "OLD-A")
        self.assertEqual(self.read("fw_failed"), "why")

    def test_a_rollback_without_any_record_changes_no_file(self):
        self.make_pad(staged=False)
        self.write("fw_try", "0.4.0")
        self.nvm[fw_boot.TRY_NVM] = fw_boot.MAX_TRIES
        self.assertEqual(self.boot(), "rolled back")
        self.assertEqual({n: self.read(n) for n in OLD_FILES}, OLD_FILES)

    def test_the_trial_counter_is_not_touched_without_a_trial(self):
        self.make_pad(staged=False)
        for _ in range(5):
            self.boot()
        self.assertEqual(self.nvm[fw_boot.TRY_NVM], 0)

    def test_errors_never_escape_into_the_stub(self):
        self.make_pad(staged=False)
        self.write("fw_apply", "")                  # damaged commit marker
        try:
            self.boot()
        except Exception as e:                      # pragma: no cover
            self.fail("run() must not raise: %r" % e)


if __name__ == "__main__":
    unittest.main()
