# SPDX-License-Identifier: GPL-3.0-only
# fw_update.py - receives a firmware update from SnekPad Studio over the data serial port (FW_* commands).
# Copy this file to the root of CIRCUITPY (next to code.py). app_profiles.py loads it when the first FW_
# command arrives and drops it again when the update is over, so it costs no RAM in normal use.
#
# What it does, and what it never does:
#   - It only STAGES files: they are written to /fw_new, checked (size and CRC-32) one by one, and left
#     there. No live file changes while the firmware is running.
#   - Only the files in ALLOWED can be sent. code.py, boot.py, fw_boot.py, config.json, kmk/ and lib/ cannot.
#   - A knob press on the pad is required to start (the pad shows "press knob to allow"), so nothing on the
#     computer can install firmware without someone at the pad.
#   - FW_COMMIT writes the commit marker /fw_apply and restarts the pad. fw_boot.py (see there) installs the
#     staged files at that start, keeps the old ones, and puts them back if the new firmware does not run.
#   - If the app goes quiet, or anything is wrong, the staged files are thrown away and nothing changes.
#   - The pad has very little RAM (about 4 KB free once this is loaded), so app_profiles.py frees the screen's
#     memory first (OledUI.suspend, as for a config push). From then on the screen only shows small pages
#     (show_refused), and whenever the update ends without installing (refused, cancelled, failed) the pad
#     restarts after 3 s, which also brings the normal screen back.
#
#   FW_INFO                                       (answered by app_profiles.py without loading this module)
#   FW_BEGIN<TAB>version<TAB>files<TAB>bytes<TAB>circuitpython
#                                                 -> OK once the knob was pressed, or ERR<TAB>reason
#   FW_FILE<TAB>name<TAB>size<TAB>crc32hex        -> OK | ERR<TAB>reason
#   FW_DATA<TAB>base64                            (no reply; up to about 100 bytes per line, in order)
#   FW_FILE_END                                   -> OK | ERR<TAB>reason   (size and CRC checked)
#   FW_COMMIT<TAB>version                         -> OK, then the pad restarts and installs
#   FW_ABORT                                      -> OK

import gc
import os
import sys
import time
from binascii import a2b_base64

import config_loader
import fw_boot

ALLOWED = ("firmware.mpy", "config_loader.mpy", "rgb_keys.mpy", "encoder_modes.mpy", "app_profiles.mpy",
           "oled_ui.mpy", "fw_update.mpy", "snekpad32.bmp")
MAX_FILES = 12
MAX_FILE = 40000            # bytes; the biggest module is about 8 KB
MAX_TOTAL = 150000
SPACE_MARGIN = 16384        # flash that must stay free on top of twice the update
CONFIRM_S = 30              # seconds the pad waits for the knob press
RX_TIMEOUT_S = 5            # seconds without data before the update is dropped

IDLE = 0
CONFIRM = 1                 # waiting for the knob press
RECEIVING = 2


def _ram():
    """Free RAM in bytes (only CircuitPython can say; 0 on a normal Python, as in the tests)."""
    try:
        return gc.mem_free()
    except AttributeError:
        return 0


def _cp_version():
    v = sys.implementation.version
    return "%d.%d.%d" % (v[0], v[1], v[2])


def _free():
    st = os.statvfs(fw_boot.ROOT or "/")
    return st[0] * st[3]


def _clean(text):
    return "".join(c if " " <= c <= "~" else "?" for c in str(text))[:60]


def _version_ok(v):
    p = v.split(".")
    return len(p) == 3 and all(x.isdigit() and len(x) <= 4 for x in p)


