# SnekPad v1.1.1

A small update: the music lights keep going while the screen sleeps.

## Pad firmware 0.4.1

- **The music effects ignore the screen's sleep.** While **Equalizer** or **Beat pulse** is chosen, the key lights no longer dim or switch off with the screen. The screen still goes to sleep after the sleep time, but the lights keep following the music, and go dark by themselves when the music stops. The key LED toggle (utility layer) still switches them off by hand.
- Static, Rainbow, Ripple and Starry night still dim and switch off with the screen, as before.

## Update

- Studio v1.1.1 carries firmware 0.4.1, so a pad on 0.4.0 shows **Update pad** (press the pad's knob when asked, and do not unplug the pad while it updates).
- Studio itself has no code changes since v1.1.0; the version number follows the firmware it carries. READMEs mention the new behaviour.

## Notes

- Config schema version: 1 (unchanged). Nothing to set: the sleep time keeps its meaning for the screen.
- The Windows, macOS and Linux installers are not code-signed. See the README for how to open them. The Windows portable zip needs no installer.
- Licensed under [MIT](LICENSE) (app) and GPL-3.0 (pad firmware).
