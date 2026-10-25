# SnekPad serial protocol

Transport: the pad's second USB serial port (`usb_cdc.data`, enabled in `boot.py`), 115200 baud.
One message per line, `\n` terminated, fields separated by TAB. ASCII only.

| App sends                              | Pad replies                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PING`                                 | `PONG`                                                       | Used to find the data port (the console port never answers). Implemented in firmware.                                                                                                                                                                                                                                                                                                                                                         |
| `OS<TAB>windows` (or `macos`, `linux`) | none                                                         | Sent once right after the app connects. The pad stores it in `AppProfiles.host_os`. The app already swaps CTRL for GUI in "use Cmd on macOS" shortcuts before pushing a config on a Mac.                                                                                                                                                                                                                                                      |
| `APP<TAB>process<TAB>title[<TAB>S]`    | none                                                         | Focused app. Resend about every 1.5 s as a heartbeat; the pad forgets the app after 5 s of silence. Implemented in firmware. A fourth field `S` (firmware 0.5.0) means "use the Studio slot", see "The Studio slot" below.                                                                                                                                                                                                                    |
| `LED<TAB>layer<TAB>key<TAB>#RRGGBB`    | `OK` / `ERR<TAB>reason`                                      | Live colour preview, not saved. `key` is 0-11 (row * 4 + column). Firmware: call `RgbKeys.set_key`.                                                                                                                                                                                                                                                                                                                                           |
| `CFG_BEGIN<TAB>length<TAB>crc32hex`    | `OK` / `ERR<TAB>reason`                                      | Start of a config transfer. `length` = characters of compact JSON, `crc32hex` = 8 lower-case hex digits (zlib CRC-32).                                                                                                                                                                                                                                                                                                                        |
| `CFG_LINE<TAB>chunk`                   | none                                                         | Up to 160 characters of the JSON per line, in order.                                                                                                                                                                                                                                                                                                                                                                                          |
| `CFG_END`                              | `OK` / `ERR<TAB>reason`                                      | Pad checks length and CRC, then checks the structure and builds every profile to make sure it can run it. Only on success it writes `config.json` atomically (temp file, then rename), replies `OK`, and restarts about 0.5 s later to use it. Reasons: `length mismatch`, `crc mismatch`, `no CFG_BEGIN`, or why a profile could not be built (for example `unknown key ...`). A refused push also shows `PUSH REFUSED` on the pad's screen. |
| `GET_CFG`                              | `CFG_BEGIN` / `CFG_LINE`... / `CFG_END`, or `ERR<TAB>reason` | Reads what the pad shows right now (the "live view", not the full config): the sleep time in minutes (`s`, from firmware that has the setting), the key LED effect (`e`, firmware 0.4.0 and later) and per profile the name, knob hint text, 12 key labels and 12 key colours. Same framing as a push.                                                                                                                                        |

`CFG_BEGIN` is refused with `ERR<TAB>drive is visible: ...` when the pad's drive is visible (plugged in with the top-left key held), because the pad cannot write files then. The app waits at most 2 s for a reply, and up to 10 s for the reply to `CFG_END` while the pad writes to flash.

The pad ignores unknown commands. In `APP` the process name is cut to 40 characters and the window title to 120 (it was 60: a site's name sits at the end of a browser's title, and a title word of a pad profile is matched by the pad).

## Version 2: `HELLO` and events from the pad

Until now the pad only answered. Protocol 2 lets it also say what happens on the pad itself. It is opt-in, so an older app or an older pad keeps working exactly as before.

