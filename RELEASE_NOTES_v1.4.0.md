# SnekPad v1.4.0

Layers, double-tap and tap/hold keys for the keys you have most of, and a much lighter screen that gives the pad back about 14 KB of memory (about 11 KB once the new code is counted). New pad firmware (0.6.0), which Studio installs on your pad like any earlier update (see below).

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

The main screen page used to draw its text with 14 separate label objects, about 16 KB. It now draws the same text from rows of font tiles. It looks the same (the legend is still centred to the pixel), and the pad has about 14 KB more free memory once the screen is up. That memory is what makes layers and double tap fit: a Studio-only profile with two layers and a double tap leaves 14.4 KB free on a pad that only has General.

| Measured on a pad (free memory) | before | now |
|---|---|---|
| after the screen starts, the 3 starter profiles on the pad | about 5 KB | 15.1 KB |
| a plain Studio-only profile, General only on the pad | 9.2 KB | 17.9 KB |
| a Studio-only profile with 2 layers and double tap | (new: 2.4 KB at best with the old screen) | 14.4 KB |

Studio's memory meter for Studio-only profiles uses the new numbers. A pad that runs out of memory while building a profile now says "profile too big for the pad" instead of "unknown key".

## Updating the pad

- **From Studio, as before.** A pad that came with Studio 1.3.0 (firmware 0.5.1) takes the 0.6.0 update from Studio 1.4.0: open Studio, click the firmware update, press the knob on the pad when it asks. Nothing has to be flashed from the computer, and your profiles are kept.
- **Future updates can add files.** Firmware 0.6.0 accepts a new module name when an update brings one (only plain `.mpy` names that would not replace something the pad already has), so a later release will not need a manual flash just because it has a new file.
- **Memory.** The pad has about 2–3 KB less free at start-up, to hold the layer, tap/hold and Studio-profile code. The lighter screen more than makes up for it.

## Notes

- Config schema version: 1 (nothing changed). The new fields (`layers`, the `layer` and `tap_hold` actions) are optional; a pad with older firmware refuses a config that uses `tap_hold` and keeps running its built-in profiles.
- A layer key on a profile that is sent to a pad with firmware older than 0.6.0 does nothing; Studio warns about it.
- The key highlight and the legend are drawn with a different method than before. If you see anything off on your screen, please say so.
- Windows, macOS and Linux installers are provided, but they are not code-signed. See the README for how to open them. The Windows portable zip needs no installer. App switching and the keys HUD are Windows only.
- The release also has `SnekPad-pad-v1.4.0.uf2`, the ready-made image for a new pad (firmware 0.6.0).
- Licensed under [MIT](LICENSE) (app) and GPL-3.0 (pad firmware).
