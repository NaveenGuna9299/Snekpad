# SnekPad v1.1.0

Lighting effects, including two that follow the music, and a pad firmware (0.4.0) that draws them smoothly.

## Lighting effects

- **Home → Lighting effects** in Studio has six effects: **Static** (your per-key colours, as before), **Rainbow** (a wave of colour from left to right), **Ripple** (a ring of a random colour from the key you press), **Starry night** (random keys twinkle), and the two music effects below.
- Choose one and press **Push to pad**. The pad remembers it across a power-off or a restart of the computer, and Studio shows the effect the pad is really running.
- The profile-change colour flash is only for Static; the moving effects show their own motion.
- Effects need pad firmware **0.4.0**. Studio shows **Update pad** for it (press the pad's knob when asked), and a note on the effects page for an older pad.

## Music effects

- **Equalizer:** the four columns of keys are bass, low, high and treble. Each column fills up from the bottom row as that part of the music gets louder.
- **Beat pulse:** all keys flash on the beat and fade out, and the colour moves on round the wheel with every beat.
- Studio listens to **the sound the computer plays** (Windows, system audio loopback). No microphone, no permission prompt, nothing recorded or stored. It sends the pad five small numbers about 25 times a second; the pad smooths them into its animation.
- **They keep working from the tray.** While a music effect is chosen, closing the Studio window only hides it. If Studio starts with Windows, it makes the hidden window about 20 seconds after login. The tray tooltip says when the music lights are on, and **Quit** in the tray menu stops them.
- macOS and Linux builds show the effects but cannot listen to the system sound yet; the effects page says so.

## Pad firmware 0.4.0

- Smooth animation: the effects use whole numbers only and make no new objects while drawing. The pad has only a few KB of free RAM, and every decimal number used some of it; when it ran out the pad froze for about 50 ms to clean up, which showed as shuttering. The screen, serial and knob code were changed the same way, so the pad no longer cleans up its memory several times a second.
- The effects clock counts exact milliseconds, so it does not drift however long the pad has been on.
- New `settings.effect` in the config (`static` by default). A config that does not have it, or that still names an effect tried and taken out during development, means `static`, so no pad loses its profiles.
- The pad reads the music levels straight from the bytes of the serial line and polls its port every 20 ms (instead of 50 ms) while a music effect is chosen.

## Notes

- Config schema version: 1 (unchanged). `effect` is optional.
- Firmware version 0.4.0. Studio still works with firmware from 0.3.3, without the effects.
- The Windows, macOS and Linux installers are not code-signed. See the README for how to open them. The Windows portable zip needs no installer.
- Licensed under [MIT](LICENSE) (app) and GPL-3.0 (pad firmware).