| App sends | Pad replies / sends                                   | Notes                                                                                                                                                                                                                                                                         |
| --------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HELLO`   | `HELLO<TAB>2<TAB>0.3.3`                               | The app sends it after it connects (up to 3 times, 1 s apart, until the pad answers). A pad that answers speaks protocol 2 (first field) and runs the firmware version in the second field (`x.y.z`), and starts sending events. A pad without support ignores it (no reply). |
| (nothing) | `EVT<TAB>layer<TAB>n`                                 | The profile the pad runs is now `n` (0 = General). Sent right after `HELLO` for the current profile, then on every change (app focus, knob, utility layer).                                                                                                                   |
| (nothing) | `EVT<TAB>key<TAB>n<TAB>1` / `EVT<TAB>key<TAB>n<TAB>0` | Key `n` (0-11, row \* 4 + column) went down / up.                                                                                                                                                                                                                             |

Rules both sides follow:

- `EVT` and `HELLO` lines can arrive at any moment, even in the middle of a request. The app handles them before it matches replies, so they are never mistaken for an `OK` or `ERR`.
- The pad sends events only after `HELLO`, never while a config transfer is running, and never to a host that has closed the port. It keeps at most 24 queued events and drops them (never blocks the keys) when the host has left more than 256 bytes unread.
- Events are a courtesy: if sending one fails, the pad stops sending events and keeps switching profiles.
- Lines the app cannot parse, or values out of range (`layer` above 3, `key` above 11), are dropped. (`layer` 3 is the Studio slot.)
- The app asks again with `HELLO` each time it connects, so a pad that stopped sending events starts again. Repeating `HELLO` is harmless: the pad answers again and re-reports its current profile.
- The firmware field is optional: pads from before it existed answer `HELLO<TAB>2`, and the app treats them as older than any numbered firmware. A firmware field that is not three dot-separated numbers is ignored. A pad that never answers `HELLO` runs firmware from before protocol 2.
- The app compares the firmware version with the one it needs (`REQUIRED_FIRMWARE` in `src/shared/firmware.ts`, bumped only when the app starts to rely on a firmware change) and shows a warning when the pad is older. The pad's own number is `FIRMWARE_VERSION` in `Programs/app_profiles.py`; bump it with every firmware change.

The firmware part is `AppProfiles._hello` and `_flush_events` in `Programs/app_profiles.py`. `Programs/tests/test_app_profiles_events.py` runs it on a normal Python with fake modules. It does not replace trying a real pad.

## Music levels (`M`)

For the pad's `equalizer` and `beat` effects, Studio listens to the sound the computer plays (Windows: system audio
loopback) and sends the pad its levels about 25 times a second, only while a pad is connected and one of those effects is
chosen (also while the Studio window is closed to the tray: with a music effect chosen, closing the window only hides it):

| App sends   | Pad replies | Notes                                                                                                                                                     |
| ----------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M`+5 chars | none        | Five characters, each `48 + n` with `n` 0 to 63: the loudness of four bands (bass, low, high, treble), then the strength of a beat just heard (0 = none). |

- It is not tab separated and has no digits as text: the pad reads the five bytes straight off the line (`app_profiles.py`
  `_line`, before anything else is decoded), because this arrives 25 times a second and must not make new strings on a
  board with a few KB of free RAM. Characters run from `0` (n = 0) to `o` (n = 63); none of them can be a tab or a newline.
- The pad smooths the numbers into its 40 frames a second: a bar rises at once and falls away over about half a second, a
  beat flashes and fades in about 0.3 s. If no line arrives for 0.4 s (Studio closed, sound stopped) the lights go out.
- While one of these effects is chosen the key LEDs ignore the screen's dimming and sleep (`sleepMinutes` still
  applies to the screen); they go dark by themselves when the lines stop.
- A pad whose effect is not `equalizer` or `beat` ignores the line, and so does a pad from before firmware 0.4.0 (it
  does not know the command). The pad polls its port every 20 ms instead of 50 ms while one of those effects is chosen.
- Studio sends one line of zeros when the sound stops, then nothing until sound comes back.

## Development tools: `TEST` and knob events (development pads only)

These exist only on a pad flashed with `flash_pad.ps1 -Dev`, which adds `Programs/dev/dev_tools.py`. A customer pad does not have them: it answers `HELLO` without the `dev` field, ignores `TEST` and sends no knob events. The production Studio never sends `TEST`.

