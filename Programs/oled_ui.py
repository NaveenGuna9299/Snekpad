# SPDX-License-Identifier: GPL-3.0-only
# oled_ui.py - OLED screens for the macropad, as a KMK module.
# Copy this file to the root of CIRCUITPY (next to code.py).
#
# Layout for the 128x32 screen (0.91" HS91L02W2C01 on the PCB):
#   main     top line: focused app (or layer name) + knob mode,
#            three lines below: the 3x4 key legend, 4 keys per line
#
#   The key you press is highlighted (inverted) while held and for a moment
#   after. After the board has been idle it shows the owner screen (if set),
#   a big date screen and the logo, then dims and switches off.
#   Any key press or knob turn goes straight back to the main screen.
#
# Needs in CIRCUITPY/lib: adafruit_display_text, adafruit_displayio_ssd1306
# (10.x library bundle). Optional logo image: /snekpad32.bmp
# (128x32, 1-bit BMP).
#
# If anything in here fails, the error is printed and the screens switch off;
# the keyboard itself keeps working.

import gc
import time

import busio
import displayio
import terminalio
import i2cdisplaybus
import adafruit_displayio_ssd1306
from adafruit_display_text import label

from kmk.modules import Module

WHITE = 0xFFFFFF
BLACK = 0x000000

COLS = 4
ROWS = 3
KEYS = COLS * ROWS

HEART = (
    ".##...##.",
    "####.####",
    "#########",
    "#########",
    ".#######.",
    "..#####..",
    "...###...",
    "....#....",
)


def _white_palette():
    pal = displayio.Palette(2)
    pal[0] = BLACK
    pal[1] = WHITE
    pal.make_transparent(0)
    return pal


def _heart(x, y):
    bm = displayio.Bitmap(9, 8, 2)
    for yy, rowbits in enumerate(HEART):
        for xx, c in enumerate(rowbits):
            if c == "#":
                bm[xx, yy] = 1
    return displayio.TileGrid(bm, pixel_shader=_white_palette(), x=x, y=y)


def _text(s, x, y, scale=1, ax=0.5, ay=0.5):
    return label.Label(
        terminalio.FONT, text=s or " ", color=WHITE, scale=scale,
        anchor_point=(ax, ay), anchored_position=(x, y),
    )


