# SnekPad Studio

Desktop app (Electron + React + TypeScript + Tailwind) to configure a SnekPad macropad:
profiles, key actions, labels, per-key RGB colour, and encoder actions. No cloud, no accounts, no telemetry.

## Run

```bash
npm install
npm run dev          # start the app with hot reload
npm test             # unit tests (config validation + serial protocol + mock pad)
npm run typecheck
npm run build:win    # Windows installer (electron-builder)
npm run build:mac    # macOS build (run on a Mac)
```

Tick **Mock pad** in the top bar to use the whole app without hardware.

## Setting up a new pad

The app does not install firmware yet, so a new pad (Waveshare RP2040-Zero) is set up by hand. Do it in this order.

1. **CircuitPython 10.x.** Download the `.uf2` from circuitpython.org/board/waveshare_rp2040_zero. Hold BOOT while
   plugging in USB, then drag the `.uf2` onto the `RPI-RP2` drive. The board restarts as `CIRCUITPY`.
2. **KMK firmware.** Download github.com/KMKfw/kmk_firmware and copy its `kmk/` folder to the root of `CIRCUITPY`.
3. **Libraries.** Download the Adafruit CircuitPython library bundle (10.x) from circuitpython.org/libraries and copy
   only these into `CIRCUITPY/lib/`:

   | Library                           | Used by                      |
   | --------------------------------- | ---------------------------- |
   | `neopixel.mpy`                    | `rgb_keys.py` (per-key LEDs) |
   | `adafruit_displayio_ssd1306.mpy`  | `oled_ui.py` (OLED driver)   |
   | `adafruit_display_text/` (folder) | `oled_ui.py` (text labels)   |

4. **Pad programs, precompiled.** Left as plain `.py` source, KMK and the firmware use so much RAM on the RP2040 that
   the OLED fails with `MemoryError` (seen on CircuitPython 10.3.1). So compile them to `.mpy` first:

   1. Download the `mpy-cross` build that matches your CircuitPython version from
      `adafruit-circuit-python.s3.amazonaws.com/index.html?prefix=bin/mpy-cross/` (for example
      `mpy-cross-windows-10.3.1.static.exe`).
   2. Run, in `../Programs`: `python build_mpy.py --mpy-cross <path to mpy-cross> --kmk <path to your kmk folder>`
   3. Copy everything in `Programs/build/` to the root of `CIRCUITPY` (it replaces `code.py` with a two-line stub
      that runs the compiled `firmware.mpy`, and includes `kmk/`).
   4. Delete the `.py` files that now have a `.mpy` twin from `CIRCUITPY` (the old `kmk/` `.py` files,
      `config_loader.py`, `rgb_keys.py`, `encoder_modes.py`, `app_profiles.py`, `oled_ui.py`), because CircuitPython
      loads a `.py` before a `.mpy` of the same name.

   Do not copy `focus_sender.py`: it runs on the PC as an alternative to this app. Edit the files in `../Programs`,
   never on the pad, and run `build_mpy.py` again after every change.

5. **Check it works** (keys, LEDs and screen respond) while the drive is still visible.
6. **`boot.py` last.** Copy `boot.py`, then unplug and replug the pad. It hides the drive and turns on the second serial
   port this app talks to. To get the drive back later, hold the top-left key while plugging in USB.

### Updating or re-flashing a pad that is already set up (Windows)

Once `boot.py` has hidden the drive, `Programs/flash_pad.ps1` does steps 4.2 to 4.4 for you over the pad's USB console,
so no drive is needed:

```powershell
cd Programs
.\flash_pad.ps1 -MpyCross <path to mpy-cross>
```

It builds the firmware, removes leftovers from the pad (old `.py` files that shadow a `.mpy`, `.bak` and `.new` files,
editor and trash folders), writes the files and checks the size of each one, restarts the pad, and prints PASS or FAIL.
It does not touch `kmk/`, `lib/` or `boot.py` settings, and it keeps `config.json` (add `-ResetConfig` to delete it).
The pad's console port is found automatically. Close anything else that has it open (a terminal, Thonny). The app
scans serial ports, so if the script says the port is busy, wait a few seconds and run it again.

**Watchdog and crash recovery.** The customer build resets the pad by itself if the main loop freezes for 5 seconds,
and if the firmware stops with an error (for example a `MemoryError`) the `code.py` stub restarts it up to 3 times,
then leaves it running so it can be inspected. Unplugging the pad starts over. While you develop, add `-Dev` to the
command: it creates a `/nowatchdog` file on the pad so the watchdog does not reset the pad while you are at the
console. Flash again without `-Dev` before the pad goes to a customer. The watchdog is also off whenever the drive is
visible (top-left key held while plugging in).

`config.json` is not copied by hand: the pad creates it when you push from the app. Until then it uses the built-in
profiles in `code.py`.

## Layout

```
src/shared/config.ts     config types, limits (4 profiles, 3x4 keys, 5-char labels), validation, starter profiles
src/shared/protocol.ts   serial line protocol: framing, CRC32, reply parsing, config receiver
src/main/device/         Link interface, real USB serial link, mock link, DeviceManager
src/main/store.ts        config.json + last-pushed.json in the user data folder (atomic writes)
src/preload/index.ts     the only bridge to the renderer (typed, contextIsolation on)
src/renderer/            UI: pad view, profile sidebar, key / encoder inspector, top bar
tests/                   vitest
```

## The rotary encoder (knob)

The knob has three modes. Each profile sets its own turn and press actions in the **Rotary encoder** panel.

| Mode    | When                                              | What the knob does                                                                                               |
| ------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Idle    | The pad's screen is showing the owner/logo screen | The first turn or press only wakes the screen. It does nothing else, so you can't change the volume by accident. |
| Default | Any other time                                    | Turning runs the profile's **turn left / turn right** action (volume, tab, scroll, ...).                         |
| Press   | Any other time                                    | Pressing runs the profile's **press** action (for example mute).                                                 |

Profiles follow the focused app. To pick one by hand, use the `L0`/`L1` keys on the utility layer (hold the bottom-right
key); the screen then shows that profile's name with a `*`.

In the app:

- **Press** has an action and a label of up to 5 characters. The pad no longer shows the label; it is kept in the config.
- Turn and short-press actions can be a media key, a single shortcut, a single key, or nothing. A shortcut of two or more
  ordinary keys pressed together (not counting Ctrl, Shift, Alt and GUI) does not work on the knob.
- "Next profile" no longer exists as a press action. Older saved configs that used it are converted when loaded:
  the starter profiles get their default short press (mute, save, Enter, play/pause), any other profile gets "Nothing".
- The direction and clicks-per-step are firmware settings in `code.py` (`ENCODER_REVERSE`, `ENCODER_DIVISOR`), not in the app.

## Status

Done: schema + validation, mock pad, pad editor UI, undo/redo, local save, serial link (finds the
pad by CircuitPython VID + PING/PONG), config push with length + CRC check, firmware receiver
(`CFG_*`, `GET_CFG`, `LED`; the pad saves `config.json` and restarts), the four-mode knob.

Pushing needs the pad's drive hidden (the normal case, set in `boot.py`). If you plugged the pad in with the top-left key
held, the pad refuses the push: replug it without the key.

Not done yet:

- Tray agent + active-window detection (`APP` messages), import/export of `.snekprofile.json`,
  firmware installer, per-profile LED effects, installers and auto-update.

See `PROTOCOL.md` for the messages.
