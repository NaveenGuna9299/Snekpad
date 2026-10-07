# SnekPad v0.1.0

The first numbered release. Earlier releases (v1.0.0 to v1.0.4) were removed and the version restarted at 0.1.0, because the project is still early. Everything from them is included.

## SnekPad Studio (desktop app)

- **Knows what the pad has.** The top bar shows whether your changes are on the pad ("Changes not on the pad yet" / "Pad is up to date"). Plugging the pad in again no longer overwrites edits you have not sent, and no longer wipes undo.
- **Safer talking to the pad.** Push, read and live colour preview now run one at a time, so a colour change made during a push can no longer be taken for the push's answer.
- **Faster to edit.**
  - Shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo, Ctrl/Cmd+Enter send to the pad, arrow keys move between keys, Ctrl/Cmd+C and V copy and paste a key.
  - Drag a key onto another to swap them, or use Alt+Arrow. The FN key stays put.
  - Action types are buttons instead of a dropdown. Sequence steps can be re-recorded and moved up or down. Label fields show a live "4/5" counter.
  - Deleting a profile, restoring the starter profiles, pasting and swapping show a message with **Undo** instead of a blocking confirm dialog.
- **Cleaner top bar.** Start with Windows, Restore starter profiles and the mock pad moved into a **Settings** menu. A **Profiles** button hides the profile list to give the pad more room.
- **Light theme.** Settings has System, Dark and Light. Small text is a little larger.
- **Pad status (needs the updated firmware).** The profile the pad is running is marked "On pad", Home shows it, and keys light up on the drawing while you hold them on the pad.
- Autosave waits a moment after you stop typing instead of writing on every keystroke, and saves again when the window closes.

## Pad firmware (`Programs/`)

- New: the pad answers `HELLO` and reports its active profile and key presses (protocol version 2, documented in `app/PROTOCOL.md`). It only does this after the app asks, never during a config transfer, never to a host that closed the port, and it can never block the keys. Update `app_profiles.py` on the pad to get the pad status features above; without it everything else works as before.
- **Not yet tried on a real pad.** It is covered by tests that run the pad's code with fake modules, but the USB port and timing have not been checked on hardware.

## Notes

- Installers for v1.0.x were removed. If you installed one, uninstall it first: the installer may refuse to replace a "newer" version with 0.1.0.
- Config schema version: 1 (unchanged).
- Profile switching by focused app is Windows-only. Only the Windows build has been tried by hand; the macOS and Linux builds are produced by CI.
- Licensed under [MIT](LICENSE).
