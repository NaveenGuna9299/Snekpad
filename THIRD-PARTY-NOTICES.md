# Third-party notices

SnekPad uses the software below. Each part keeps its own license; copies of the full texts are in the linked projects.

## On the pad (CIRCUITPY)

| Component | License | Source |
|---|---|---|
| KMK firmware (`kmk/`) | GPL-3.0 | https://github.com/KMKfw/kmk_firmware |
| CircuitPython | MIT (the core; some parts it bundles have their own licenses) | https://github.com/adafruit/circuitpython |
| `neopixel` | MIT | https://github.com/adafruit/Adafruit_CircuitPython_NeoPixel |
| `adafruit_displayio_ssd1306` | MIT | https://github.com/adafruit/Adafruit_CircuitPython_DisplayIO_SSD1306 |
| `adafruit_display_text` | MIT | https://github.com/adafruit/Adafruit_CircuitPython_Display_Text |

The pad firmware in `Programs/` is distributed under GPL-3.0 (see `Programs/LICENSE`). Because it is built on KMK, anyone
who receives a pad can ask for the firmware source: it is in this repository, and a pad can always be re-flashed (hold the
top-left key while plugging in to show the drive, or use `Programs/flash_pad.ps1`).

## In the desktop app (SnekPad Studio)

The app's direct runtime dependencies are `@electron-toolkit/preload`, `@electron-toolkit/utils`, `serialport`,
`simple-icons` (CC0-1.0) and `zod`. Together with their dependencies they are almost all MIT, ISC, Apache-2.0 or BSD
licensed. A scan of the installed packages (October 2026) found no GPL, LGPL or AGPL licenses. The build tooling
`lightningcss` (MPL-2.0) and `caniuse-lite` (CC-BY-4.0) is only used to build the app. Electron and Chromium are
bundled in the installers under their own licenses (MIT, BSD and others); the installers include their license files.

Re-check this list when you add or update dependencies, and when you ship a new CircuitPython version.
