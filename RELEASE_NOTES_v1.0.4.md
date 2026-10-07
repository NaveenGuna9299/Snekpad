# SnekPad v1.0.4

A memory release: SnekPad Studio now uses less than half the memory while it sits in the tray switching profiles.

## SnekPad Studio (desktop app)

- **Much lighter in the tray.** With the window closed, the app uses about 70 MB instead of about 154 MB (measured on Windows, counting every process the app starts).
  - **Closing the window now frees it.** The window used to be hidden, which kept the whole interface in memory. It is now closed and rebuilt when you open it from the tray. Edits are saved as you make them, so nothing is lost.
  - **No more PowerShell helper.** Profile switching used to run a PowerShell process in the background to see which program has focus. The app now asks Windows directly, which removes that process and its console host. Switching works the same way.
  - **Software rendering.** The interface is flat panels and text, so the GPU process now uses less memory (about 11-13 MB). It looks the same.
- **Own window no longer triggers a profile switch.** Opening Studio is now ignored by the focus watcher by process id, not just by name.

## Pad firmware (`Programs/`)

No firmware changes in this release.

## Notes

- The focus watcher now uses [koffi](https://github.com/Koromix/koffi) (MIT), a small native module that ships with the app. It is listed in `THIRD-PARTY-NOTICES.md`.
- Config schema version: 1 (unchanged).
- Only the Windows build was measured and tested. The macOS and Linux builds are unchanged in behaviour (profile switching by focused app is Windows-only).
- Licensed under [MIT](LICENSE).
