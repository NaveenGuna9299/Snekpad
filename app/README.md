# SnekPad Studio

Desktop app (Electron + React + TypeScript + Tailwind) to configure a SnekPad macropad:
profiles, key actions, labels, per-key RGB colour, and encoder actions. No cloud, no accounts, no telemetry.

## Run

```bash
npm install
npm run dev          # start the app with hot reload
npm test             # unit tests (config validation, serial protocol, device session, sync, mock pad) and UI tests (jsdom)
npm run typecheck
npm run build:win    # Windows installer (electron-builder)
npm run build:mac    # macOS build (run on a Mac)
```

On the Home screen, open **Settings** (top right) and tick **Use a mock pad** to use the whole app without hardware.

## Using the editor

- **Keeping the pad in step.** Edits are saved on this computer as you make them. The top bar says "Changes not on the
  pad yet" until you press **Push to pad**, then "Pad is up to date". When a pad is plugged in, the app reads what the
  pad shows (key labels and colours, and the sleep time) and adopts it only when that would not overwrite unsent edits (or when the app has
  no record of the pad yet), so it does not throw away your work.
- **Settings** (on the Home screen) holds **Pad sleeps after** (minutes before the pad's screen and key lights switch
  off, 2 by default, 0 = never; it is part of the pad's config, so it reaches the pad with **Push to pad**), Start with Windows, Restore starter profiles, the theme (System, Dark, Light) and the mock pad. The
  **Profiles** button hides the profile list to give the pad more room.
- **Keys.** Pick the action type with the buttons in the inspector. A sequence lets you re-record a step and move steps
  up or down. Drag a key onto another to swap them (the FN key, bottom right, always stays put). Deleting a profile,
  restoring the starter profiles, pasting and swapping show a message with **Undo**.
- **On the pad (needs the updated firmware).** The profile the pad runs is marked "On pad", Home shows it, and keys
  light up on the pad drawing while you hold them. This uses protocol 2 (`HELLO` and `EVT`, see [PROTOCOL.md](PROTOCOL.md)).
  A pad without the updated `app_profiles.py` works exactly as before, just without these.
- **Firmware update.** The pad reports its firmware version when the app connects. Every Studio carries the matching
  firmware, and when the pad's is older a strip offers **Update pad** (also under Settings → Pad firmware). The pad asks
  you to press its knob to allow it, the files are sent and checked, and the pad restarts by itself and installs
  them. If the new firmware does not run, the pad puts the old one back. See
  [Updating the pad's firmware](#updating-the-pads-firmware-from-studio). A pad too old to update itself (before
  firmware 0.3.4) is told to need one flash from the computer first. The strip can be dismissed until the pad is
  plugged in again.
- **Key test (development builds only).** A development build of Studio has a **Test keys** button on the Home screen;
  the production app does not. See [Development tools](#development-tools-not-in-the-customer-build).

### Keyboard shortcuts

| Shortcut                          | What it does                                    |
| --------------------------------- | ----------------------------------------------- |
| Ctrl/Cmd + Z                      | Undo                                            |
| Ctrl/Cmd + Shift + Z, or Ctrl + Y | Redo                                            |
| Ctrl/Cmd + Enter                  | Push to pad                                     |
| Arrow keys                        | Move between the keys on the pad                |
| Alt + Arrow keys                  | Swap the selected key with its neighbour        |
| Ctrl/Cmd + C, Ctrl/Cmd + V        | Copy the selected key and paste it onto another |

Shortcuts do not run while you type in a text box, and the FN key cannot be copied or swapped.

## Development tools (not in the customer build)

For checking a new pad, and for diagnosing one remotely, there is a **key test**: every key of the pad lights up on
screen as you press it, presses are counted and ticked off, and the knob's turns right / left and presses are counted
too. While it is open the pad types nothing on the computer, so testing a key cannot run its shortcut (Ctrl+W, the snip
key, ...). Studio also ignores shortcuts such as Ctrl+W while the screen is open, as a second safeguard.

This is for development only, so there are **two separate builds** of both the app and the pad firmware, and the
customer builds contain none of it:

|        | Development (for testing)                                                                                                                        | Customer (production)                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Studio | `npm run dev`, or `npm run build:dev` (Windows: an unpacked "SnekPad Studio DEV" in `dist-dev/`, with its own app id, settings and no installer) | `npm run build:win:setup`, `build:mac`, `build:linux` (what the releases ship). The key test is compiled out, and CI fails if it is found in the bundle. |
| Pad    | `.lash_pad.ps1 -MpyCross <path> -Dev` builds and writes `dev_tools.mpy` (from `Programs/dev/dev_tools.py`) and keeps the watchdog off            | `.lash_pad.ps1 -MpyCross <path>` (no `-Dev`). `dev_tools` is not built, and it is deleted from the pad if an earlier dev flash left it there.            |

**When testing is done**, flash the pad again without `-Dev`: it removes `dev_tools.mpy` and `/nowatchdog`, rewrites the
customer firmware and switches the watchdog on (add `-ResetConfig` to also start from the built-in profiles). The pad
then answers `HELLO` without the `dev` flag, ignores `TEST` and sends no knob events, so nothing on a computer can
silence its keys through the serial port. A dev Studio on a customer pad shows a warning on the key test screen instead
of silencing anything, and a production Studio has no key test at all. The pad-side code is in
[`Programs/dev/dev_tools.py`](../Programs/dev/dev_tools.py); the protocol part is in [PROTOCOL.md](PROTOCOL.md).

## Setting up a new pad

A new pad (Waveshare RP2040-Zero) is set up by hand once, on Windows, in the order below. After that, firmware updates
run from the app (see [below](#updating-the-pads-firmware-from-studio)). You need Python 3 (from python.org: on Windows
the `python` command of the Microsoft Store is only a stub and does not work, use `py -3` or the real install) and the
`Programs/` folder of this repository.

The pad's `CIRCUITPY` drive is only 1 MB. Only the files named below go on it.

1. **CircuitPython 10.3.1.** Download the `.uf2` for the board from circuitpython.org/board/waveshare_rp2040_zero.
   Hold BOOT while plugging in USB, release it, and drag the `.uf2` onto the **`RPI-RP2`** drive (not `CIRCUITPY`: the
   `.uf2` is 1.8 MB and cannot fit there). The board restarts by itself and a `CIRCUITPY` drive appears. A pad that was
   used before can be wiped first with Raspberry Pi's `flash_nuke.uf2` (the same BOOT steps), then step 1 again.
2. **Download three things** (none of them is stored in this repository):
   - **KMK:** github.com/KMKfw/kmk_firmware. Unzip it; you need the folder named `kmk` inside.
   - **The Adafruit libraries:** the 10.x bundle from circuitpython.org/libraries (the `.mpy` one). Unzip it; you need
     three items from its `lib` folder, see step 5.
   - **mpy-cross:** the build for your computer that matches CircuitPython exactly, from
     `adafruit-circuit-python.s3.amazonaws.com/index.html?prefix=bin/mpy-cross/` (on Windows
     `mpy-cross-windows-10.3.1.static.exe`).
3. **Compile the firmware.** Left as plain `.py` source, KMK and the firmware use so much RAM on the RP2040 that the OLED
   fails with `MemoryError` (seen on CircuitPython 10.3.1), so everything is compiled to `.mpy` first. In PowerShell:

   ```powershell
   cd "G:\SnekPad\Programs"
   py -3 build_mpy.py --mpy-cross "C:\Downloads\mpy-cross-windows-10.3.1.static.exe" --kmk "C:\Downloads\kmk_firmware-main\kmk"
   ```

   Use your own paths, in quotes. Do not type the `<` `>` of a placeholder: PowerShell reads `>` as "write to a file".
   `--kmk` must point at the folder named `kmk`. The result is in `Programs/build/`, and the output ends with
   `built into ...\Programs\build` and `71 kmk files` (the number can differ).

4. **Copy the build to the pad.** Copy everything in `Programs/build/` to the root of `CIRCUITPY`, **except the `ota`
   folder** (that is the update bundle for the app, it does not belong on the pad) and **except `boot.py`**, which goes
   in last (step 6). This brings the compiled `kmk/` folder, `firmware.mpy`, the other `.mpy` files and a two-line
   `code.py` that starts the firmware. Never copy KMK's own `kmk` folder from the zip: it is source code, it uses too
   much RAM, and because CircuitPython loads a `.py` before a `.mpy` of the same name, a leftover `.py` would win.
   Delete such a folder (and any `.py` that has a `.mpy` twin) from `CIRCUITPY`.
5. **Copy the three libraries.** Create a folder `lib` on `CIRCUITPY` and copy only these into it, not the whole bundle:

   | Library                           | Used by                      |
   | --------------------------------- | ---------------------------- |
   | `neopixel.mpy`                    | `rgb_keys.py` (per-key LEDs) |
   | `adafruit_displayio_ssd1306.mpy`  | `oled_ui.py` (OLED driver)   |
   | `adafruit_display_text/` (folder) | `oled_ui.py` (text labels)   |

6. **`boot.py` last, then a full power cycle.** Copy `Programs/build/boot.py` to `CIRCUITPY`. It hides the drive and turns
   on the second serial port the app talks to, but only after a real power-up: eject the drive in Explorer, unplug the
   pad, wait 5 seconds, and plug it in again **without holding a key**. The drive must not appear again. (To get the drive
   back later, hold the top-left key while plugging in.)
7. **Check and finish with `flash_pad.ps1`.** With the drive hidden, run, in `Programs`:

   ```powershell
   .\flash_pad.ps1 -MpyCross "C:\Downloads\mpy-cross-windows-10.3.1.static.exe"
   ```

   It writes the start-up logo (`snekpad32.bmp`), checks every file, restarts the pad and prints `PASS` or `FAIL` for the
   firmware, OLED, knob, LEDs, crashes, watchdog and development tools. Expect `PASS: the pad is flashed and running`.
   Close SnekPad Studio first (it holds the pad's serial port) and do not unplug the pad while it runs. Without the logo
   file the screen shows the text SNEKPAD instead of the image.

Do not copy `focus_sender.py`: it runs on the PC as an alternative to this app. Edit the files in `../Programs`, never on
the pad, and run `build_mpy.py` and `flash_pad.ps1` again after every change.

**If something goes wrong**

| What you see                                    | Why, and what to do                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| The `.uf2` will not copy ("not enough space")   | You are on `CIRCUITPY`. It goes on `RPI-RP2` (hold BOOT while plugging in).                                         |
| No lights, no logo, the drive is visible        | Something is missing, usually the compiled `kmk/` folder (the firmware imports it first). Check the list in step 4. |
| `flash_pad.ps1`: `Read-only filesystem`         | The drive is still visible to the computer. Redo the power cycle of step 6, without holding a key.                  |
| `flash_pad.ps1`: `No SnekPad console found`     | The computer does not see the pad: try another USB port or cable, and close SnekPad Studio.                         |
| The screen shows the text SNEKPAD, not the logo | `snekpad32.bmp` is not on the pad yet: run `flash_pad.ps1`.                                                         |
| `MemoryError` on the pad's console              | KMK or the firmware is on the pad as `.py`: use the compiled `Programs/build` output only.                          |

### Updating the pad's firmware from Studio

For the person using the pad: when a new Studio brings newer firmware, press **Update pad** in the strip at the top (or
Settings → Pad firmware), follow the dialog (press the pad's knob when asked, do not unplug), and wait about half a
minute while the pad restarts. If anything goes wrong the pad keeps, or goes back to, its old firmware.

**Do not unplug the pad while it is updating.** The firmware is written to the pad's flash drive, and cutting the power
in the middle of a write can corrupt that drive. CircuitPython then reformats it on the next start, and the pad comes
back as an empty CircuitPython board (no lights, no screen, a `CIRCUITPY` drive with a `Hello World!` `code.py`). The
update's rollback cannot help with that, because it lives on the same drive. It is recoverable: put KMK, the libraries
and the firmware back as in [Setting up a new pad](#setting-up-a-new-pad) and run `flash_pad.ps1`. This was found by
unplugging a pad mid-update on purpose.

How it works, and the rules, are in [PROTOCOL.md](PROTOCOL.md#firmware-update-fw_). In short:

- A release builds the firmware once in CI (`Programs/build_mpy.py`), which also writes `build/ota/` (the files and a
  `manifest.json`). That folder is put into every Studio build as `resources/firmware`.
- Locally: `python build_mpy.py --mpy-cross <path>` in `Programs`, then `npm run firmware:bundle` here to copy the
  bundle to `resources/firmware` (`npm run dev` and the builds then offer the update). `npm run firmware:check` checks
  it. A build without a bundle never offers an update.
- Only the firmware modules are updated this way. `boot.py`, the `code.py` stub, `fw_boot.mpy` (the safety net),
  `kmk/`, `lib/` and CircuitPython itself still need `flash_pad.ps1`, which is also how a pad gets the updater the
  first time (pads before firmware 0.3.4 do not have it).
- To try an update on a development build: set `SNEKPAD_FIRMWARE_DIR` to a folder with another bundle (it is ignored in
  the production build).
- A new firmware that hangs in the first seconds after start (before the watchdog is armed) does not undo itself;
  unplugging and replugging the pad 3 times does.

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
console. Flash again without `-Dev` before the pad goes to a customer (this also removes the key test tools, see [Development tools](#development-tools-not-in-the-customer-build)). The watchdog is also off whenever the drive is
visible (top-left key held while plugging in).

`config.json` is not copied by hand: the pad creates it when you push from the app. Until then it uses the built-in
profiles in `code.py`.

## Layout

```
src/shared/config.ts     config types, limits (4 profiles, 3x4 keys, 5-char labels), validation, starter profiles
src/shared/protocol.ts   serial line protocol: framing, CRC32, reply parsing, HELLO / EVT parsing, config receiver
src/shared/firmware.ts   the firmware version the app needs and how a pad's reported version is judged
src/shared/sync.ts       "is the pad up to date?": compares the editor with what the pad is known to hold
src/shared/theme.ts      theme choice and the native window colours
src/main/device/         Link interface, real USB serial link, mock link, DeviceSession, DeviceManager
                         (DeviceSession runs push / pull / LED preview one at a time and routes the pad's own events)
src/main/store.ts        config.json, last-pushed.json (what the pad holds) and settings.json (theme) in the user
                         data folder (atomic writes)
src/main/focusWatcher.ts which program has focus (Windows), for automatic profile switching
src/preload/index.ts     the only bridge to the renderer (typed, contextIsolation on)
src/renderer/            UI: pad view, profile sidebar, key / encoder inspector, top bar, settings, toasts
src/renderer/src/lib/    useStudio (document, device and sync state), useHistory (undo), useShortcuts
tests/                   vitest; tests/ui/ holds the component tests (React Testing Library in jsdom, with a stand-in
                         for the preload bridge in tests/ui/stubApi.ts)
../Programs/tests/       the pad's serial handling run on a normal Python with fake modules (no hardware):
                         python -m unittest discover -s Programs/tests -v
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

Done: schema + validation, mock pad, pad editor UI, undo/redo, keyboard shortcuts, key swap / copy / paste, local save,
dark and light theme, serial link (finds the pad by CircuitPython VID + PING/PONG), config push with length + CRC
check, one-at-a-time commands so replies cannot be mixed up, up-to-date tracking, firmware receiver (`CFG_*`,
`GET_CFG`, `LED`; the pad saves `config.json` and restarts), the four-mode knob, the tray with active-window
detection (`APP` messages, Windows), Windows / macOS / Linux installers, and the pad's own reports (`HELLO` / `EVT`:
active profile and held keys), the firmware version check, the key test screen, and UI tests.

The pad's `HELLO` / `EVT` firmware is covered by tests that run it with fake modules, but it has not been tried on a
real pad yet.

Pushing needs the pad's drive hidden (the normal case, set in `boot.py`). If you plugged the pad in with the top-left key
held, the pad refuses the push: replug it without the key.

Not done yet:

- Import/export of `.snekprofile.json`, per-profile LED effects, auto-update of Studio itself, and profile
  switching by focused app on macOS and Linux.

See `PROTOCOL.md` for the messages.
