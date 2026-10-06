# SnekPad v1.0.2

SnekPad Studio now switches the pad's profile by itself, and keeps doing it after you close the window.

## SnekPad Studio (desktop app)

- **Automatic profile switching works from the app.** Before, the app never told the pad which program was in focus, so the pad stayed on the General profile unless the separate `focus_sender.py` script was running. The app now watches the focused window and the pad switches to that program's profile within about half a second. You no longer need `focus_sender.py` (do not run both at once). **This part is Windows only for now.**
- **Closing the window keeps the app running in the tray,** so profile switching keeps working. Click the tray icon to reopen the window; right-click it and choose Quit to stop it. Only one copy of the app runs at a time.
- **New "Start with Windows" option** in the top bar (installed Windows build). The app then starts hidden in the tray at login, creates no window, and waits 20 seconds before it starts any work, so it does not slow down startup. It is switched on the first time an installed build runs; you can turn it off from the top bar or in Windows' Startup settings.
- The program file is now called `SnekPad Studio.exe` (it showed up as `app` in Task Manager's Startup list). If you installed v1.0.1, the old `app` startup entry may stay listed; disable it in Task Manager.

## Pad firmware (`Programs/`)

No firmware changes in this release.

## Known limitations

- Automatic profile switching and Start with Windows are Windows only. On macOS and Linux the tray icon and keep-running-after-close work, but the app does not yet report the focused program to the pad.
- The new Windows, macOS and Linux installers were built by the release workflow. Only the Windows build has been tried on a real pad.
- The same limitations as v1.0.1 apply (the app does not install firmware yet; tight RAM with a 128x64 OLED).

## Notes

- Config schema version: 1 (unchanged).
- Licensed under [MIT](LICENSE).