| App sends | Pad replies / sends                     | Notes                                                                                                                                                                                                                                                                                         |
| --------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEST`    | none                                    | Key test mode: for 3 s after each `TEST` the pad still reports every key (`EVT key`) but types nothing on the computer, and the knob types nothing either. The app sends it right away and then every second while its key test screen is open.                                               |
| (nothing) | `EVT<TAB>knob<TAB>cw` / `ccw` / `press` | The knob was turned right (clockwise, the action the profile calls "turn right"), turned left, or pressed. One event per click, only after `HELLO`, also while the screen sleeps or test mode stops the typing. A fast spin can drop events when the queue is full, so counts are "at least". |

- `HELLO` from a development pad has a fourth field: `HELLO<TAB>2<TAB>0.3.3<TAB>dev`. The app uses it to know the pad has these tools; a pad without the field is a customer pad.
- `TEST` is only a heartbeat. If the app closes, crashes or the cable is pulled, the pad leaves test mode by itself within 3 s, so the keys cannot stay dead.
- A key pressed in test mode is not typed on release either, and a key pressed before test mode began still gets its normal release, so no key is left held down on the computer.

## Firmware update (`FW_*`)

Studio can update the pad's firmware over the data port. A release carries the firmware as a **bundle**: the compiled files and a `manifest.json` (made by `Programs/build_mpy.py`, put into the app's `resources/firmware`). Studio checks it, sends it, and the pad stages, verifies and installs it. The pad is never left without working firmware: nothing live changes while the firmware runs, the old files are kept until the new firmware has proved itself, and a firmware that does not run is replaced by the old one again.

| App sends                                                    | Pad replies                                                        | Notes                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FW_INFO`                                                    | `FW_INFO<TAB>firmware<TAB>circuitpython<TAB>free bytes<TAB>failed` | The firmware version, the CircuitPython version, free flash, and why the last update was undone (`-` if it was not; reported once). A pad without the updater does not answer.                                                                                     |
| `FW_BEGIN<TAB>version<TAB>files<TAB>bytes<TAB>circuitpython` | `OK` once the knob is pressed, or `ERR<TAB>reason`                 | The pad shows "press knob to allow" and waits 30 s for a press of the knob (the press is not typed). Refused for: another CircuitPython version, a drive that is visible, too little space, a config transfer or another update running, an update still on trial. |
| `FW_FILE<TAB>name<TAB>size<TAB>crc32hex`                     | `OK` / `ERR<TAB>reason`                                            | Starts one file. Only the names below are accepted.                                                                                                                                                                                                                |
| `FW_DATA<TAB>base64`                                         | none                                                               | The file's bytes, up to 48 per line (64 characters of base64), in order. Studio sends **one line and then `PING`**, and waits for `PONG` before the next (see Pacing).                                                                                             |
| `FW_FILE_END`                                                | `OK` / `ERR<TAB>reason`                                            | The pad checks size and CRC-32. Any mismatch drops the whole update.                                                                                                                                                                                               |
| `FW_COMMIT<TAB>version`                                      | `OK`, then the pad restarts                                        | Needs every file declared in `FW_BEGIN`. Writes the commit marker.                                                                                                                                                                                                 |
| `FW_ABORT`                                                   | `OK`                                                               | Throws away what was staged. Nothing live changed.                                                                                                                                                                                                                 |

**Pacing.** While it receives, the pad has only a few KB of free RAM, in small pieces. A pad on firmware 0.4.0 that was sent
96-byte lines back to back read several lines from its port at once (386 bytes), ran out of memory on the second file and
stopped answering ("no reply from pad", the screen stuck on the prompt until the pad was unplugged). So Studio sends a data
line, then `PING`, and waits for `PONG` (the pad answers `PING` after dealing with everything sent before it) before the next
line: the pad never has more than one line waiting. Firmware 0.4.2 also reads at most 160 bytes from its port at a time
while an update runs (`READ_MAX_WHILE_UPDATING` in `app_profiles.py`). A pad whose `PONG` stops coming ends the update with
"no reply from pad", and Studio tells it to drop what it staged.

