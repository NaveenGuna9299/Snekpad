# SnekPad v1.4.0

Layers, double-tap and tap/hold keys for the keys you have most of, and a much lighter screen that gives the pad back about 14 KB of memory. New pad firmware (0.6.0): **a pad with older firmware needs one flash from the computer first** (see below).

## Layers for Studio-only profiles

- **Up to 2 extra layers.** A Studio-only profile (the profiles Studio keeps itself and puts on the pad when their app is in focus) can have up to two more sets of 12 keys. Open the profile, click **+ Add layer**, and use the **Main keys / Layer 2 / Layer 3** tabs to edit each one.
- **Layer keys.** Set a key to **Layer**: **hold** it to use the layer while held, or **toggle** it to switch to the layer and back. Choosing a layer key on a profile with no layers adds the first one for you.
- **On the pad.** The screen shows the layer's own legend, the key LEDs show its colours, and the knob keeps the profile's actions. A layer you are holding is switched off when the profile changes.
- **Studio has to be running** for a Studio-only profile, as before: the pad gets the profile when its app comes into focus.

## Tap / hold and double tap

- **Tap / hold** on any key: a tap does one thing, holding does another (for a Studio-only profile, the hold can be a layer key). The hold time is yours to set, 100 to 1000 ms.
- **Double tap** (Studio-only profiles): a double tap does a third thing. With a double tap, a single tap is sent only after the double-tap window has passed.
- **On the pad's own profiles** only tap/hold with a plain key is available. Layers, layer keys and double tap are for Studio-only profiles; Studio takes them out of a profile you move onto the pad, and tells you so.

## A lighter screen

The main screen page used to draw its text with 14 separate label objects, about 16 KB. It now draws the same text from rows of font tiles. It looks the same (the legend is still centred to the pixel), and the pad has about 14 KB more free memory once the screen is up. That memory is what makes layers and double tap fit: a Studio-only profile with two layers and a double tap leaves 13.8 KB free on a pad that only has General.

| Measured on a pad (free memory) | before | now |
|---|---|---|
| after the screen starts, 3 profiles on the pad | 5.2 KB | 17.3 KB |
| a plain Studio-only profile, General only on the pad | 7.5 KB | 18.6 KB |
| a Studio-only profile with 2 layers and double tap | 2.4 KB | 13.8 KB |

Studio's memory meter for Studio-only profiles uses the new numbers. A pad that runs out of memory while building a profile now says "profile too big for the pad" instead of "unknown key".

## Updating the pad

- **Firmware 0.6.0 adds two files** (`slot_keys.mpy` and `key_extras.mpy`). A pad checks an update against the files it already knows, so a pad on **0.5.1 or older cannot take this update from Studio**. Studio says so and links to the release page. Flash it once from the computer, and after that updates run from Studio again: either with `SnekPad-pad-v1.4.0.uf2` (hold BOOT while plugging the pad in and drag the file onto the `RPI-RP2` drive; it wipes the pad, so send your profiles again with **Push to pad**), or with `Programs/flash_pad.ps1` (keeps the pad's config).
- **From 0.6.0 on, updates can add files.** Firmware 0.6.0 accepts a new module name when an update brings one (only plain `.mpy` names that would not replace something the pad already has), so this is the last release that needs a manual flash for that reason.
- Your profiles are safe: Studio keeps them, a config saved by 1.3.0 loads unchanged, and a pad that was flashed with the script keeps its config.

## Notes

- Config schema version: 1 (nothing changed). The new fields (`layers`, the `layer` and `tap_hold` actions) are optional; a pad with older firmware refuses a config that uses `tap_hold` and keeps running its built-in profiles.
- A layer key on a profile that is sent to a pad with firmware older than 0.6.0 does nothing; Studio warns about it.
- The key highlight and the legend are drawn with a different method than before. If you see anything off on your screen, please say so.
- Windows, macOS and Linux installers are provided, but they are not code-signed. See the README for how to open them. The Windows portable zip needs no installer. App switching and the keys HUD are Windows only.
- The release also has `SnekPad-pad-v1.4.0.uf2`, the ready-made image for a new pad (firmware 0.6.0).
- Licensed under [MIT](LICENSE) (app) and GPL-3.0 (pad firmware).
