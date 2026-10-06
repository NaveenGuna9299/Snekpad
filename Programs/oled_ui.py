# oled_ui.py - OLED screens for the macropad, as a KMK module.
# Copy this file to the root of CIRCUITPY (next to code.py).
#
# Two layouts, same behaviour:
#
#   128x64 (GME12864-13 test screen)
#       main     yellow band: focused app (or layer name) + knob mode,
#                3x4 key legend below with a box round each key
#   128x32 (0.91" HS91L02W2C01 on the PCB)  - "compact"
#       main     top line: focused app (or layer name) + knob mode,
#                three lines below: the 3x4 key legend, 4 keys per line
#
#   In both, the key you press is highlighted (inverted) while held and for a
#   moment after. After the board has been idle it shows the owner screen (if set),
#   (compact: also a big date screen) and the logo, then dims and switches off.
#   Any key press or knob turn goes straight back to the main screen.
#
#   Knob (encoder_modes.py): while it is held, the top band becomes a press
#   indicator (what releasing does + a bar and countdown to the profile
#   switcher). The switcher is its own page: one row per profile.
#
# Needs in CIRCUITPY/lib: adafruit_display_text, adafruit_displayio_ssd1306
# (10.x library bundle). Optional logo image: /snekpad.bmp (128x64) or
# /snekpad32.bmp (128x32), 1-bit BMP.
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
        height=64,
        compact=None,        # None = automatic: compact layout on a 128x32 screen
        rotation=0,          # 180 if the screen is mounted upside down
        highlight_s=0.25,    # how long the highlight stays after you let go
        boot_splash_s=2.0,
        idle_s=20,           # seconds idle before the owner/logo screens
        page_s=6,            # seconds per idle screen
        dim_s=120,           # seconds idle before dimming
        off_s=600,           # seconds idle before the screen switches off
        logo_bmp="/snekpad.bmp",
        logo_bmp_compact="/snekpad32.bmp",
        app=None,            # an AppProfiles instance, or None
        enc=None,            # an EncoderModes instance, or None
        n_profiles=None,     # profiles listed in the switcher (default: all layer names)
        notice=None,         # short error text to show after the boot logo (e.g. a config problem)
        notice_s=8,          # seconds it stays up; any key press dismisses it
    ):
        self._notice = notice
        self._notice_title = "CONFIG ERROR"
        self._notice_footer = "using built-in keys"
        self._notice_s = notice_s
        self._notice_until = 0
        self.enc = enc
        self._n_prof = n_profiles if n_profiles is not None else len(layer_names)
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
        self._compact = (height == 32) if compact is None else compact
        self._rotation = rotation
        self._hl_s = highlight_s
        self._splash_s = boot_splash_s
        self._idle_s = idle_s
        self._page_s = page_s
        self._dim_s = dim_s
        self._off_s = off_s
        self._logo_bmp = logo_bmp_compact if self._compact else logo_bmp
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
        self._pages = {}
        self._idle_pages = []

    # ------------------------------------------------------------ setup
    def _fail(self, where, err):
        print("oled_ui error in", where, ":", err)
        self.enabled = False

    def _setup(self):
        if self._w != 128 or self._h not in (32, 64):
            raise ValueError("oled_ui supports 128x64 and 128x32 screens")

        displayio.release_displays()
        i2c = busio.I2C(scl=self._scl, sda=self._sda, frequency=400000)
        bus = i2cdisplaybus.I2CDisplayBus(i2c, device_address=self._addr)
        self.display = adafruit_displayio_ssd1306.SSD1306(
            bus, width=self._w, height=self._h, rotation=self._rotation)

        self._pages["main"] = self._build_main()
        self._pages["owner"] = self._build_owner()
        self._pages["logo"] = self._build_logo()
        self._pages["switch"] = self._build_switch()
        if self._notice:
            self._pages["notice"] = self._build_notice()
        # root = [current page, knob-press overlay]; _show swaps item 0
        self._root = displayio.Group()
        self._root.append(displayio.Group())
        self._root.append(self._build_overlay())
        self.display.root_group = self._root
        # the owner screen (two names + date) is only shown if names were given
        has_owner = bool(self._names[0] or self._names[1])
        if self._compact:
            self._pages["date"] = self._build_date()
            self._idle_pages = ["owner", "date", "logo"] if has_owner else ["logo"]
        else:
            self._idle_pages = ["owner", "logo"] if has_owner else ["logo"]
        gc.collect()

    def _build_main(self):
        g = displayio.Group()
        pal = _white_palette()

        cw = self._w // COLS
        if self._compact:
            band_h = 8                    # one text line
            ch = 8                        # three more text lines for the legend
        else:
            band_h = 16                   # the yellow band
            ch = (self._h - band_h) // ROWS

        # a solid block shared by every highlight
        if self._compact:
            fill = displayio.Bitmap(cw - 2, ch, 2)
        else:
            fill = displayio.Bitmap(cw - 2, ch - 2, 2)
        fill.fill(1)

        if not self._compact:
            # 1-pixel outline round every key (no room for this on 32 rows)
            outline = displayio.Bitmap(cw - 2, ch - 2, 2)
            for x in range(cw - 2):
                outline[x, 0] = 1
                outline[x, ch - 3] = 1
            for y in range(ch - 2):
                outline[0, y] = 1
                outline[cw - 3, y] = 1
            for i in range(KEYS):
                col = i % COLS
                row = i // COLS
                g.append(displayio.TileGrid(
                    outline, pixel_shader=pal,
                    x=col * cw + 1, y=band_h + row * ch + 1))

        self.hl_tiles = []
        for i in range(KEYS):
            col = i % COLS
            row = i // COLS
            tile = displayio.TileGrid(
                fill, pixel_shader=pal,
                x=col * cw + 1, y=band_h + row * ch + (0 if self._compact else 1))
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

    def _build_switch(self):
        # profile switcher: one row per profile, the chosen row is inverted
        g = displayio.Group()
        pal = _white_palette()
        if self._compact:
            top, rh = 0, 8
        else:
            top, rh = 16, 12
            self.sw_title = _text("PROFILE", 3, 8, ax=0.0)
            self.sw_time = _text(" ", self._w - 3, 8, ax=1.0)
            g.append(self.sw_title)
            g.append(self.sw_time)
        fill = displayio.Bitmap(self._w, rh, 2)
        fill.fill(1)
        self.sw_tiles = []
        self.sw_labels = []
        for i in range(self._n_prof):
            tile = displayio.TileGrid(fill, pixel_shader=pal, x=0, y=top + i * rh)
            tile.hidden = True
            g.append(tile)
            self.sw_tiles.append(tile)
            lab = _text(self.layer_names[i], 6, top + i * rh + rh // 2, ax=0.0)
            g.append(lab)
            self.sw_labels.append(lab)
        self._sw_sel = -1
        self._sw_secs = -1
        return g

    def _build_overlay(self):
        # shown over any page while the knob is held: what releasing does,
        # a progress bar and a countdown to the next mode
        g = displayio.Group()
        g.hidden = True
        pal = displayio.Palette(2)
        pal[0] = BLACK
        pal[1] = WHITE
        band_h = 8 if self._compact else 16
        g.append(displayio.TileGrid(displayio.Bitmap(self._w, band_h, 2), pixel_shader=pal))
        if self._compact:
            bx, by, bw, bh = 62, 1, 64, 6
        else:
            bx, by, bw, bh = 3, 9, 122, 5
        bar = displayio.Bitmap(bw, bh, 2)
        for x in range(bw):
            bar[x, 0] = 1
            bar[x, bh - 1] = 1
        for y in range(bh):
            bar[0, y] = 1
            bar[bw - 1, y] = 1
        g.append(displayio.TileGrid(bar, pixel_shader=pal, x=bx, y=by))
        self._bar = bar
        self._bar_inner = bw - 2
        self._bar_h = bh
        self._bar_cols = 0
        self.ov_left = _text(" ", 3, 4, ax=0.0)
        self.ov_right = _text(" ", self._w - 3, 4, ax=1.0)
        g.append(self.ov_left)
        if not self._compact:
            g.append(self.ov_right)
        self._ovl = g
        return g

    def _set_bar(self, frac):
        cols = int(frac * self._bar_inner + 0.5)
        cols = max(0, min(self._bar_inner, cols))
        old = self._bar_cols
        if cols == old:
            return
        v = 1 if cols > old else 0
        for x in range(min(cols, old), max(cols, old)):
            for y in range(1, self._bar_h - 1):
                self._bar[x + 1, y] = v
        self._bar_cols = cols

    def _update_overlay(self):
        enc = self.enc
        if enc is not None and enc.held:
            if self._ovl.hidden:
                self._ovl.hidden = False
            self._set_bar(enc.progress)
            if self.ov_left.text != enc.left_text:
                self.ov_left.text = enc.left_text or " "
            if not self._compact and self.ov_right.text != enc.right_text:
                self.ov_right.text = enc.right_text or " "
        elif not self._ovl.hidden:
            self._ovl.hidden = True
            self._set_bar(0)

    def _update_switch(self):
        enc = self.enc
        if enc.sel != self._sw_sel:
            self._sw_sel = enc.sel
            for i in range(self._n_prof):
                on = i == enc.sel
                self.sw_tiles[i].hidden = not on
                self.sw_labels[i].color = BLACK if on else WHITE
        if not self._compact and enc.switch_left != self._sw_secs:
            self._sw_secs = enc.switch_left
            self.sw_time.text = "%ds" % enc.switch_left

    def _build_owner(self):
        g = displayio.Group()
        cx = self._w // 2
        if self._compact:
            # line 1: first name. line 2: heart + second name (both text size 2)
            g.append(_text(self._names[0], cx, 8, scale=2))
            w2 = len(self._names[1]) * 12
            start = max(0, (self._w - (9 + 5 + w2)) // 2)
            g.append(_heart(start, 20))
            g.append(_text(self._names[1], start + 14, 24, scale=2, ax=0.0))
        else:
            g.append(_text(self._names[0], cx, 8, scale=2))
            g.append(_heart(cx - 4, 21))
            g.append(_text(self._names[1], cx, 40, scale=2))
            g.append(_text(self._date, cx, 57))
        return g

    def _build_notice(self):
        """Error screen: a title, what went wrong, and a footer saying what the pad is doing about it."""
        text = "".join(c if " " <= c <= "~" else "?" for c in self._notice)
        width = 21      # characters per line (6 px each on 128 px)
        if self._compact:
            lines = [self._notice_title, text[:width], self._notice_footer]
        else:
            lines = [self._notice_title, ""]
            lines += [text[i:i + width] for i in range(0, min(len(text), 3 * width), width)]
            lines += ["", self._notice_footer, "(press a key)"]
        g = displayio.Group()
        for i, s in enumerate(lines):
            if s:
                g.append(_text(s, 2, i * 8 + 4, ax=0.0))
        return g

    def show_notice(self, text, title="CONFIG ERROR", footer="config not changed"):
        """Pop up an error while the pad is running (e.g. a push that was refused). A key press dismisses it."""
        if not self.enabled:
            return
        try:
            self._notice = text
            self._notice_title = title
            self._notice_footer = footer
            self._pages["notice"] = self._build_notice()
            self.page = None        # the page object was replaced, so force the swap
            self._show("notice")
            now = time.monotonic()
            self.last_activity = now
            self._notice_until = now + self._notice_s
            self._set_level(1.0)
        except Exception as e:
            self._fail("show_notice", e)

    def _build_date(self):
        # compact only: the date in big letters
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
            if self._compact:
                g.append(_text("SNEKPAD", self._w // 2, 16, scale=3))
            else:
                g.append(_text("SNEKPAD", self._w // 2, 30, scale=3))
                g.append(_text("macropad", self._w // 2, 54))
        return g

    # ------------------------------------------------------------ drawing
    def _show(self, page):
        if page == self.page:
            return
        self._root[0] = self._pages[page]
        self.page = page

    def _top_text(self, layer):
        app = self.app
        if app is not None and app.connected and app.app_label:
            # '*' = layer was chosen by hand (knob press), not by the focused app
            return app.app_label + ("*" if app.manual else "")
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

    def _set_level(self, level):
        if level != self._level:
            self.display.brightness = level
            self._level = level

    def _switching(self):
        return self.enc is not None and self.enc.mode == "switch"

    def _wake(self, now):
        self.last_activity = now
        self._set_level(1.0)
        self._show("switch" if self._switching() else "main")

    # used by EncoderModes: knob events count as activity, and the first one
    # after the idle screens only wakes the display
    def wake(self):
        if self.enabled:
            try:
                self._wake(time.monotonic())
            except Exception as e:
                self._fail("wake", e)

    @property
    def asleep(self):
        return self.enabled and time.monotonic() - self.last_activity >= self._idle_s

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
            print("oled_ui ready (%s layout)" % ("compact" if self._compact else "full"))
        except Exception as e:
            self._fail("setup", e)

    def process_key(self, keyboard, key, is_pressed, int_coord):
        if not self.enabled:
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
        if not self.enabled:
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

            if self._switching():
                self.last_activity = now
                self._show("switch")
                self._update_switch()
            elif self.page == "switch":
                self._show("main")
            elif idle >= self._idle_s:
                n = int((idle - self._idle_s) // self._page_s)
                self._show(self._idle_pages[n % len(self._idle_pages)])
            self._update_overlay()
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
