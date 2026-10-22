# SPDX-License-Identifier: GPL-3.0-only
# The lists that must agree for a firmware update to work: what the pad accepts (fw_update.ALLOWED), what the
# build ships (build_mpy.OTA_FILES) and what a flash from the computer installs and clears. If they drift apart
# an update would be refused, or a flash would leave a half-finished update behind.
#
#     python -m unittest discover -s Programs/tests -v

import ast
import binascii
import importlib.util
import json
import os
import re
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PROGRAMS = os.path.join(HERE, "..")


def read(name):
    with open(os.path.join(PROGRAMS, name), encoding="utf-8") as f:
        return f.read()


def literal(source, name):
    """The value of a module level `NAME = <literal>` in a Python source file."""
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == name for t in node.targets):
            return ast.literal_eval(node.value)
    raise AssertionError(name + " not found")


_spec = importlib.util.spec_from_file_location("build_mpy_for_test", os.path.join(PROGRAMS, "build_mpy.py"))
build_mpy = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build_mpy)


class ListsAgreeTests(unittest.TestCase):
    def test_the_build_ships_exactly_what_the_pad_accepts(self):
        self.assertEqual(build_mpy.OTA_FILES, literal(read("fw_update.py"), "ALLOWED"))

    def test_the_safety_net_and_the_stubs_can_never_be_sent(self):
        for name in ("code.py", "boot.py", "fw_boot.mpy", "fw_boot.py", "config.json", "settings.toml"):
            self.assertNotIn(name, build_mpy.OTA_FILES)
            self.assertNotIn(name, literal(read("fw_update.py"), "ALLOWED"))

    def test_every_compiled_file_that_is_shipped_is_built(self):
        built = {m + ".mpy" for m in build_mpy.MODULES} | {"firmware.mpy"}
        for name in build_mpy.OTA_FILES:
            if name.endswith(".mpy"):
                self.assertIn(name, built)

    def test_a_flash_from_the_computer_installs_the_update_modules(self):
        ps1 = read("flash_pad.ps1")
        for name in ("fw_boot.mpy", "fw_update.mpy"):
            self.assertIn("'%s'" % name, ps1)
        for module in ("fw_boot", "fw_update"):
            self.assertIn("'%s'" % module, ps1)         # their .py shadows are removed from the pad

    def test_a_flash_clears_the_update_markers_that_fw_boot_uses(self):
        ps1 = read("flash_pad.ps1")
        boot = read("fw_boot.py")
        for const in ("APPLY", "TRY", "ROLLBACK", "FAILED"):
            self.assertIn("'%s'" % literal(boot, const).lstrip("/"), ps1, const)
        for const in ("NEW", "OLD"):
            self.assertIn("'%s'" % literal(boot, const).lstrip("/"), ps1, const)

    def test_the_boot_stub_runs_the_safety_net_before_the_firmware_and_survives_its_absence(self):
        stub = build_mpy.STUB
        self.assertLess(stub.index("import fw_boot"), stub.index("import firmware"))
        self.assertIn("fw_boot.run(nvm)", stub)
        # a pad flashed before fw_boot existed must still start: any error from it is caught
        self.assertRegex(stub, r"import fw_boot\n    fw_boot\.run\(nvm\).*\nexcept Exception")

    def test_the_trial_is_accepted_by_the_heartbeat_using_the_same_marker_and_counter(self):
        code = read("code.py")
        boot = read("fw_boot.py")
        self.assertIn('"%s"' % literal(boot, "TRY"), code)
        self.assertIn("microcontroller.nvm[%d] = 0" % literal(boot, "TRY_NVM"), code)
        self.assertIn("TRIAL_OK_S", code)

    def test_the_trial_counter_does_not_collide_with_the_stubs_counters(self):
        self.assertNotIn(literal(read("fw_boot.py"), "TRY_NVM"), (0, 1))

    def test_limits_are_big_enough_for_the_real_firmware(self):
        fw = {n: os.path.getsize(os.path.join(PROGRAMS, "build", n))
              for n in build_mpy.OTA_FILES if os.path.exists(os.path.join(PROGRAMS, "build", n))}
        if not fw:
            self.skipTest("no build yet")
        self.assertLess(max(fw.values()), literal(read("fw_update.py"), "MAX_FILE"))
        self.assertLess(sum(fw.values()), literal(read("fw_update.py"), "MAX_TOTAL"))
        self.assertLessEqual(len(fw), literal(read("fw_update.py"), "MAX_FILES"))


class BuiltBundleTests(unittest.TestCase):
    """Checks the bundle in build/ota (made by build_mpy.py). Skipped when there is no customer build."""

    OTA = os.path.join(PROGRAMS, "build", "ota")

    def setUp(self):
        if not os.path.exists(os.path.join(self.OTA, "manifest.json")):
            self.skipTest("no customer build (python build_mpy.py --mpy-cross ...)")
        with open(os.path.join(self.OTA, "manifest.json")) as f:
            self.manifest = json.load(f)

    def test_the_manifest_describes_the_firmware_in_this_repo(self):
        self.assertEqual(self.manifest["format"], 1)
        self.assertEqual(self.manifest["version"], literal(read("app_profiles.py"), "FIRMWARE_VERSION"))
        self.assertRegex(self.manifest["circuitpython"], r"^\d+\.\d+\.\d+$")

    def test_the_manifest_lists_every_allowed_file_once(self):
        names = [f["name"] for f in self.manifest["files"]]
        self.assertEqual(tuple(names), build_mpy.OTA_FILES)

    def test_sizes_and_checksums_match_the_files(self):
        for entry in self.manifest["files"]:
            with open(os.path.join(self.OTA, entry["name"]), "rb") as f:
                data = f.read()
            self.assertEqual(len(data), entry["size"], entry["name"])
            self.assertEqual("%08x" % (binascii.crc32(data) & 0xFFFFFFFF), entry["crc32"], entry["name"])

    def test_the_bundle_has_no_development_tools(self):
        self.assertNotIn("dev_tools.mpy", os.listdir(self.OTA))
        self.assertNotIn("dev_tools.mpy", [f["name"] for f in self.manifest["files"]])


if __name__ == "__main__":
    unittest.main()
