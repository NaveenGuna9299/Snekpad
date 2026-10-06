# SnekPad v1.0.1

A fix release for the pad firmware (the OLED screen and config pushes) and the desktop app.

## SnekPad Studio (desktop app)

- **Fixed a crash:** the app could show "A JavaScript error occurred in the main process: Writing to COM port (GetOverlappedResult): Operation aborted". This happened when the pad restarted or was unplugged while the app was talking to it. A failed serial write is now treated as a disconnect and the app reconnects by itself.

## Pad firmware (`Programs/`)

On the Waveshare RP2040-Zero with CircuitPython 10.3.1, the firmware as plain `.py` source used up almost all of the pad's RAM. With a screen fitted, the OLED failed to start (`MemoryError`), and with the OLED running a config push could silently stop the pad from answering the app.

- **The OLED now starts.** `oled_ui.py` only keeps the main screen in memory. The owner, logo, profile-switcher and notice screens are built when they are shown.
- **Config pushes work with the OLED running.** The pad now writes the incoming config straight to flash instead of holding it in RAM, and releases the screen's memory while a config is being received.
- **A refused push no longer breaks the pad.** The pad answers the app with the error, shows the reason on its screen, and restarts about 3 seconds later with the old config. Before, the OLED could stay off and the pad could stop answering until you replugged it.
- **New build script:** `Programs/build_mpy.py` compiles the firmware to `.mpy` files, which load much smaller than source.

## Updating an existing pad

The new firmware is **not** installed by the app. To update a pad you already built:

1. Update the app (install the new installer).
2. Follow step 4 of [Setting up a new pad](app/README.md#setting-up-a-new-pad): download the `mpy-cross` build that matches your CircuitPython version, run `python build_mpy.py --mpy-cross <path> --kmk <your kmk folder>` in `Programs/`, copy `Programs/build/` to the pad, and delete the old `.py` files that now have a `.mpy` twin.

The new firmware was tested on one pad (Waveshare RP2040-Zero, CircuitPython 10.3.1, a 128x64 I2C OLED).

## Known limitations

- The app does not install firmware yet; a pad is updated by hand.
- If you use a 128x64 OLED, free RAM on the pad is tight (about 12 KB after start-up). Very large configs may still be refused with a memory error; the pad then keeps its old config.
- The same limitations as v1.0.0 about knob shortcuts and firmware-only knob settings apply.

## Notes

- Config schema version: 1 (unchanged).
- Licensed under [MIT](LICENSE).
