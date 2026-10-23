# SPDX-License-Identifier: GPL-3.0-only
# app_profiles.py - switches the macropad layer to match the focused window.
# Copy this file to the root of CIRCUITPY (next to code.py).
#
# A small program on the laptop (focus_sender.py) sends one line per change over
# the board's second USB serial port:
#       APP<TAB>process name<TAB>window title
# The board picks the first profile that matches and makes it the base layer.
# Anything that matches no profile gets the General layer (profile 0).
#
# - Pressing the knob picks a layer by hand. That choice stays until you switch
#   to a different app, then the app's profile takes over again.
# - If the laptop program stops, the board keeps its current layer and the OLED
#   goes back to showing the layer name.
# - Needs boot.py on the board (it turns the second serial port on), then a
#   full unplug and replug.

import time

import usb_cdc

import gc
import json
import os
import sys

import supervisor

import config_loader
from kmk.modules import Module

try:
    from supervisor import ticks_ms
except ImportError:                 # on a normal computer (the tests)
    def ticks_ms():
        return int(time.monotonic() * 1000) & 0x1FFFFFFF

# The scan loop runs hundreds of times a second: a decimal number made on every pass fills the RAM, and the clean-up
# that follows freezes the key LEDs for about 50 ms. So the 50 ms throttle is kept with whole numbers (ticks_ms).

CFG_CHUNK = 160     # characters per CFG_LINE, same as the app (src/shared/protocol.ts)
RX_TIMEOUT_S = 3.0  # a config transfer that goes quiet this long is dropped

PROTOCOL_VERSION = 2    # 2 = HELLO and the pad's own EVT lines (see app/PROTOCOL.md)
FIRMWARE_VERSION = "0.4.0"  # x.y.z, sent in the HELLO reply. Bump it with every firmware change, and keep it
                            # at or above REQUIRED_FIRMWARE in app/src/shared/firmware.ts (a test checks this).
FS_ROOT = ""            # root of the pad's filesystem; tests point it at a temporary folder
EVENT_QUEUE_MAX = 24    # events kept until the next scan; beyond this the newest are dropped
EVENT_BACKLOG = 256     # if the host has left this many bytes unread, stop sending events


