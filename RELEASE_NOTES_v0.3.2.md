# SnekPad v0.3.2

## Pad firmware

- **The firmware now supports only the 128x32 screen** that is on the PCB. The 128x64 test-screen layout is gone, which makes the code smaller.
- **New startup logo.** A proper SnekPad logo (icon and wordmark) is shown on the OLED at start-up and when the pad goes idle. It is the file `Programs/snekpad32.bmp`, made from the project logo.
- `flash_pad.ps1` now copies the logo to the pad together with the firmware.
- **To update a pad,** run `Programs/flash_pad.ps1` again (see the app README). A pad that is not updated keeps working as before.

## SnekPad Studio (desktop app)

- The pad preview and the settings only know the 128x32 screen now. Configs saved with another screen height still open and are treated as 128x32.

## Notes

- Config schema version: 1 (unchanged).
- The Windows, macOS and Linux installers are not code-signed. See the README for how to open them.
- Licensed under [MIT](LICENSE) (app) and GPL-3.0 (pad firmware).
