# SnekPad v1.3.0

A keys HUD: a small see-through panel over your other apps that shows what the pad's keys do, and lights a key up while you hold it. No new pad firmware (it stays 0.5.1), and it works with any pad that reports its profile (firmware with protocol 2).

## Keys HUD

- **What it shows.** The keys of the profile the pad is on, each with its label, its colour and its shortcut, plus the profile name and the knob's hint. Edit the profile in Studio and the HUD follows. A key **lights up in its own colour while you hold it** on the pad.
- **When it shows.** Under **Settings → Keys HUD over apps** (and in the tray menu, under **Keys HUD over apps**): **Off**, **On switch** (the default: it shows for a moment each time the pad changes profile, then fades) or **Always**. In **On switch** it stays up while the mouse is on it or its menu is open.
- **Three sizes.** **Compact** (labels only), **Slim** (one row of 12 keys along the top or bottom edge of the screen) and **Comfy** (labels and shortcuts).
- **Opacity.** From 20% to 100%. Only the panel's background changes; the keys and text stay solid.
- **Anywhere on the screen.** Pick a corner, or **drag the top bar** to put it anywhere. Studio remembers the spot, keeps it on a screen (if a monitor goes away it moves to the nearest one), and picking a corner snaps it back.
- **Three dots.** The button at the top right of the HUD opens the same settings on the HUD itself, so you can change the size, the opacity or the place without opening Studio. Studio's own settings follow what you change there.
- **It stays out of the way.** The HUD never takes focus, never shows in the taskbar, and clicks go through it to the app underneath. Only while the mouse is on the panel does it take clicks (for the three dots, the menu and the drag bar). It is made when needed and closed again after a minute hidden, so a Studio in the tray costs no extra memory.

## Notes

- Windows is the system with the HUD (and with app switching). It sits on top of normal and borderless-fullscreen windows; a game in exclusive fullscreen hides it.
- The HUD needs a connected pad that reports its profile. With the mock pad, or a pad from before protocol 2, there is nothing to show.
- Config schema version: 1 (nothing changed). The HUD's settings are kept in `settings.json` in Studio's data folder, not in the pad's config, so **Push to pad** and backups do not carry them.
- Windows, macOS and Linux installers are provided, but they are not code-signed. See the README for how to open them. The Windows portable zip needs no installer. App switching and the HUD are Windows only.
- The release also has `SnekPad-pad-v1.3.0.uf2`, the ready-made image for a new pad (same firmware 0.5.1 as 1.2.0).
- Licensed under [MIT](LICENSE) (app) and GPL-3.0 (pad firmware).