**What can be sent.** Only `firmware.mpy`, `config_loader.mpy`, `rgb_keys.mpy`, `encoder_modes.mpy`, `app_profiles.mpy`, `oled_ui.mpy`, `fw_update.mpy` and `snekpad32.bmp` (at most 12 files, 40 000 bytes each, 150 000 in all). `code.py`, `boot.py`, `fw_boot.mpy` (the safety net), `kmk/`, `lib/`, `config.json` and CircuitPython itself cannot be updated this way: they need a flash from the computer (`flash_pad.ps1`).

**On the pad:**

1. `FW_BEGIN` .. `FW_FILE_END`: files go to `/fw_new`, each verified. If the app goes quiet for 5 s, or anything is wrong, `/fw_new` is deleted and nothing changes.
2. `FW_COMMIT` writes `/fw_apply` (the version, then the file names) and the pad restarts.
3. At the next start `fw_boot.py` (run by the `code.py` stub before the firmware) moves each live file to `/fw_old` and the staged one in its place, recording what it did first (`/fw_old/names`, `/fw_old/had`). Every step can be repeated, so a power cut at any point is finished at the next start. It then writes `/fw_try`.
4. **Trial.** The new firmware has 3 starts to prove itself (`nvm[2]` counts them). `code.py`'s heartbeat deletes `/fw_try` after the firmware has run for 15 s.
5. If it never does (it crashes, or the pad is reset by the watchdog), the 4th start is a **rollback**: the old files are put back, `/fw_failed` records why, and the old firmware starts. `FW_INFO` reports the reason once.

Studio follows the pad after `FW_COMMIT`: it must reconnect on the new firmware and stay on it for 20 s before the update is called done. A pad that comes back on the old firmware is reported as an update the pad undid, with the reason from `FW_INFO`.

**Not covered.** A new firmware that hangs _before_ the watchdog is armed (the first seconds after start) does not undo itself: unplugging and replugging the pad 3 times does (each start under trial counts).

**Bundle.** `manifest.json`: `{"format": 1, "version": "x.y.z", "circuitpython": "x.y.z", "files": [{"name", "size", "crc32"}]}`. Studio refuses a bundle whose files are missing, the wrong size or damaged, and one built for another CircuitPython version than the pad runs. Pads need firmware `OTA_FIRMWARE` (0.3.4) or newer (`src/shared/firmware.ts`) to take an update; older pads get one flash from the computer first.

## Pad settings in the config JSON

Under `settings`:

| Field          | Meaning                                                                                                                                                                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brightness`   | Starting brightness of the key LEDs, 0.05 to 0.5.                                                                                                                                                                                                                                                                      |
| `sleepMinutes` | Whole minutes of idle time (no key or knob touch) before the pad's screen and key LEDs switch off, 0 to 60, 0 = never. They dim at half that time. Optional: a config without it (an older app) means 2.                                                                                                               |
| `effect`       | The key LED effect: `static` (default; each profile's per-key colours), `equalizer` and `beat` (follow the music, see `M` above), `rainbow`, `ripple` or `starry`. Optional: a config without it (an older app) means `static`. A config that still says `breathing` or `cycle` (taken out again) also means `static`. |

The pad refuses a push whose `sleepMinutes` is not a whole number from 0 to 60, or whose `effect` is not one of the names above, and a pad with older firmware (before 0.4.0 for `effect`) ignores the fields. The effect is part of `config.json`, so the pad keeps it across a power-off. `GET_CFG` reports it as `e` next to the sleep time `s`, so Studio shows the effect the pad really runs.

## Knob settings in the config JSON

Each profile has an `encoder` object. The pad turns it into the knob's three modes (idle, default, press):

| Field        | Meaning                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `label`      | Top-bar hint on the pad's screen, up to 10 characters (for example `KNOB:VOL`).                               |
| `cw`, `ccw`  | Action when the knob is turned right / left.                                                                  |
| `press`      | Action when the knob is pressed. Allowed types: `consumer`, `hotkey` (one key plus modifiers), `key`, `none`. |
| `pressLabel` | Up to 5 characters. Kept in the config but no longer shown on the pad. Missing = empty.                       |

The direction and the clicks-per-step are settings in the firmware's `code.py`, not in the config.

The old `{ "type": "layer_next" }` press action (a press stepped to the next profile) is no longer used. The app converts
it when it loads an old config, and the pad treats it as "nothing" if it still receives one.

Limits: at most 3 profiles on the pad (General first; a config saved by an older app with 4 is still accepted, the pad runs
the first 3), 12 keys per profile, labels up to 5 characters. Studio keeps up to 7 more profiles of its own
(`studioProfiles`, never sent in a push) and puts one of them on the pad's Studio slot when its app is in focus, see below.
The JSON shape is `Config` in `src/shared/config.ts`; the starter config is about 4 KB.

## The Studio slot (`SLOT_*`, firmware 0.5.0 and later)

The pad has room for 3 profiles of its own. Studio keeps up to 7 more and puts the one that fits the app in focus on a
spare layer, the **slot**. The slot is layer `N` (right after the pad's own `N` profiles; the utility layer follows it).
It starts as General (the very same lists, so it costs no RAM) and is lost at every restart: Studio sends it again after
each connect and after each restart of the pad.

| App sends                                              | Pad replies             | Notes                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SLOT_BEGIN<TAB>name<TAB>knob text`                    | `OK` / `ERR<TAB>reason` | Starts a new slot profile and lets go of the old one at once (the pad has no RAM for both). `name` up to 12 characters, `knob text` up to 10.                                                                            |
| `SLOT_KEY<TAB>n<TAB>label<TAB>#RRGGBB<TAB>action JSON` | `OK` / `ERR<TAB>reason` | `n` 0-11: a key (label up to 5 characters, colour, action). `n` 12, 13, 14: the knob turned right, turned left, pressed (label and colour are ignored). The action JSON is the same as in a config and is built at once. |
| `SLOT_END`                                             | `OK` / `ERR<TAB>reason` | All 15 `SLOT_KEY` lines must have arrived (`profile incomplete` otherwise). Only now does the slot change.                                                                                                               |
| `APP<TAB>process<TAB>title<TAB>S`                      | none                    | The same `APP` line as always, with a fourth field `S`: use the slot for this app. Ignored while the slot is empty (the pad then matches by itself). Without `S` nothing changes.                                        |

- A **sequence** is sent as `SLOT_KEY` with the action `{"type":"sequence"}` (no steps) followed by one
  `SLOT_STEP<TAB>n<TAB>KEY+KEY<TAB>pause` line per step (`n` is the key, the keys are joined with `+`, the pause is
  0 to 2000 ms and is only used when another step follows). The pad builds the macro when the next key or `SLOT_END`
  arrives. This is not for looks: parsing a long sequence as one block of JSON needs several KB of RAM for a moment,
  which the pad does not have (measured on a real pad: a 6-step sequence of two-key shortcuts failed on its second
  key), while a step at a time needs next to nothing. A sequence on the knob (`n` 12 to 14) is refused.
- Studio sends one line at a time and waits for each `OK`. The pad reads its port on every scan while a slot arrives, and
  holds back `EVT` lines until it is complete. A transfer that goes quiet for 3 s is dropped.
- Any `ERR` leaves the slot as General (never half a profile), and so does a transfer that was cut off. A stray `SLOT_*`
  line while no transfer is open is refused and does not touch a finished slot.
- Studio decides which profile an app gets: the pad's own 3 profiles come first (the pad matches them itself), then the
  Studio-only profiles in order. It sends the slot only when the profile changed, then the `APP` line with `S`.
- `EVT<TAB>layer<TAB>N` (the slot's number) means a Studio profile is on the pad; which one is Studio's own knowledge.
- The firmware part is `AppProfiles._slot_cmd` and `config_loader.SlotBuilder`;
  `Programs/tests/test_slot.py` checks it on a normal Python.