class Updater:
    def __init__(self, host, firmware_version):
        self.host = host                # the AppProfiles: replies, the screen, the knob
        self.firmware_version = firmware_version
        self.state = IDLE
        self._hook = self._knob     # one function object, so the knob hook can be recognised again with "is"
        self._reset()

    def _reset(self):
        self.deadline = 0
        self.last_rx = 0
        self.confirmed = False
        self.version = ""
        self.count = 0
        self.total = 0
        self.done = []                  # names of the files received completely
        self.sizes = {}
        self.fh = None                  # the file being received
        self.name = None
        self.size = 0
        self.got = 0
        self.crc = 0
        self.want = 0
        self.error = None

    # ------------------------------------------------------------ helpers
    def _reply(self, text):
        self.host._write(text + "\n")

    def _err(self, reason):
        self._reply("ERR\t" + _clean(reason))

    def _show(self, text, title, footer="", seconds=None):
        ui = self.host.ui
        if ui is not None:
            try:
                if ui.suspended:
                    ui.show_refused(text, title=title, footer=footer)   # the small page: the normal one was freed
                else:
                    ui.show_notice(text, title=title, footer=footer, seconds=seconds)
            except Exception as e:
                print("fw_update screen error:", e)

    def _screen_suspended(self):
        ui = self.host.ui
        return ui is not None and ui.suspended

    def _restart_soon(self):
        """After an update that did not install: the pad restarts, which brings the normal screen back."""
        self.host._reload_at = time.monotonic() + 3.0

    def _refuse(self, reason):
        """Say no to FW_BEGIN. The screen was freed for the update, so show why and restart."""
        self._err(reason)
        if self._screen_suspended():
            self._show(reason, "UPDATE REFUSED", "old firmware is kept")
            self._restart_soon()

    def _release(self):
        enc = self.host.encoder
        if enc is not None and enc.press_hook is self._hook:
            enc.press_hook = None

    def _close_file(self):
        if self.fh is not None:
            try:
                self.fh.close()
            except Exception:
                pass
            self.fh = None

    def abort(self, notice=None, cancelled=False):
        """Throw the staged files away. Nothing live was touched, so nothing changes."""
        self._close_file()
        self._release()
        try:
            fw_boot.clear_dir(fw_boot.NEW)
        except Exception as e:
            print("fw_update cleanup error:", e)
        was = self.state
        print("fw_update: dropped the update:", notice or "no reason given")
        self.state = IDLE
        self._reset()
        if self._screen_suspended():
            if cancelled:
                self._show("Cancelled", "UPDATE CANCELLED", "old firmware is kept")
            else:
                self._show(notice or "Dropped", "UPDATE FAILED", "old firmware is kept")
            self._restart_soon()
        elif notice:
            self._show(notice, "UPDATE FAILED", "old firmware is kept", 10)
        elif was == CONFIRM:
            ui = self.host.ui
            if ui is not None and hasattr(ui, "clear_notice"):
                ui.clear_notice()

    def _knob(self):
        """The knob was pressed: if a prompt is waiting for it, this press answers the prompt."""
        if self.state == CONFIRM:
            self.confirmed = True
            return True
        return False

    # ------------------------------------------------------------ commands
    def handle(self, parts, now):
        cmd = parts[0]
        if cmd != "FW_DATA":
            print("fw_update:", cmd, "state", self.state, "free RAM", _ram())
        try:
            if cmd == "FW_BEGIN":
                self._begin(parts, now)
            elif cmd == "FW_ABORT":
                self.abort(cancelled=True)
                self._reply("OK")
            elif self.state != RECEIVING:
                if cmd != "FW_DATA":        # stray data after an abort is dropped without a word
                    self._err("no update in progress")
            elif cmd == "FW_FILE":
                self._file(parts, now)
            elif cmd == "FW_DATA":
                self._data(parts, now)
            elif cmd == "FW_FILE_END":
                self._file_end(now)
            elif cmd == "FW_COMMIT":
                self._commit(parts)
            else:
                self._err("unknown command")
        except Exception as e:
            print("fw_update error:", e)
            if self.state != IDLE:
                self.abort("error: " + _clean(e)[:30])
            self._err("update failed")

    def _begin(self, parts, now):
        host = self.host
        if self.state != IDLE or host._rx is not None:
            return self._err("busy")        # something else is running: leave it (and its screen) alone
        if not config_loader.can_save():
            return self._refuse("drive is visible: replug without holding the top-left key")
        try:
            version, count, total, cp = parts[1], int(parts[2]), int(parts[3]), parts[4]
        except Exception:
            return self._refuse("bad FW_BEGIN")
        if not _version_ok(version):
            return self._refuse("bad version")
        if not 1 <= count <= MAX_FILES or not 1 <= total <= MAX_TOTAL:
            return self._refuse("update too big")
        if cp != _cp_version():
            return self._refuse("needs CircuitPython " + cp + ", pad has " + _cp_version())
        if fw_boot.exists(fw_boot.TRY) or fw_boot.exists(fw_boot.APPLY) or fw_boot.exists(fw_boot.ROLLBACK):
            return self._refuse("the last update is still being checked")
        if _free() < total * 2 + SPACE_MARGIN:
            return self._refuse("not enough free space")
        if host.encoder is None:
            return self._refuse("no knob to confirm with")
        host._reload_at = None              # a restart left over from an update that was dropped: not any more
        fw_boot.clear_dir(fw_boot.NEW)
        fw_boot.clear_dir(fw_boot.OLD)          # the backup of an update that was finished long ago
        os.mkdir(fw_boot.ROOT + fw_boot.NEW)
        self._reset()
        self.version, self.count, self.total = version, count, total
        self.state = CONFIRM
        self.deadline = now + CONFIRM_S
        host.encoder.press_hook = self._hook
        self._show("Press knob to allow", "UPDATE " + version, "or wait to cancel", CONFIRM_S + 5)
        print("fw_update: waiting for the knob, free RAM", _ram())

    def tick(self, now):
        """Called by the host on every scan: the knob answer, and the time limits."""
        if self.state == CONFIRM:
            if self.confirmed:
                print("fw_update: knob pressed")
                self.state = RECEIVING
                self.last_rx = now
                self._release()
                self._reply("OK")
                print("fw_update: replied OK, free RAM", _ram())
                self._show("Do not unplug", "UPDATING", self.version, 120)
                print("fw_update: receiving, free RAM", _ram())
            elif now >= self.deadline:
                self._err("not confirmed on the pad")
                self.abort("not confirmed")
        elif self.state == RECEIVING and now - self.last_rx > RX_TIMEOUT_S:
            self.abort("timed out")

    def _file(self, parts, now):
        if self.fh is not None:
            return self._err("previous file not finished")
        name, size, want = parts[1], int(parts[2]), int(parts[3], 16)
        if name not in ALLOWED or name in self.done:
            return self._err("file not allowed")
        if not 0 < size <= MAX_FILE:
            return self._err("bad size")
        fw_boot.remove(fw_boot.NEW + "/" + name + ".part")
        self.fh = open(fw_boot.ROOT + fw_boot.NEW + "/" + name + ".part", "wb")
        self.name, self.size, self.want = name, size, want
        self.got = 0
        self.crc = 0
        self.error = None
        self.last_rx = now
        self._reply("OK")

    def _data(self, parts, now):
        if self.fh is None:
            return
        self.last_rx = now
        try:
            data = a2b_base64(parts[1])
        except Exception:
            self.error = "bad data"
            return
        if self.got + len(data) > self.size:
            self.error = "too much data"
            return
        self.fh.write(data)
        self.got += len(data)
        self.crc = config_loader.crc32(data, self.crc)

    def _file_end(self, now):
        if self.fh is None:
            return self._err("no file")
        self._close_file()
        name = self.name
        problem = self.error
        if problem is None and self.got != self.size:
            problem = "size mismatch"
        if problem is None and self.crc != self.want:
            problem = "crc mismatch"
        if problem is not None:
            self.abort(problem)
            return self._err(problem)
        os.rename(fw_boot.ROOT + fw_boot.NEW + "/" + name + ".part", fw_boot.ROOT + fw_boot.NEW + "/" + name)
        gc.collect()                # keep the heap compact: there is very little RAM to spare while files stream in
        print("fw_update: file ok", name, self.size, "free RAM", _ram())
        self.done.append(name)
        self.sizes[name] = self.size
        self.name = None
        self.last_rx = now
        self._reply("OK")

    def _commit(self, parts):
        if self.fh is not None or len(parts) < 2 or parts[1] != self.version:
            return self._err("not ready")
        if len(self.done) != self.count or sum(self.sizes[n] for n in self.done) != self.total:
            self.abort("incomplete")
            return self._err("update incomplete")
        fw_boot.write_atomic(fw_boot.APPLY, self.version + "\n" + "\n".join(self.done) + "\n")
        self._reply("OK")
        self._release()
        self.state = IDLE                       # the staged files stay: fw_boot installs them at the restart
        self.host._reload_at = time.monotonic() + 0.5
