# SnekPad

![SnekPad](<Snekpad Logo.png>)

SnekPad is a 12-key macropad with a rotary knob, a small OLED screen and per-key RGB lighting. It runs
[KMK](https://github.com/KMKfw/kmk_firmware) on CircuitPython (Waveshare RP2040-Zero) and shows up on the computer as a
plain USB keyboard. **SnekPad Studio**, a desktop app, is used to configure it. No cloud, no accounts, no telemetry.

## What is in this repo

| Folder | What it is |
|---|---|
| [`Programs/`](Programs) | The pad's firmware: Python files that are copied onto the pad's `CIRCUITPY` drive. |
| [`app/`](app) | SnekPad Studio, the desktop app (Electron + React + TypeScript). |

## Features

- 3 x 4 keys, up to 4 profiles, each with its own key actions, labels and per-key RGB colours.
- Rotary knob with four modes (idle, default, short press, profile switcher). Each profile sets its own turn and press actions.
- OLED screen showing the active profile and app.
- Automatic profile switching based on the focused app.
- Config is pushed from the app over USB serial with a length and CRC check, then saved on the pad as `config.json`.
- A **Mock pad** option in the app, so you can try everything without hardware.

## Quick start

**The app**

```bash
cd app
npm install
npm run dev
```

See [`app/README.md`](app/README.md) for tests, builds, the knob modes and the current status.

**The pad**

A new pad is set up by hand: install CircuitPython, KMK and three Adafruit libraries, then copy the files from
`Programs/` onto the pad. The step-by-step instructions are in
[`app/README.md`](app/README.md#setting-up-a-new-pad).

## Documentation

- [`app/README.md`](app/README.md): running the app, setting up a pad, the knob.
- [`app/PROTOCOL.md`](app/PROTOCOL.md): the serial messages between the app and the pad.

## License

[MIT](LICENSE)
