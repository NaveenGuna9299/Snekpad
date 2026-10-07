"""Precompile the SnekPad firmware to .mpy so it fits in the RP2040's RAM.

Why: with everything left as .py source, CircuitPython compiles it in RAM on every boot, and on the
Waveshare RP2040-Zero (CircuitPython 10.x) that leaves too little memory for the OLED screen
("MemoryError" in oled_ui). Compiled .mpy files load much smaller.

Usage (Python 3, run on the computer, not on the pad):

    python build_mpy.py --mpy-cross PATH_TO_MPY_CROSS [--kmk PATH_TO_KMK_FOLDER]

  --mpy-cross   the mpy-cross build that matches the pad's CircuitPython version. Download it from
                https://adafruit-circuit-python.s3.amazonaws.com/index.html?prefix=bin/mpy-cross/
                (for example mpy-cross-windows-10.3.1.static.exe). `mpy-cross --version` must report
                the same CircuitPython version as `boot_out.txt` on the pad.
  --kmk         the `kmk/` folder you copied onto the pad (optional, but it saves the most RAM).

Output goes to Programs/build/. Copy EVERYTHING in it to the root of CIRCUITPY, then delete the old
.py files that now have a .mpy twin (CircuitPython prefers .py over .mpy of the same name):
config_loader.py, rgb_keys.py, encoder_modes.py, app_profiles.py, oled_ui.py and the kmk/ .py files.
code.py is replaced by a two-line stub that runs the compiled firmware.mpy. Edit code.py in this
folder, not on the pad, and run this script again after every change to a .py file.
"""

import argparse
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "build")

# modules imported by code.py that get their own .mpy
MODULES = ("config_loader", "rgb_keys", "encoder_modes", "app_profiles", "oled_ui")

# code.py can't be .mpy itself, so the pad's code.py just imports the compiled firmware.
# If the firmware stops with an error (for example a MemoryError) the stub resets the pad, up to
# 3 times in a row. After that it stays up, so the pad can be inspected, and unplugging it starts over.
# The Heartbeat module in code.py clears the count after a minute of normal running.
# nvm[0] = crashes in a row, nvm[1] = 0xA5 when the stub itself asked for the reset: the pad reports
# "power on" after microcontroller.reset() too, so that marker is how a real power-on is told apart.
STUB = '''import microcontroller
import supervisor
import time

nvm = microcontroller.nvm
if supervisor.runtime.run_reason == supervisor.RunReason.STARTUP and nvm[1] != 0xA5:
    nvm[0] = 0
nvm[1] = 0
try:
    import firmware
    firmware.keyboard.go()
except Exception as e:
    n = nvm[0]
    n = (n if n < 10 else 0) + 1
    nvm[0] = n
    print("firmware stopped:", repr(e), "(crash", n, "of 3)")
    if n <= 3:
        nvm[1] = 0xA5
        time.sleep(1)
        microcontroller.reset()
    while True:
        microcontroller.watchdog.feed()
        time.sleep(1)
'''


def compile_one(mpy_cross, src, dst, name):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    # -s sets the file name shown in tracebacks
    r = subprocess.run([mpy_cross, "-s", name, src, "-o", dst], capture_output=True, text=True)
    if r.returncode:
        sys.exit("mpy-cross failed on %s:\n%s" % (src, r.stderr))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mpy-cross", required=True, help="path to the mpy-cross executable")
    ap.add_argument("--kmk", help="path to the kmk/ folder from the pad, compiled too")
    args = ap.parse_args()

    ver = subprocess.run([args.mpy_cross, "--version"], capture_output=True, text=True)
    if ver.returncode:
        sys.exit("can't run mpy-cross: " + (ver.stderr or ver.stdout))
    print(ver.stdout.strip())

    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)

    compile_one(args.mpy_cross, os.path.join(HERE, "code.py"), os.path.join(OUT, "firmware.mpy"), "firmware.py")
    for m in MODULES:
        compile_one(args.mpy_cross, os.path.join(HERE, m + ".py"), os.path.join(OUT, m + ".mpy"), m + ".py")
    with open(os.path.join(OUT, "code.py"), "w", newline="\n") as f:
        f.write(STUB)
    shutil.copyfile(os.path.join(HERE, "boot.py"), os.path.join(OUT, "boot.py"))

    n = 0
    if args.kmk:
        root = os.path.abspath(args.kmk)
        for d, _, files in os.walk(root):
            for fn in files:
                src = os.path.join(d, fn)
                if fn.endswith(".py") and os.path.getsize(src) > 0:
                    rel = os.path.relpath(src, os.path.dirname(root)).replace(os.sep, "/")
                    compile_one(args.mpy_cross, src, os.path.join(OUT, rel[:-3] + ".mpy"), rel)
                    n += 1
                elif fn.endswith(".py"):
                    # empty __init__.py files have nothing to compile, copy them as they are
                    rel = os.path.relpath(src, os.path.dirname(root))
                    os.makedirs(os.path.dirname(os.path.join(OUT, rel)), exist_ok=True)
                    shutil.copyfile(src, os.path.join(OUT, rel))

    print("built into", OUT)
    print("  firmware.mpy, code.py (stub), boot.py, %d modules, %d kmk files" % (len(MODULES), n))


if __name__ == "__main__":
    main()
