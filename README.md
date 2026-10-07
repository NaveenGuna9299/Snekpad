# SnekPad

![SnekPad](<Snekpad Logo.png>)

SnekPad is a 12-key macropad with a rotary knob, a small OLED screen and per-key RGB lighting. It runs
[KMK](https://github.com/KMKfw/kmk_firmware) on CircuitPython (Waveshare RP2040-Zero) and shows up on the computer as a
plain USB keyboard. **SnekPad Studio**, a desktop app, is used to configure it. No cloud, no accounts, no telemetry.

## Download

SnekPad Studio v0.1.0 ([all releases](https://github.com/NaveenGuna9299/Snekpad/releases)):

| OS | Download |
|---|---|
| Windows | [snekpad-studio-0.1.0-setup.exe](https://github.com/NaveenGuna9299/Snekpad/releases/download/v0.1.0/snekpad-studio-0.1.0-setup.exe) |
| macOS | [snekpad-studio-0.1.0.dmg](https://github.com/NaveenGuna9299/Snekpad/releases/download/v0.1.0/snekpad-studio-0.1.0.dmg) |
| Linux (any distro) | [snekpad-studio-0.1.0.AppImage](https://github.com/NaveenGuna9299/Snekpad/releases/download/v0.1.0/snekpad-studio-0.1.0.AppImage) |
| Linux (Debian / Ubuntu) | [snekpad-studio_0.1.0_amd64.deb](https://github.com/NaveenGuna9299/Snekpad/releases/download/v0.1.0/snekpad-studio_0.1.0_amd64.deb) |

The installers are not code-signed. Windows may show an "unknown publisher" warning (More info → Run anyway). On macOS,
right-click the app and choose Open the first time. On Linux, make the AppImage executable (`chmod +x`) before running it.

The app only configures the pad. A new pad still needs its firmware set up by hand, see [Quick start](#quick-start).

## What is in this repo

| Folder | What it is |
|---|---|
| [`Programs/`](Programs) | The pad's firmware: Python files that are copied onto the pad's `CIRCUITPY` drive. |
| [`app/`](app) | SnekPad Studio, the desktop app (Electron + React + TypeScript). |

## Features

- 3 x 4 keys, up to 4 profiles, each with its own key actions, labels and per-key RGB colours.
- Rotary knob with three modes (idle, default, press). Each profile sets its own turn and press actions.
- OLED screen showing the active profile and app.
- Automatic profile switching based on the focused app (Windows). The app can start with Windows and keep switching
  profiles from the tray with its window closed.
- Config is pushed from the app over USB serial with a length and CRC check, then saved on the pad as `config.json`.
- The app always shows whether the pad is up to date ("Pad is up to date" / "Changes not on the pad yet"), and plugging
  the pad in again never overwrites edits you have not sent.
- A quick editor: undo / redo, keyboard shortcuts, drag a key onto another to swap them, copy and paste keys, and a
  message with **Undo** instead of "are you sure?" dialogs. See [Keyboard shortcuts](app/README.md#keyboard-shortcuts).
- Dark and light theme (or follow the system).
- With the updated firmware, the app also shows which profile the pad is running ("On pad") and lights up keys on the
  pad drawing while you hold them on the real pad.
- A **Mock pad** option in the app (Settings), so you can try everything without hardware.

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

SnekPad has two licenses, one per folder:

- **Pad firmware, [`Programs/`](Programs/LICENSE): GPL-3.0.** The firmware is built on [KMK](https://github.com/KMKfw/kmk_firmware), which is GPL-3.0, so the firmware has to be GPL-3.0 as well. If you give or sell a pad to someone, they can get this source, and the pad can always be re-flashed.
- **Desktop app, [`app/`](app/LICENSE): MIT.** SnekPad Studio is a separate program that talks to the pad over a serial port.

See [`LICENSE`](LICENSE) and [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). The SnekPad name and logo are not covered by either license.