class OledUI(Module):
    def __init__(
        self,
        labels,
        layer_names,
        knob_text,
        sda,
        scl,
        names=("Name1", "Name2"),
        date="",
        address=0x3C,
        width=128,
        height=32,
        rotation=0,          # 180 if the screen is mounted upside down
        highlight_s=0.25,    # how long the highlight stays after you let go
        boot_splash_s=2.0,
        idle_s=20,           # seconds idle before the owner/logo screens
        page_s=6,            # seconds per idle screen
        dim_s=120,           # seconds idle before dimming
        off_s=600,           # seconds idle before the screen switches off
        logo_bmp="/snekpad32.bmp",
        app=None,            # an AppProfiles instance, or None
        notice=None,         # short error text to show after the boot logo (e.g. a config problem)
        notice_s=8,          # seconds it stays up; any key press dismisses it
    ):
        self._notice = notice
        self._notice_title = "CONFIG ERROR"
        self._notice_footer = "using built-in keys"
        self._notice_s = notice_s
        self._notice_until = 0
        self.labels = labels
        self.layer_names = layer_names
        self.knob_text = knob_text
        self._sda = sda
        self._scl = scl
        self._names = names
        self._date = date
        self._addr = address
        self._w = width
        self._h = height
        self._rotation = rotation
        self._hl_s = highlight_s
        self._splash_s = boot_splash_s
        self._idle_s = idle_s
        self._page_s = page_s
        self._dim_s = dim_s
        self._off_s = off_s
        self._logo_bmp = logo_bmp
        self.app = app
        self._top = None

        self.enabled = False
        self.display = None
        self.page = None
        self.layer = -1
        self.hl_idx = None
        self.hl_until = None   # None while the key is held
        self.last_activity = time.monotonic()
        self._last_tick = 0
        self._level = 1.0
        self._bus = None            # the display bus, for switching the panel off (see _panel)
        self._panel_on = True
        self._pages = {}
        self._idle_pages = []
        self._suspended = False

    # ------------------------------------------------------------ setup
    def _fail(self, where, err):
        print("oled_ui error in", where, ":", err)
        self.enabled = False

    def _setup(self):
        if self._w != 128 or self._h != 32:
            raise ValueError("oled_ui supports 128x32 screens")

        displayio.release_displays()
        i2c = busio.I2C(scl=self._scl, sda=self._sda, frequency=400000)
        bus = i2cdisplaybus.I2CDisplayBus(i2c, device_address=self._addr)
        self._bus = bus
        self._panel_on = True
        self.display = adafruit_displayio_ssd1306.SSD1306(
            bus, width=self._w, height=self._h, rotation=self._rotation)

        # Only the main page lives permanently. Every other page is built when it is first shown and
        # dropped again when the display goes back to main (_show), because the RP2040 has too little
        # RAM to keep all of them next to KMK.
        self._pages["main"] = self._build_main()
        # root = [current page]; _show swaps item 0
        self._root = displayio.Group()
        self._root.append(displayio.Group())
        self.display.root_group = self._root
        # the owner screen (two names + date) is only shown if names were given
        has_owner = bool(self._names[0] or self._names[1])
        self._idle_pages = ["owner", "date", "logo"] if has_owner else ["logo"]
        gc.collect()

    def _build_page(self, page):
        if page == "owner":
            return self._build_owner()
        if page == "logo":
            return self._build_logo()
        if page == "notice":
            return self._build_notice()
        return self._build_date()

    def _drop_page(self, page):
        self._pages.pop(page, None)
        gc.collect()

    def suspend(self):
        """Free the main page's RAM (about 16 KB) while a config is being received; the pad
        has too little left to receive and test-build one with the screen fully loaded."""
        if not self.enabled or self._suspended:
            return
        try:
            self._suspended = True
            self.hl_tiles = self.cell_labels = self.lbl_layer = self.lbl_knob = None
            self._pages = {}
            self.page = None
            self.hl_idx = None
            self.hl_until = None
            self._root[0] = displayio.Group()
            gc.collect()
            g = displayio.Group()
            g.append(_text("RECEIVING...", self._w // 2, self._h // 2))
            self._root[0] = g
            self._set_level(1.0)
        except Exception as e:
            self._fail("suspend", e)

    @property
    def suspended(self):
        return self._suspended

    def show_refused(self, text, title="PUSH REFUSED", footer="pad keeps old config"):
        """While suspended: replace the RECEIVING screen by the reason a push was refused. The main
        page is not rebuilt (a fragmented heap often can't fit it); the caller restarts the pad."""
        if not self._suspended:
            return
        try:
            self._notice = text
            self._notice_title = title
            self._notice_footer = footer
            self._root[0] = self._build_notice()
        except Exception as e:
            self._fail("show_refused", e)

    def _build_main(self):
        g = displayio.Group()
        pal = _white_palette()

        cw = self._w // COLS
        band_h = 8                        # one text line
        ch = 8                            # three more text lines for the legend

        # a solid block shared by every highlight
        fill = displayio.Bitmap(cw - 2, ch, 2)
        fill.fill(1)

        self.hl_tiles = []
        for i in range(KEYS):
            col = i % COLS
            row = i // COLS
            tile = displayio.TileGrid(
                fill, pixel_shader=pal,
                x=col * cw + 1, y=band_h + row * ch)
            tile.hidden = True
            g.append(tile)
            self.hl_tiles.append(tile)

        self.cell_labels = []
        for i in range(KEYS):
            col = i % COLS
            row = i // COLS
            lab = _text(" ", col * cw + cw // 2, band_h + row * ch + ch // 2)
            g.append(lab)
            self.cell_labels.append(lab)

        self.lbl_layer = _text(" ", 3, band_h // 2, ax=0.0)
        self.lbl_knob = _text(" ", self._w - 3, band_h // 2, ax=1.0)
        g.append(self.lbl_layer)
        g.append(self.lbl_knob)
        return g

    def _build_owner(self):
        g = displayio.Group()
        cx = self._w // 2
        # line 1: first name. line 2: heart + second name (both text size 2)
        g.append(_text(self._names[0], cx, 8, scale=2))
        w2 = len(self._names[1]) * 12
        start = max(0, (self._w - (9 + 5 + w2)) // 2)
        g.append(_heart(start, 20))
        g.append(_text(self._names[1], start + 14, 24, scale=2, ax=0.0))
        return g

    def _build_notice(self):
        """Error screen: a title, what went wrong, and a footer saying what the pad is doing about it."""
        text = "".join(c if " " <= c <= "~" else "?" for c in self._notice)
        width = 21      # characters per line (6 px each on 128 px)
        lines = [self._notice_title, text[:width], self._notice_footer]
        g = displayio.Group()
        for i, s in enumerate(lines):
            if s:
                g.append(_text(s, 2, i * 8 + 4, ax=0.0))
        return g

    def clear_notice(self):
        """Take a pop-up away again (the firmware update prompt, when it is answered or gives up)."""
        if self.enabled and self.page == "notice":
            try:
                self._show("main")
            except Exception as e:
                self._fail("clear_notice", e)

    def show_notice(self, text, title="CONFIG ERROR", footer="config not changed", seconds=None):
        """Pop up a message while the pad is running (e.g. a push that was refused). A key press dismisses it.
        It stays for notice_s seconds unless seconds says otherwise."""
        if not self.enabled:
            return
        try:
            self._notice = text
            self._notice_title = title
            self._notice_footer = footer
            if self.page == "notice":   # rebuild it with the new text
                self.page = None
                self._drop_page("notice")
            self._show("notice")
            now = time.monotonic()
            self.last_activity = now
            self._notice_until = now + (self._notice_s if seconds is None else seconds)
            self._set_level(1.0)
        except Exception as e:
            self._fail("show_notice", e)

    def _build_date(self):
        # the date in big letters
        g = displayio.Group()
        g.append(_text(self._date, self._w // 2, 16, scale=2))
        return g

    def _build_logo(self):
        g = displayio.Group()
        done = False
        try:
            import os
            os.stat(self._logo_bmp)
            bmp = displayio.OnDiskBitmap(self._logo_bmp)
            g.append(displayio.TileGrid(bmp, pixel_shader=bmp.pixel_shader))
            done = True
        except Exception:
            pass
        if not done:
            # text logo until the BMP is on the board
            g.append(_text("SNEKPAD", self._w // 2, 16, scale=3))
        return g

    # ------------------------------------------------------------ drawing
    def _show(self, page):
        if page == self.page:
            return
        old = self.page
        if page not in self._pages:
            gc.collect()    # build into a compacted heap
            self._pages[page] = self._build_page(page)
        self._root[0] = self._pages[page]
        self.page = page
        if old is not None and old != "main" and old in self._pages:
            self._drop_page(old)

    def _top_text(self, layer):
        app = self.app
        if app is not None and app.connected and app.app_label:
            # '*' = layer was chosen by hand (a layer key), not by the focused app: show that profile
            if app.manual:
                return self.layer_names[layer][:9] + "*"
            return app.app_label
        return self.layer_names[layer]

    def _refresh_top(self):
        t = self._top_text(self.layer)
        if t != self._top:
            self.lbl_layer.text = t
            self._top = t

    def _apply_layer(self, layer):
        if layer < 0 or layer >= len(self.labels):
            layer = 0
        self.layer = layer
        self._refresh_top()
        self.lbl_knob.text = self.knob_text[layer]
        row = self.labels[layer]
        for i in range(KEYS):
            s = row[i] if i < len(row) and row[i] else " "
            if self.cell_labels[i].text != s:
                self.cell_labels[i].text = s

    def _set_cell(self, i, on):
        self.hl_tiles[i].hidden = not on
        self.cell_labels[i].color = BLACK if on else WHITE

    def _panel(self, on):
        # Switch the panel itself off / on (SSD1306 commands 0xAE / 0xAF). Brightness 0.0 is only the lowest
        # contrast, and the logo stays faintly visible; this really turns the screen off.
        if on == self._panel_on:
            return
        try:
            self._bus.send(0xAF if on else 0xAE, b"")
            self._panel_on = on
        except Exception as e:
            print("oled_ui panel", "on" if on else "off", "error:", e)   # the screen just stays at its lowest contrast

    def _set_level(self, level):
        if level != self._level:
            if level > 0:
                self._panel(True)
            self.display.brightness = level
            if level == 0:
                self._panel(False)
            self._level = level

    def _wake(self, now):
        self.last_activity = now
        self._set_level(1.0)
        self._show("main")

    # used by EncoderModes: knob events count as activity, and the first one
    # after the idle screens only wakes the display
    def wake(self):
        if self.enabled and not self._suspended:
            try:
                self._wake(time.monotonic())
            except Exception as e:
                self._fail("wake", e)

    @property
    def asleep(self):
        return self.enabled and time.monotonic() - self.last_activity >= self._idle_s

    def idle_level(self):
        # 0 = in use, 1 = dimmed, 2 = switched off: the same steps the screen itself takes (dim_s, off_s),
        # so the key LEDs (rgb_keys.py) can follow it instead of staying lit after the screen has gone dark
        if not self.enabled:
            return 0
        idle = time.monotonic() - self.last_activity
        if idle >= self._off_s:
            return 2
        if idle >= self._dim_s:
            return 1
        return 0

    # ------------------------------------------------------------ KMK hooks
    def during_bootup(self, keyboard):
        try:
            self._setup()
            self._show("logo")
            time.sleep(self._splash_s)
            self._apply_layer(0)
            self._show("main")
            self.last_activity = time.monotonic()
            if self._notice:
                self._show("notice")
                self._notice_until = self.last_activity + self._notice_s
            self.enabled = True
            print("oled_ui ready (128x32)")
        except Exception as e:
            self._fail("setup", e)

    def process_key(self, keyboard, key, is_pressed, int_coord):
        if not self.enabled or self._suspended:
            return key
        try:
            now = time.monotonic()
            self._wake(now)
            if int_coord is not None and 0 <= int_coord < KEYS:
                if self.hl_idx is not None and self.hl_idx != int_coord:
                    self._set_cell(self.hl_idx, False)
                self.hl_idx = int_coord
                self._set_cell(int_coord, True)
                self.hl_until = None if is_pressed else now + self._hl_s
        except Exception as e:
            self._fail("process_key", e)
        return key

    def before_matrix_scan(self, keyboard):
        if not self.enabled or self._suspended:
            return None
        now = time.monotonic()
        if now - self._last_tick < 0.05:
            return None
        self._last_tick = now
        try:
            layer = keyboard.active_layers[0]
            if layer != self.layer:
                self._apply_layer(layer)
            else:
                self._refresh_top()

            if self.hl_idx is not None and self.hl_until is not None and now >= self.hl_until:
                self._set_cell(self.hl_idx, False)
                self.hl_idx = None
                self.hl_until = None

            if self.page == "notice" and now >= self._notice_until:
                self._show("main")

            idle = now - self.last_activity
            if idle >= self._off_s:
                self._set_level(0.0)
            elif idle >= self._dim_s:
                self._set_level(0.25)

            if idle >= self._idle_s:
                n = int((idle - self._idle_s) // self._page_s)
                self._show(self._idle_pages[n % len(self._idle_pages)])
        except Exception as e:
            self._fail("before_matrix_scan", e)
        return None

    def after_matrix_scan(self, keyboard):
        return None

    def before_hid_send(self, keyboard):
        return None

    def after_hid_send(self, keyboard):
        return None

    def on_powersave_enable(self, keyboard):
        return None

    def on_powersave_disable(self, keyboard):
        return None
