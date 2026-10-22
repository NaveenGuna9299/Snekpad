# SnekPad v1.0.0

The first full release of SnekPad: the pad firmware (CircuitPython + KMK, Waveshare RP2040-Zero) and SnekPad Studio, the desktop app that sets it up.

## Update the pad's firmware from Studio

- When a Studio build carries newer firmware than the pad has, Studio shows **Update pad** (also in Settings → Pad firmware). No cable swap, no script.
- **The pad asks for a knob press first.** Nothing on the computer can install firmware without someone at the pad. If nobody presses the knob within 30 seconds, nothing changes.
- The pad checks every file (size and checksum) and installs them at its next restart. If the new firmware does not run, the pad **goes back to the old firmware by itself** and Studio tells you why.
- Studio refuses a firmware built for another CircuitPython version, and only a fixed list of firmware files can ever be replaced. `boot.py`, `kmk/`, `lib/` and your saved config are never touched.
- **Do not unplug the pad while it updates.** Cutting the power while the pad is writing can corrupt its storage; the pad then comes back as an empty CircuitPython board and has to be re-flashed (see the app README, "Setting up a new pad").

## Pad firmware

- **Key LEDs follow the screen:** they dim when the screen dims and switch off with it. The screen really switches off (panel off), and a short colour flash marks a change of profile.
- **The sleep time is a setting.** Settings → "Pad sleeps after" (0 = never, up to 60 minutes, default 2), sent to the pad with Push to pad and read back from it.
- The firmware version is reported to Studio.
- The key test and knob events are development tools: they are **not in the customer firmware or the production Studio build**.

## SnekPad Studio (desktop app)

- Firmware update dialog and a notice when the pad's firmware is older than the app's.
- Sleep time in Settings.
- Studio keeps greeting the pad after it restarts (after a config push or a firmware update), so its state is never stale.

## Notes

- Config schema version: 1 (unchanged). A config without `sleepMinutes` gets the default.
- The Windows, macOS and Linux installers are not code-signed. See the README for how to open them.
- Licensed under [MIT](LICENSE) (app) and GPL-3.0 (pad firmware).
