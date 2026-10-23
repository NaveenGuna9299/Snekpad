# SnekPad v1.1.3

A small update: installing over an older SnekPad Studio no longer stops with an error.

## The problem

Some people (and one of our own computers) got **"Failed to uninstall old application files. Please try running the installer again.: 2"** when installing a new version over an older one. The installer first runs the old version's uninstaller, which sometimes cannot remove its files (usually because a Studio is still closing, or running in the tray). After clicking OK and running the installer again it worked, sometimes only on the third try.

## What changed

- **The installer closes a running Studio first**, also one that is hidden in the tray, and gives Windows a moment to let go of its files.
- **If the old version still could not be removed, the installer runs the setup again by itself** (up to 3 times), which is what clicking OK and starting it again did by hand.
- If it still fails, the message now says what to do: quit Studio from the tray icon, close any window that shows its folder, and run the installer again.

## Notes

- Studio carries pad firmware **0.4.2**, unchanged: a pad that is already on 0.4.2 sees no **Update pad** strip. A pad on 0.4.0 or 0.4.1 is offered the update, and Studio v1.1.2 and later send it gently (one line at a time) so it fits in the pad's small memory.
- Config schema version: 1 (unchanged).
- The Windows, macOS and Linux installers are not code-signed. See the README for how to open them. The Windows portable zip needs no installer.
- Licensed under [MIT](LICENSE) (app) and GPL-3.0 (pad firmware).
