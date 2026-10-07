# SnekPad v0.2.0

## SnekPad Studio (desktop app)

- **Update check.** Settings has a **Check for updates** button, and the app checks once when it opens (turn this off in Settings). When a newer release exists, Settings shows a dot and a button that opens the download page. The app only reads the public "latest release" from GitHub and never downloads or installs anything itself, because the installers are not code-signed.
- **Settings moved to Home.** It opens from the top right of Home. The editor top bar keeps only Home, Profiles, Undo, Redo and Push.
- Saving the theme no longer drops other saved settings.

## Notes

- This version has the same pad firmware as v0.1.0. Nothing needs to change on the pad.
- Config schema version: 1 (unchanged).
- The Windows, macOS and Linux installers are not code-signed. See the README for how to open them.
- Licensed under [MIT](LICENSE).
