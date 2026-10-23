# SnekPad v1.1.2

Fixes the firmware update from Studio for a pad on firmware 0.4.0 or 0.4.1.

## The problem

When a pad on firmware 0.4.0 was updated from Studio v1.1.1, the pad showed "press knob to allow", but after the knob press Studio said **"no reply from pad"** and the pad stayed on that screen until it was unplugged (it then still ran the old firmware, nothing was lost).

The cause: while the pad receives an update it has only a few KB of free RAM, in small pieces. Studio sent the firmware as 96-byte lines back to back, and the pad read several at once (386 bytes), ran out of memory on the second file, and stopped answering.

## What changed

- **Studio sends the firmware gently:** 48-byte lines, one at a time, and it waits for the pad (`PING` / `PONG`) after each. The pad never has more than one line waiting. The update takes a few seconds longer. This is the fix for pads already on 0.4.0 or 0.4.1, because the pad being updated does the receiving.
- **Pad firmware 0.4.2** also reads at most 160 bytes from its port at a time while an update runs, so later updates do not depend on Studio being this careful.
- If the pad stops answering in the middle, Studio now stops after about 2 seconds with "no reply from pad" and tells the pad to drop what it staged, instead of waiting for a long time.

## Update

- A pad on 0.4.0 or 0.4.1 is offered **Update pad** when it connects to Studio v1.1.2 (press the pad's knob when asked, and do not unplug the pad while it updates).
- If an earlier try got stuck on the "press knob" screen, unplug the pad and plug it in again first. It keeps its old firmware and its profiles.

## Notes

- Config schema version: 1 (unchanged).
- The Windows, macOS and Linux installers are not code-signed. See the README for how to open them. The Windows portable zip needs no installer.
- Installing over an older Studio: close Studio first (right-click its tray icon and choose Quit). If the installer says "Failed to uninstall old application files", run it again.
- Licensed under [MIT](LICENSE) (app) and GPL-3.0 (pad firmware).
