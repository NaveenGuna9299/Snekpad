# SnekPad v1.2.0

Ten profiles instead of four, profiles that switch on a website, a ready-made image that sets up a new pad in one step, and a knob that no longer misses clicks. Needs pad firmware 0.5.1 for most of it.

## Ten profiles: 3 on the pad, 7 in Studio

- The pad has memory for only a few profiles, so Studio now keeps **up to seven more of its own** and puts the right one on the pad when its app comes to the front. The list has two groups: **On the pad** (General and two more, they work with Studio closed) and **Studio only** (up to seven). **New**, **Copy** and **Import** fill the pad's group first; **Move to Studio only / Move to the pad** changes a profile's group (General always stays on the pad).
- How it works: Studio notices the app in focus, sends that profile's keys to a spare layer on the pad (about half a second the first time, then it is already there), and the pad switches to it. Studio-only profiles are never pushed with **Push to pad**, and editing one does not make the config "not up to date".
- **Studio has to be running, in the tray at least**, for the Studio-only profiles, and app switching works on **Windows**. In **Settings** you can tick **Start with Windows**.
- If you used four profiles on the pad before, the first three stay on the pad and the fourth moves to Studio only when you open this version. The starter profiles are now General, VS Code and Terminal on the pad, and Browser in Studio only.
- Studio tries the pad's own profiles first, then the Studio-only ones. When several profiles fit the same window, **the best fit wins**: a title word that matches counts more than a program that matches, a profile with both beats one with either, and a tie goes to the earlier one in the list. A Studio-only profile takes an app from a pad profile only when it fits better.

## Switch on a website or a document

- Under **Switch to this profile when…** there is now **…or when the window title contains**: up to six words, capitals do not matter. A browser shows the site's name in its title bar, so `YouTube`, `Gmail` or `Figma` give you a profile for that site in any browser. A profile can have programs, title words, or both.
- The title Studio sends the pad is now 120 characters long instead of 60 (a site's name sits at the end of a browser's title).

## Know what fits, and try it

- **Pad memory meter.** A Studio-only profile shows a bar with an estimate of how much of the pad's spare memory it will use. Keys and plain shortcuts cost almost nothing, typed text a little, and macros (sequences, and shortcuts of several ordinary keys) the most. The bar turns amber when it is close and red when the pad will probably refuse the profile. It is fitted to measurements on a real pad and good to about a third; the pad has the last word. A profile it refuses shows "Too big for the pad" in the list and the pad stays on General for that app.
- **Try on pad.** Shows the selected Studio-only profile on the pad for about 15 seconds without opening its app, and follows your edits while it is up, so you can look at its keys, colours and screen.

## Export, import and backup

- **Export…** and **Import…** under the profile list save one profile to a `.json` file and add one from a file (with a new id). Use them to share a profile or move it to another computer.
- **Settings → Back up all profiles…** saves everything in one file: the pad's profiles, the Studio-only ones and the settings. **Restore from a backup…** replaces what is in Studio with it (Undo brings the old config back; the pad itself only changes with **Push to pad**).
- Studio-only profiles live only in Studio on your computer, so a backup is worth making. Studio also keeps its own copy of your config before it is overwritten, at most one every 30 minutes and the newest ten, in `%APPDATA%\snekpad-studio\snekpad\backups`. They are ordinary backup files, and **Restore from a backup…** opens on that folder.

## A ready-made image for a new pad

- The release has a new file, **`SnekPad-pad-v1.2.0.uf2`**. To set up a pad: hold **BOOT** while plugging it in, drag the file onto the **`RPI-RP2`** drive, wait for the pad to restart, then unplug and plug it in once more. It holds CircuitPython 10.3.1, KMK, the three libraries, the compiled firmware (0.5.1), the logo and the license texts. No downloading, compiling or copying by hand. It replaces everything on the pad, including its config.
- The versions it is made from are pinned and checked by SHA-256, and GitHub checks the drive it builds with other file system tools before the release.
- Setting a pad up by hand (the steps in the README) still works.

## Pad firmware 0.5.1

- **The knob no longer misses clicks.** The firmware used to look at the knob's two contacts once per pass of its main loop, and dropped a click whenever it missed one of the four states, for example while the screen was redrawing or the lights were updating. The knob is now counted by the RP2040's own hardware counter, so every click is counted even when the pad is busy. Clicks counted during a busy moment are typed one at a time, a few milliseconds apart. If the counter cannot be used the pad falls back to the old way and says so on its console.
- The new **Studio slot** (a spare layer filled by Studio) and the messages that fill it (`SLOT_*`, see `app/PROTOCOL.md`). The pad keeps 3 profiles of its own, a config saved with four still loads and runs the first three. A Studio profile that would leave the pad with less than 2 KB of free memory is refused instead of making the pad unstable.
- Update from Studio: **Update pad** on the Home screen (press the pad's knob when asked), for pads on firmware 0.3.4 or newer. A new pad can take the `.uf2` above instead.

## Upgrading

- Install Studio over the old one as before. Open it, and if the pad has older firmware use **Update pad**. Studio-only profiles and **Try on pad** need firmware 0.5.0 or newer; with an older pad those apps get General.
- Your config is upgraded when Studio loads it (the fourth pad profile moves to Studio only). **An older Studio drops the Studio-only profiles if it opens the upgraded config**, so back up first if you want to be able to go back (**Settings → Back up all profiles…**).

## Notes

- Config schema version: 1 (a `studioProfiles` list was added; configs without it are fine).
- Profiles kept on the pad are matched by the pad, which still takes the first one that fits; the best-fit rule is Studio's. This only matters if two overlapping profiles are on the pad.
- Windows is the system with app switching. macOS and Linux builds are provided but do not switch profiles by app yet.
- The Windows, macOS and Linux installers are not code-signed. See the README for how to open them. The Windows portable zip needs no installer.
- Licensed under [MIT](LICENSE) (app) and GPL-3.0 (pad firmware).