class AppProfiles(Module):
    def __init__(self, profiles, general=0, timeout_s=5.0, view=None, leds=None):
        # profiles: list of (display name, process names, title words), one per layer,
        #   in layer order. Process names match exactly (lower case, no .exe);
        #   a trailing * means "starts with". Title words match anywhere in the title.
        # leds: the RgbKeys module, so LED<TAB>layer<TAB>key<TAB>#RRGGBB can preview a colour.
        # view: function returning the JSON text the app gets for GET_CFG (None = not supported).
        self.profiles = profiles
        self.view = view
        self.leds = leds        # RgbKeys; None = the LED command is not supported
        self.general = general
        self.timeout_s = timeout_s

        self.ser = None
        self.enabled = False
        self.connected = False
        self.app_label = None
        self.manual = False
        self.last_seen = 0
        self.host_os = None     # "windows", "macos" or "linux" once the app has said so

        self._kb = None
        self._buf = b""
        self._proc = None
        self._idx = None
        self._held = 0
        self._pending = None
        self._auto_layer = None
        self._last_ms = 0
        self.ui = None              # OledUI, set by code.py: refused pushes are shown on the screen
        self.encoder = None         # EncoderModes, set by code.py: the knob press that allows a firmware update
        self._fw = None             # the firmware update receiver (fw_update.Updater) while one is loaded
        self._rx = None             # config_loader.Receiver while a config is arriving
        self._rx_t = 0
        self._reload_at = None      # reload the board once a new config is saved
        self.events = False         # the app said HELLO, so tell it about profile changes and key presses
        self._evq = []              # EVT lines waiting to be written
        self._reported_layer = None # last profile reported to the app

    # ------------------------------------------------------------ matching
    def _clean(self, proc):
        p = proc.lower()
        if p.endswith(".exe"):
            p = p[:-4]
        return p

    def _match(self, proc, title):
        p = self._clean(proc)
        t = title.lower()
        for i, prof in enumerate(self.profiles):
            procs = prof[1]
            titles = prof[2]
            for m in procs:
                if m.endswith("*"):
                    if p.startswith(m[:-1]):
                        return i
                elif p == m:
                    return i
            for w in titles:
                if w in t:
                    return i
        return self.general

    def _label(self, idx, proc):
        if idx != self.general:
            return self.profiles[idx][0]
        p = self._clean(proc)
        if not p:
            return "Desktop"
        return (p[:1].upper() + p[1:])[:9]

    # ------------------------------------------------------------ layer control
    def _apply(self, idx):
        # the base layer is the last item; a held layer key sits on top of it
        self._kb.active_layers[-1] = idx
        self._auto_layer = idx
        self._pending = None

    def _request(self, idx):
        if self._held > 0:
            self._pending = idx     # wait until the keys are released
        else:
            self._apply(idx)

    # ------------------------------------------------------------ LED
    def _led(self, parts):
        # LED<TAB>layer<TAB>key<TAB>#RRGGBB -> OK | ERR<TAB>reason.
        # Live preview only: not saved, a reboot goes back to the colours in code.py.
        if self.leds is None:
            self._write("ERR\tRGB is off\n")
            return
        try:
            if len(parts) != 4 or len(parts[3]) != 7 or parts[3][0] != "#":
                raise ValueError("bad command")
            layer = int(parts[1])
            key = int(parts[2])
            rgb = int(parts[3][1:], 16)
        except Exception:
            self._write("ERR\tbad LED command\n")
            return
        if not 0 <= layer < len(self.profiles) or not 0 <= key < 12:
            self._write("ERR\tlayer or key out of range\n")
            return
        try:
            self.leds.set_key(layer, key, rgb)
            self._write("OK\n")
        except Exception as e:
            print("app_profiles LED error:", e)
            self._write("ERR\tcould not set LED\n")

    # ------------------------------------------------------------ HELLO / events
    def _hello(self):
        # HELLO -> HELLO<TAB>protocol<TAB>firmware. From now on the pad reports, on its own:
        #   EVT<TAB>layer<TAB>n          the profile it runs changed
        #   EVT<TAB>key<TAB>n<TAB>1|0    key n (0-11, row by row) went down / up
        # An older app never sends HELLO and so never gets events.
        self._write(self._hello_reply() + "\n")
        self.events = True
        self._evq = []
        self._reported_layer = None     # report the current profile right away

    def _hello_reply(self):
        return "HELLO\t%d\t%s" % (PROTOCOL_VERSION, FIRMWARE_VERSION)

    def _queue_event(self, line):
        if len(self._evq) < EVENT_QUEUE_MAX:
            self._evq.append(line)

    def _send_events(self):
        # events are a courtesy: if sending them ever fails, stop them without touching profile switching
        try:
            self._flush_events()
        except Exception as e:
            print("app_profiles events off:", e)
            self.events = False
            self._evq = []

    def _flush_events(self):
        # Never during a config transfer (replies must not be mixed with events), never to a host that
        # closed the port, and never into a full buffer: events are dropped rather than ever blocking keys.
        if not self._evq or self._rx is not None or self._fw_busy():
            return
        if not getattr(self.ser, "connected", True):
            self.events = False         # the app is gone; it says HELLO again when it comes back
            self._evq = []
            return
        for line in self._evq:
            if getattr(self.ser, "out_waiting", 0) > EVENT_BACKLOG:
                break
            self._write(line)
        self._evq = []

    # ------------------------------------------------------------ firmware update
    def _fw_busy(self):
        return self._fw is not None and self._fw.state != 0

    def _fw_info(self):
        # FW_INFO<TAB>firmware<TAB>circuitpython<TAB>free bytes<TAB>failed. Answered here, not by fw_update: the pad
        # cannot spare the RAM to load that module just to say which firmware it runs (about 4 KB are free).
        # `failed` is why the last update was undone ("-" if it was not), read from /fw_failed and reported once.
        v = sys.implementation.version
        free = 0
        try:
            st = os.statvfs(FS_ROOT or "/")
            free = st[0] * st[3]
        except Exception:
            pass
        failed = "-"
        try:
            with open(FS_ROOT + "/fw_failed") as f:
                failed = "".join(c if " " <= c <= "~" else "?" for c in f.readline().strip())[:60] or "-"
            os.remove(FS_ROOT + "/fw_failed")
        except OSError:
            pass
        self._write("FW_INFO\t%s\t%d.%d.%d\t%d\t%s\n" % (FIRMWARE_VERSION, v[0], v[1], v[2], free, failed))

    def _fw_cmd(self, parts, now):
        # FW_* commands (see fw_update.py). The receiver is only loaded for FW_BEGIN, after the screen's RAM was freed,
        # and dropped again when the update is over, so it takes no RAM in normal use. Everything that does not need
        # it is answered without loading it: the pad has too little RAM to load it next to the screen.
        cmd = parts[0]
        if cmd == "FW_INFO":
            return self._fw_info()
        if self._fw is None:
            if cmd == "FW_DATA":
                return      # stray data after an update was dropped
            if cmd == "FW_ABORT":
                return self._write("OK\n")      # nothing to abort
            if cmd != "FW_BEGIN":
                return self._write("ERR\tno update in progress\n")
            if self._rx is not None:
                return self._write("ERR\tbusy\n")       # a config is arriving: leave it, and the screen, alone
        try:
            if self._fw is None:
                # free the screen's memory first, as for a config push; fw_update restarts the pad afterwards
                gc.collect()
                self._ui_call("suspend")
                gc.collect()
                import fw_update

                self._fw = fw_update.Updater(self, FIRMWARE_VERSION)
            self._fw.handle(parts, now)
            self._fw_check()
        except Exception as e:
            print("app_profiles firmware update error:", e)
            if self._fw is not None:
                try:
                    self._fw.abort()            # releases the knob hook and drops the staged files
                except Exception:
                    pass
            self._fw = None
            sys.modules.pop("fw_update", None)
            if self.ui is not None and self.ui.suspended:
                self._reload_at = time.monotonic() + 3.0    # the screen was freed for the update: restart to get it back
            try:
                self._write("ERR\tfirmware update not available\n")
            except Exception:
                pass

    def _fw_check(self):
        # drop the receiver once it has nothing in progress
        if self._fw is not None and self._fw.state == 0:
            self._fw = None
            sys.modules.pop("fw_update", None)
            gc.collect()

    # ------------------------------------------------------------ GET_CFG
    def _write(self, data):
        if isinstance(data, str):
            data = data.encode("utf-8")
        while data:     # a long write may be accepted in parts
            n = self.ser.write(data)
            if not n:
                break
            data = data[n:]

    def _send_cfg(self):
        # Same framing the app uses to push: CFG_BEGIN<TAB>length<TAB>crc32hex, CFG_LINE<TAB>chunk..., CFG_END
        if self.view is None:
            self._write("ERR\tGET_CFG not supported\n")
            return
        try:
            text = self.view()
            data = text.encode("utf-8")
            self._write("CFG_BEGIN\t%d\t%08x\n" % (len(text), config_loader.crc32(data)))
            for i in range(0, len(text), CFG_CHUNK):
                self._write("CFG_LINE\t" + text[i:i + CFG_CHUNK] + "\n")
            self._write("CFG_END\n")
        except Exception as e:
            print("app_profiles GET_CFG error:", e)
            try:
                self._write("ERR\tcould not read config\n")
            except Exception:
                pass

    # ------------------------------------------------------------ CFG_* (receive a config)
    def _cfg_begin(self, parts, now):
        # CFG_BEGIN<TAB>length<TAB>crc32hex -> OK | ERR<TAB>reason
        self._drop_rx()
        try:
            if self._fw_busy():
                raise OSError("firmware update in progress")
            if not config_loader.can_save():
                raise OSError("drive is visible: replug without holding the top-left key")
            self._rx = config_loader.Receiver(int(parts[1]), parts[2])
            self._rx_t = now
            self._ui_call("suspend")    # frees the screen's RAM for the config that is about to arrive
            self._write("OK\n")
        except Exception as e:
            self._cfg_error(e)

    def _cfg_end(self):
        # Checks length + CRC, tries to build every profile, and only then saves. A config the pad
        # could not run is refused here, so it never reaches the file.
        rx = self._rx
        self._rx = None
        if rx is None:
            self._write("ERR\tno CFG_BEGIN\n")
            return
        try:
            rx.finish()                         # length + CRC of the file the lines were written to
            cfg = config_loader.load_received()
            config_loader.check(cfg)
            config_loader.build_profiles(cfg)
            cfg = None
            config_loader.commit()
        except Exception as e:
            rx.abort()
            rx = None
            self._cfg_error(e)
            return
        print("app_profiles: config saved, reloading")
        self._write("OK\n")
        try:
            self.ser.flush()
        except Exception:
            pass
        self._reload_at = time.monotonic() + 0.5   # let the reply reach the app first

    def _drop_rx(self):
        rx = self._rx
        self._rx = None
        if rx is not None:
            rx.abort()

    def _cfg_error(self, e):
        print("app_profiles config error:", e)
        reason = "".join(c if " " <= c <= "~" else " " for c in str(e))[:60]
        try:
            self._write("ERR\t" + reason + "\n")     # the app gets its answer even if the screen code fails
        except Exception:
            pass
        self._refuse(reason)

    def _refuse(self, reason):
        ui = self.ui
        if ui is not None and ui.suspended:
            # The screen's RAM was released for the transfer and a fragmented heap often can't fit it
            # back, so show the reason on the small screen and restart: the old config.json is kept.
            try:
                ui.show_refused(reason)
            except Exception as e:
                print("app_profiles notice error:", e)
            self._reload_at = time.monotonic() + 3.0
        else:
            self._notify(reason)

    def _ui_call(self, name):
        if self.ui is not None:
            try:
                getattr(self.ui, name)()
            except Exception as e:
                print("app_profiles ui", name, "error:", e)

    def _notify(self, reason):
        if self.ui is not None:
            try:
                self.ui.show_notice(reason, title="PUSH REFUSED", footer="pad keeps old config")
            except Exception as e:
                print("app_profiles notice error:", e)

    # ------------------------------------------------------------ serial input
    def _line(self, raw, now):
        try:
            line = raw.decode("utf-8").strip("\r")
        except Exception:
            return
        parts = line.split("\t")
        if parts[0] == "PING":
            self.ser.write(b"PONG\n")
        elif parts[0] == "LED":
            self._led(parts)
        elif parts[0] == "CFG_BEGIN" and len(parts) >= 3:
            self._cfg_begin(parts, now)
        elif parts[0] == "CFG_LINE":
            if self._rx is not None:
                try:
                    self._rx.add(line[len("CFG_LINE\t"):])
                    self._rx_t = now
                except Exception as e:
                    self._drop_rx()
                    self._cfg_error(e)
        elif parts[0] == "CFG_END":
            self._cfg_end()
        elif parts[0] == "GET_CFG":
            self._send_cfg()
        elif parts[0] == "HELLO":
            self._hello()
        elif parts[0].startswith("FW_"):
            self._fw_cmd(parts, now)
        elif parts[0] == "OS" and len(parts) >= 2:
            self.host_os = parts[1]
            print("app_profiles: host os", self.host_os)
        elif parts[0] == "APP" and len(parts) >= 2:
            proc = parts[1]
            title = parts[2] if len(parts) > 2 else ""
            idx = self._match(proc, title)
            if not self.connected:
                print("app_profiles: helper connected")
            self.connected = True
            self.last_seen = now
            self.app_label = self._label(idx, proc)
            if proc != self._proc or idx != self._idx:
                print("app_profiles:", proc, "->", self.profiles[idx][0])
                self._proc = proc
                self._idx = idx
                self.manual = False
                self._request(idx)

    def _read(self, now):
        n = self.ser.in_waiting
        if not n:
            return
        self._buf += self.ser.read(n)
        if len(self._buf) > 1024:
            self._buf = self._buf[-1024:]
        while b"\n" in self._buf:
            raw, self._buf = self._buf.split(b"\n", 1)
            self._line(raw, now)

    # ------------------------------------------------------------ KMK hooks
    def during_bootup(self, keyboard):
        self._kb = keyboard
        self.ser = usb_cdc.data
        if self.ser is None:
            print("app_profiles: second serial port is off - add boot.py, then unplug and replug")
            return
        self.ser.write_timeout = 1      # never hang the keyboard if the app stops reading
        self._auto_layer = keyboard.active_layers[-1]
        self.enabled = True
        print("app_profiles ready")

    def process_key(self, keyboard, key, is_pressed, int_coord):
        if int_coord is not None:
            if is_pressed:
                self._held += 1
            elif self._held > 0:
                self._held -= 1
            if self.events and 0 <= int_coord < 12:
                self._queue_event("EVT\tkey\t%d\t%d\n" % (int_coord, 1 if is_pressed else 0))
        return key

    def before_matrix_scan(self, keyboard):
        if not self.enabled:
            return None
        ms = ticks_ms()
        # poll every scan while a config or a firmware update is arriving (the port's buffer is small), else every 50 ms
        if (self._rx is None and not self._fw_busy() and self._reload_at is None and not self._evq
                and ((ms - self._last_ms) & 0x1FFFFFFF) < 50):
            return None
        now = time.monotonic()
        if self._reload_at is not None and now >= self._reload_at:
            supervisor.reload()     # start again with the new config.json
        if self._evq:
            self._send_events()     # key events go out on the next scan, not on the 50 ms tick
        if self._rx is None and not self._fw_busy() and ((ms - self._last_ms) & 0x1FFFFFFF) < 50:
            return None
        self._last_ms = ms
        try:
            self._read(now)
            if self._fw is not None:
                self._fw.tick(now)
                self._fw_check()
            if self._rx is not None and now - self._rx_t > RX_TIMEOUT_S:
                self._drop_rx()
                print("app_profiles: config transfer timed out")
                self._refuse("transfer timed out")

            base = keyboard.active_layers[-1]
            if self._auto_layer is not None and base != self._auto_layer:
                self.manual = True      # the knob (or a layer key) chose a layer
                self._auto_layer = base

            if self._pending is not None and self._held == 0:
                self._apply(self._pending)

            base = keyboard.active_layers[-1]
            if self.events and base != self._reported_layer and 0 <= base < len(self.profiles):
                self._reported_layer = base
                self._queue_event("EVT\tlayer\t%d\n" % base)

            if self.connected and now - self.last_seen > self.timeout_s:
                self.connected = False
                self.app_label = None
                self.manual = False
                print("app_profiles: helper stopped sending")
        except Exception as e:
            print("app_profiles error:", e)
            self.enabled = False
        return None

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
