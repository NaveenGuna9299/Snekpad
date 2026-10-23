# SnekPad

![SnekPad](<Snekpad Logo.png>)

SnekPad is a 12-key macropad with a rotary knob, a small OLED screen and per-key RGB lighting. It runs
[KMK](https://github.com/KMKfw/kmk_firmware) on CircuitPython (Waveshare RP2040-Zero) and shows up on the computer as a
plain USB keyboard. **SnekPad Studio**, a desktop app, is used to configure it. No cloud, no accounts, no telemetry.

## Download

SnekPad Studio v1.1.4 ([all releases](https://github.com/NaveenGuna9299/Snekpad/releases)):

| OS                      | Download                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows                 | [SnekPad-Studio-Setup-1.1.4.exe](https://github.com/NaveenGuna9299/Snekpad/releases/download/v1.1.4/SnekPad-Studio-Setup-1.1.4.exe)                       |
| Windows (portable)      | [SnekPad-Studio-1.1.4-windows-portable.zip](https://github.com/NaveenGuna9299/Snekpad/releases/download/v1.1.4/SnekPad-Studio-1.1.4-windows-portable.zip) |
| macOS                   | [snekpad-studio-1.1.4.dmg](https://github.com/NaveenGuna9299/Snekpad/releases/download/v1.1.4/snekpad-studio-1.1.4.dmg)                                   |
| Linux (any distro)      | [snekpad-studio-1.1.4.AppImage](https://github.com/NaveenGuna9299/Snekpad/releases/download/v1.1.4/snekpad-studio-1.1.4.AppImage)                         |
| Linux (Debian / Ubuntu) | [snekpad-studio_1.1.4_amd64.deb](https://github.com/NaveenGuna9299/Snekpad/releases/download/v1.1.4/snekpad-studio_1.1.4_amd64.deb)                       |

The installers are not code-signed. Windows may show an "unknown publisher" warning (More info → Run anyway). On macOS,
right-click the app and choose Open the first time. On Linux, make the AppImage executable (`chmod +x`) before running it.
The Windows portable zip needs no installer: unzip it anywhere and run `SnekPad Studio.exe`. When you install over an
older Studio, the installer closes a running Studio (also one in the tray) by itself and tries again if the old version
could not be removed. (Versions 1.1.0 to 1.1.3 could stop with "Failed to uninstall old application files: 2" when installing
over an older Studio; if you see it, run the installer again, or quit Studio from the tray icon first. 1.1.4 fixes the cause.)

**Uninstalling (Windows).** Open Studio, then **Settings → Uninstall SnekPad Studio…** (click twice to confirm). Or use
Windows **Settings → Apps → Installed apps** or Control Panel's Programs and Features, or run
`%LOCALAPPDATA%\Programs\SnekPad Studio\Uninstall SnekPad Studio.exe`. Windows' own list can take a while to show a newly
installed app (or miss it after a sign-out), which is why Studio has the button itself. Your pad and its profiles are not
touched; Studio's settings stay in your user folder. The portable zip has no uninstaller: delete its folder.

The app configures the pad and updates its firmware. A new pad needs its firmware set up by hand once, see
[Quick start](#quick-start); after that, new firmware arrives with a new Studio (**Update pad**, with a knob press on
the pad to allow it).

## What is in this repo

| Folder                  | What it is                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------- |
| [`Programs/`](Programs) | The pad's firmware: Python files that are copied onto the pad's `CIRCUITPY` drive. |
| [`app/`](app)           | SnekPad Studio, the desktop app (Electron + React + TypeScript).                   |

## Features

- 3 x 4 keys, up to 4 profiles, each with its own key actions, labels and per-key RGB colours.
- Rotary knob with three modes (idle, default, press). Each profile sets its own turn and press actions.
- OLED screen showing the active profile and app.
- Lighting effects: in Studio, **Home → Lighting effects** picks how the key LEDs look. **Static** shows your per-key
  colours; **Rainbow** is a wave of colour from left to right; **Ripple** sends a ring of a random colour out from the
  key you press; **Starry night** twinkles random keys in random colours. Choose it, press **Push to pad**: the pad
  remembers the effect across a power-off, and Studio shows the one the pad is running. Needs pad firmware 0.4.0
  (Studio offers **Update pad** for it).
- Music effects: **Equalizer** (the four columns are bass to treble and fill up from the bottom row) and **Beat pulse**
  (all keys flash on the beat, and the colour moves on with every beat). Studio listens to the sound your computer plays
  (Windows only, no microphone) and sends the pad its levels about 25 times a second. They keep working when you close
  the Studio window to the tray, as long as Studio is running (it starts with Windows by default). They also ignore
  the sleep time: the screen still sleeps, but the lights keep following the music (and go dark when it stops).
- The screen and the key LEDs sleep together: after the sleep time (2 minutes by default) both switch off, the screen
  really turns off, and everything comes back as it was on the first key press or knob turn. At half that time they
  dim first (the LEDs drop to their lowest brightness). The time is set in Studio under **Settings → Pad sleeps
  after** (0 = never) and sent to the pad with **Push to pad**.
- LED brightness is changed on the pad with the dim and brighter keys of the utility layer (hold FN). The step you
  choose is remembered across a power-off or a computer restart, and pushing a config from Studio does not reset it.
  Studio has no brightness setting yet.
- A soft start for the LEDs: at power-up they stay dark for about a second, so the computer can finish setting up the
  USB connection, and then fade in over about two seconds. Switching on all 12 LEDs at once could overload a weak or
  crowded USB hub and reset other devices on it (a Bluetooth module, for example).
- A short flash of the new profile's main colour on all keys when the profile changes (automatically or by hand), so
  you notice the switch without looking at the screen. Holding FN does not flash.
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
- A **Mock pad** option in the app (Settings, on the Home screen), so you can try everything without hardware.

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
- [Release notes](RELEASE_NOTES_v1.1.4.md): what is new in this version (older ones are in the same folder).

## License

SnekPad has two licenses, one per folder:

- **Pad firmware, [`Programs/`](Programs/LICENSE): GPL-3.0.** The firmware is built on [KMK](https://github.com/KMKfw/kmk_firmware), which is GPL-3.0, so the firmware has to be GPL-3.0 as well. If you give or sell a pad to someone, they can get this source, and the pad can always be re-flashed.
- **Desktop app, [`app/`](app/LICENSE): MIT.** SnekPad Studio is a separate program that talks to the pad over a serial port.

See [`LICENSE`](LICENSE) and [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). The SnekPad name and logo are not covered by either license.
