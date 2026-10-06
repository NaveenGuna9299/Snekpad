"""focus_sender.py - tells the macropad which window is in focus (Windows).

Every half second it reads the focused window (program name + window title) and
sends a short text line to the macropad over USB. The macropad uses it to switch
to that program's shortcut layer and to show the program name on its screen.
The text goes only to the macropad's USB serial port: nothing is saved, logged
or sent anywhere else (unless you run it with --verbose, which prints to the screen).

Setup (once):
    pip install pyserial          (needed to find the macropad's port by itself)
Run:
    python focus_sender.py
    python focus_sender.py --port COM4        (if it can't find the board)
    python focus_sender.py --list             (shows the serial ports it can see)
    python focus_sender.py --once             (prints the focused window and stops)

Run it in the background at login: press Win+R, type  shell:startup , and put a
shortcut there to:   pythonw.exe "C:\\path\\to\\focus_sender.py"
"""

import argparse
import os
import sys
import time

HEARTBEAT = 1.5          # resend the same app this often so the board knows we're alive
POLL = 0.4               # how often the focused window is checked
CIRCUITPY_VIDS = (0x239A, 0x2E8A, 0x303A)   # Adafruit, Raspberry Pi, Espressif

if os.name == "nt":
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

    def get_focus():
        """Return (program file name, window title) of the focused window."""
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return "", ""
        n = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        title = buf.value

        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        proc = ""
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value)
        if handle:
            size = wintypes.DWORD(1024)
            pbuf = ctypes.create_unicode_buffer(1024)
            if kernel32.QueryFullProcessImageNameW(handle, 0, pbuf, ctypes.byref(size)):
                proc = os.path.basename(pbuf.value)
            kernel32.CloseHandle(handle)
        return proc, title
else:
    def get_focus():
        raise SystemExit("focus_sender.py reads the focused window with Windows calls, "
                         "so it only runs on Windows.")


def clean(text, limit):
    """ASCII only, no tabs or line breaks, so one message is always one line."""
    text = text.encode("ascii", "replace").decode("ascii")
    for ch in ("\t", "\r", "\n"):
        text = text.replace(ch, " ")
    return text[:limit]


def make_line(proc, title):
    return "APP\t%s\t%s\n" % (clean(proc, 40), clean(title, 60))


def probe(ser):
    """True if the port answers PING with PONG (that is the macropad's data port)."""
    ser.reset_input_buffer()
    ser.write(b"PING\n")
    deadline = time.time() + 1.0
    got = b""
    while time.time() < deadline:
        got += ser.read(16)
        if b"PONG" in got:
            return True
    return False


def find_port(serial_mod, explicit=None):
    """Open the macropad's data port. Returns an open serial object."""
    if explicit:
        return serial_mod.Serial(explicit, 115200, timeout=0.2, write_timeout=1)

    from serial.tools import list_ports

    for info in list_ports.comports():
        text = " ".join(str(x) for x in (info.description, info.manufacturer, info.product)).lower()
        if info.vid not in CIRCUITPY_VIDS and "circuitpython" not in text:
            continue
        try:
            ser = serial_mod.Serial(info.device, 115200, timeout=0.2, write_timeout=1)
        except Exception:
            continue            # busy (for example open in Thonny / VS Code) - skip
        try:
            if probe(ser):
                return ser
        except Exception:
            pass
        ser.close()
    raise OSError("macropad data port not found (is boot.py on the board, and was it unplugged and replugged?)")


def main():
    ap = argparse.ArgumentParser(description="Send the focused window to the macropad.")
    ap.add_argument("--port", help="serial port of the macropad's data port, e.g. COM4")
    ap.add_argument("--list", action="store_true", help="list serial ports and exit")
    ap.add_argument("--once", action="store_true", help="print the focused window and exit")
    ap.add_argument("--verbose", action="store_true", help="print each message sent")
    args = ap.parse_args()

    if args.once:
        time.sleep(3)            # gives you time to click the window you want to test
        proc, title = get_focus()
        print("program:", proc or "(none)")
        print("title:  ", title or "(none)")
        return

    try:
        import serial
    except ImportError:
        raise SystemExit("pyserial is missing. Run:  pip install pyserial")

    if args.list:
        from serial.tools import list_ports
        for info in list_ports.comports():
            vid = "%04X" % info.vid if info.vid else "----"
            print(info.device, "VID", vid, "-", info.description)
        return

    ser = None
    last = None
    last_send = 0.0
    print("macropad focus sender running - Ctrl+C to stop")
    while True:
        try:
            if ser is None:
                ser = find_port(serial, args.port)
                print("connected on", ser.port)
                last = None
            proc, title = get_focus()
            now = time.time()
            current = (proc.lower(), title)
            if current != last or now - last_send >= HEARTBEAT:
                line = make_line(proc, title)
                ser.write(line.encode("ascii"))
                if args.verbose:
                    print(line.strip().replace("\t", " | "))
                last = current
                last_send = now
            time.sleep(POLL)
        except KeyboardInterrupt:
            break
        except SystemExit:
            raise
        except Exception as e:
            if ser is not None:
                print("lost the macropad:", e)
                try:
                    ser.close()
                except Exception:
                    pass
                ser = None
            else:
                print(e)
            time.sleep(2)


if __name__ == "__main__":
    main()
