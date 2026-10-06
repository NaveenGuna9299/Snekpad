# SnekPad v1.0.0

First stable release of SnekPad: a 12-key macropad with a rotary knob, OLED screen and per-key RGB, plus **SnekPad Studio**, the desktop app used to configure it. No cloud, no accounts, no telemetry.

## Highlights

- **3 x 4 keys, up to 4 profiles.** Each profile has its own key actions, labels (up to 5 characters) and per-key RGB colours.
- **Rotary knob with four modes:** idle, default, short press, and a hold-to-open profile switcher. Each profile sets its own turn and press actions (volume, tab, scroll, mute, and so on).
- **OLED screen** showing the active profile and app, with live feedback while the knob is held.
- **Automatic profile switching** based on the focused app.
- **SnekPad Studio** (Electron + React + TypeScript): edit profiles, keys, colours and knob actions, then push them to the pad over USB serial.
- **Safe config transfer:** length and CRC32 checks, then saved on the pad as `config.json`.
- **Mock pad mode:** try the whole app without any hardware.
- The pad appears to the computer as a plain USB keyboard (KMK on CircuitPython, Waveshare RP2040-Zero).

## Getting started

- **App:** `cd app && npm install && npm run dev`, or build the Windows installer with `npm run build:win`. See [`app/README.md`](app/README.md).
- **Pad:** install CircuitPython 10.x, KMK and three Adafruit libraries, then copy the files from `Programs/` onto the `CIRCUITPY` drive. Step-by-step instructions are in [Setting up a new pad](app/README.md#setting-up-a-new-pad).
- **Protocol:** serial messages between the app and the pad are documented in [`app/PROTOCOL.md`](app/PROTOCOL.md).

## Known limitations

- The app does not install firmware yet; a new pad is set up by hand.
- A knob shortcut of two or more ordinary keys pressed together does not work (Ctrl, Shift, Alt and GUI modifiers are fine).
- Knob hold time, switcher timeout and direction are firmware settings in `code.py`, not in the app.
- The "Next profile" press action was removed. Older saved configs that used it are converted when loaded.

## Notes

- Config schema version: 1.
- Licensed under [MIT](LICENSE).
