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

   | Library | Used by |
   |---|---|
   | `neopixel.mpy` | `rgb_keys.py` (per-key LEDs) |
   | `adafruit_displayio_ssd1306.mpy` | `oled_ui.py` (OLED driver) |
   | `adafruit_display_text/` (folder) | `oled_ui.py` (text labels) |

4. **Pad programs.** Copy these files from `../Programs` to the root of `CIRCUITPY`: `code.py`, `config_loader.py`,
   `app_profiles.py`, `encoder_modes.py`, `oled_ui.py`, `rgb_keys.py`. Do not copy `focus_sender.py`: it runs on the PC
   as an alternative to this app.
5. **Check it works** (keys, LEDs and screen respond) while the drive is still visible.
6. **`boot.py` last.** Copy `boot.py`, then unplug and replug the pad. It hides the drive and turns on the second serial
   port this app talks to. To get the drive back later, hold the top-left key while plugging in USB.

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

The knob has four modes. Each profile sets its own turn and short-press actions in the **Rotary encoder** panel.

| Mode | When | What the knob does |
|---|---|---|
| Idle | The pad's screen is showing the owner/logo screen | The first turn or press only wakes the screen. It does nothing else, so you can't change the volume by accident. |
| Default | Any other time | Turning runs the profile's **turn left / turn right** action (volume, tab, scroll, ...). |
| Short press | Press and release in under 0.5 s | Runs the profile's **short press** action (for example mute), then back to Default. |
| Profile switcher | Hold the knob for 0.5 s | Turn to choose a profile, short press to confirm, hold again to cancel. It also cancels after 5 s without input. |

While the knob is held, the top of the pad's screen shows what releasing will do (`REL:MUTE`), a progress bar and a
countdown to the switcher (`SWITCH 0.3s`). A profile chosen in the switcher stays until you change app, and the
screen shows a `*` next to the app name.

In the app:
- **Short press** has an action and a label of up to 5 characters. The label is what the pad's screen shows while the knob is held.
- Turn and short-press actions can be a media key, a single shortcut, a single key, or nothing. A shortcut of two or more
  ordinary keys pressed together (not counting Ctrl, Shift, Alt and GUI) does not work on the knob.
- "Next profile" no longer exists as a press action. Older saved configs that used it are converted when loaded:
  the starter profiles get their default short press (mute, save, Enter, play/pause), any other profile gets "Nothing".
- The hold time, switcher timeout and direction are firmware settings in `code.py` (`KNOB_HOLD_S`,
  `KNOB_SWITCH_TIMEOUT_S`, `ENCODER_REVERSE`, `ENCODER_DIVISOR`), not in the app.

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
