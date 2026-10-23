# SnekPad v1.1.4

Fixes "Failed to uninstall old application files ... : 2" when installing a new Studio over an older one.

## The problem

Installing Studio v1.1.1, v1.1.2 and v1.1.3 over an older version stopped with **"Failed to uninstall old application files. Please try running the installer again.: 2"**, and the same dialog came back on the next try.

## The cause

The installer window shows a progress bar by looking at how much of the install folder has been written. It did that with Electron's own file functions, which treat an `.asar` file as a folder and **keep it open for as long as the program runs**. The old Studio's `resources/app.asar` was therefore held open by the installer itself, and the old version's uninstaller could not delete it (exit code 2). Nothing else was wrong: the same setup run without the installer window worked every time.

## What changed

- **The installer window looks at the folder with plain file functions (`original-fs`)**, so nothing in the old install stays open. Tried here: the installer window over a running old Studio now installs in about 12 seconds with no error.
- The retry and the "close a running Studio first" step from v1.1.3 stay as a safety net.

## Uninstall from inside Studio

- **Settings → Uninstall SnekPad Studio…** (Windows installer builds). It asks twice, then starts the uninstaller that sits next to the app and closes Studio. Your pad and its profiles are not touched.
- Why: Windows' own lists (Settings → Installed apps, Control Panel's Programs and Features) can take a while to show a newly installed app, or lose it for a while after the installer's own uninstall step ran, so an app could not be found there even though it was installed. The uninstaller itself was always there (`%LOCALAPPDATA%\Programs\SnekPad Studio\Uninstall SnekPad Studio.exe`); now Studio starts it for you.
- The README says how to uninstall, including the portable zip (delete its folder).

## Notes

- Studio and the pad firmware (0.4.2) are unchanged.
- Config schema version: 1 (unchanged).
- The Windows, macOS and Linux installers are not code-signed. See the README for how to open them. The Windows portable zip needs no installer.
- If you still get the error from an older installer, run the new installer or quit Studio from the tray icon first.
- Licensed under [MIT](LICENSE) (app) and GPL-3.0 (pad firmware).
