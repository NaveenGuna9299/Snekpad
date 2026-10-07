# SnekPad serial protocol

Transport: the pad's second USB serial port (`usb_cdc.data`, enabled in `boot.py`), 115200 baud.
One message per line, `\n` terminated, fields separated by TAB. ASCII only.

| App sends                              | Pad replies                                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PING`                                 | `PONG`                                                       | Used to find the data port (the console port never answers). Implemented in firmware.                                                                                                                                                                                                                                                                                                                                                         |
| `OS<TAB>windows` (or `macos`, `linux`) | none                                                         | Sent once right after the app connects. The pad stores it in `AppProfiles.host_os`. The app already swaps CTRL for GUI in "use Cmd on macOS" shortcuts before pushing a config on a Mac.                                                                                                                                                                                                                                                      |
| `APP<TAB>process<TAB>title`            | none                                                         | Focused app. Resend about every 1.5 s as a heartbeat; the pad forgets the app after 5 s of silence. Implemented in firmware.                                                                                                                                                                                                                                                                                                                  |
| `LED<TAB>layer<TAB>key<TAB>#RRGGBB`    | `OK` / `ERR<TAB>reason`                                      | Live colour preview, not saved. `key` is 0-11 (row * 4 + column). Firmware: call `RgbKeys.set_key`.                                                                                                                                                                                                                                                                                                                                           |
| `CFG_BEGIN<TAB>length<TAB>crc32hex`    | `OK` / `ERR<TAB>reason`                                      | Start of a config transfer. `length` = characters of compact JSON, `crc32hex` = 8 lower-case hex digits (zlib CRC-32).                                                                                                                                                                                                                                                                                                                        |
| `CFG_LINE<TAB>chunk`                   | none                                                         | Up to 160 characters of the JSON per line, in order.                                                                                                                                                                                                                                                                                                                                                                                          |
| `CFG_END`                              | `OK` / `ERR<TAB>reason`                                      | Pad checks length and CRC, then checks the structure and builds every profile to make sure it can run it. Only on success it writes `config.json` atomically (temp file, then rename), replies `OK`, and restarts about 0.5 s later to use it. Reasons: `length mismatch`, `crc mismatch`, `no CFG_BEGIN`, or why a profile could not be built (for example `unknown key ...`). A refused push also shows `PUSH REFUSED` on the pad's screen. |
| `GET_CFG`                              | `CFG_BEGIN` / `CFG_LINE`... / `CFG_END`, or `ERR<TAB>reason` | Reads what the pad shows right now (the "live view", not the full config): per profile the name, knob hint text, 12 key labels and 12 key colours. Same framing as a push.                                                                                                                                                                                                                                                                    |

`CFG_BEGIN` is refused with `ERR<TAB>drive is visible: ...` when the pad's drive is visible (plugged in with the top-left key held), because the pad cannot write files then. The app waits at most 2 s for a reply, and up to 10 s for the reply to `CFG_END` while the pad writes to flash.

The pad ignores unknown commands.

## Version 2: `HELLO` and events from the pad

Until now the pad only answered. Protocol 2 lets it also say what happens on the pad itself. It is opt-in, so an older app or an older pad keeps working exactly as before.

| App sends | Pad replies / sends                                   | Notes                                                                                                                                                       |
| --------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HELLO`   | `HELLO<TAB>2`                                         | The app sends it once after it connects. A pad that answers speaks protocol 2 and starts sending events. A pad without support ignores it (no reply).       |
| (nothing) | `EVT<TAB>layer<TAB>n`                                 | The profile the pad runs is now `n` (0 = General). Sent right after `HELLO` for the current profile, then on every change (app focus, knob, utility layer). |
| (nothing) | `EVT<TAB>key<TAB>n<TAB>1` / `EVT<TAB>key<TAB>n<TAB>0` | Key `n` (0-11, row \* 4 + column) went down / up.                                                                                                           |

Rules both sides follow:

- `EVT` and `HELLO` lines can arrive at any moment, even in the middle of a request. The app handles them before it matches replies, so they are never mistaken for an `OK` or `ERR`.
- The pad sends events only after `HELLO`, never while a config transfer is running, and never to a host that has closed the port. It keeps at most 24 queued events and drops them (never blocks the keys) when the host has left more than 256 bytes unread.
- Events are a courtesy: if sending one fails, the pad stops sending events and keeps switching profiles.
- Lines the app cannot parse, or values out of range (`layer` above 3, `key` above 11), are dropped.
- The app asks again with `HELLO` each time it connects, so a pad that stopped sending events starts again.

The firmware part is `AppProfiles._hello` and `_flush_events` in `Programs/app_profiles.py`. `Programs/tests/test_app_profiles_events.py` runs it on a normal Python with fake modules. It does not replace trying a real pad.

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

Limits: at most 4 profiles (General first), 12 keys per profile, labels up to 5 characters.
The JSON shape is `Config` in `src/shared/config.ts`; the starter config is about 5.3 KB.
