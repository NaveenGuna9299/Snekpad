# SnekPad v1.0.3

A visual refresh of SnekPad Studio: new icon, a splash screen, and a darker, cleaner window.

## SnekPad Studio (desktop app)

- **New app icon.** The SnekPad logo is now the app icon on the window, taskbar and installer.
- **Splash screen.** A short splash with the pad (display, knob and keys) shows while the app starts, and closes as soon as the app is ready.
- **Darker, seamless look.** The title bar now matches the page background, is thinner, and shows the real icon instead of a placeholder. The whole palette is darker.
- **Window fits your screen.** The window opens centred and never larger than your usable screen area, so the bottom of the home page is no longer cut off.
- **No more blank window.** If the page fails to load or the UI crashes, the app now retries or shows an error with a Reload button instead of an empty window. Web and shader caches are no longer kept on disk, which was the cause of the window sometimes opening blank after a forced close.

## Pad firmware (`Programs/`)

No firmware changes in this release.

## Notes

- Config schema version: 1 (unchanged).
- The macOS icon was converted quickly and has not been checked on a Mac.
- Licensed under [MIT](LICENSE).
