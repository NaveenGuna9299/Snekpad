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
