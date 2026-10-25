// The HUD: a small see-through panel over the other apps that shows the keys of the profile the pad is on, and lights
// up each key while it is held. It never takes focus, so the app underneath keeps working, and clicks go through it
// except while the mouse is over the panel (then its three-dots menu and its drag bar work). The window is only made
// when there is something to show and is destroyed again after a while hidden, so a Studio sitting in the tray
// costs no extra web-page memory.
import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type Rectangle } from 'electron'
import { join } from 'path'
import { FN_KEY, type Profile } from '../shared/config'
import { describeAction } from '../renderer/src/lib/describe'
import { clampOpacity, hudPatchSchema, type HudPref, type HudSize } from '../shared/hud'
import { hudPage } from './hudPage'

const SIZES: Record<HudSize, { w: number; h: number }> = {
  comfy: { w: 340, h: 232 },
  compact: { w: 236, h: 150 },
  slim: { w: 780, h: 44 }
}
const MENU = { w: 300, h: 300 } // the window while the three-dots menu is open
const MARGIN = 16 // from the edges of the work area (the taskbar is outside it)
const FLASH_MS = 2600
const FADE_MS = 250 // keep in step with the transition in the page
const IDLE_DESTROY_MS = 60000
const MOUSE_POLL_MS = 40 // how often the mouse is checked against the panel (see watchMouse)
const SAVE_DELAY_MS = 250 // a slider sends a change per step: save once it settles

type HudKey = { label: string; text: string; color: string; none: boolean }
export type HudData = { name: string; knob: string; keys: HudKey[] }

/** What the HUD shows of a profile: each key's label (or a short description when it has none) and its colour. */
export function hudData(p: Profile): HudData {
  return {
    name: p.name,
    knob: p.encoder.label,
    keys: p.keys.map((k, i) => {
      const none = k.action.type === 'none'
      const text = i === FN_KEY ? 'Utility layer' : none ? '' : describeAction(k.action)
      return {
        label: k.label || (i === FN_KEY ? 'FN' : none ? '·' : text),
        text: k.label ? text : '',
        color: k.color,
        none
      }
    })
  }
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(v, hi))
const inside = (r: Rectangle, p: { x: number; y: number }): boolean =>
  p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height

export class Hud {
  private win: BrowserWindow | null = null
  private ready: Promise<void> | null = null
  private data: HudData | null = null
  private shown = false
  private menu = false // the three-dots menu is open (the window is bigger then)
  private hover = false // the mouse is over the panel
  private dragBase: Rectangle | null = null // where the window was when a drag began
  private flashTimer: NodeJS.Timeout | null = null
  private fadeTimer: NodeJS.Timeout | null = null
  private destroyTimer: NodeJS.Timeout | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private mouseTimer: NodeJS.Timeout | null = null

  /**
   * `onChange` is told the settings once they settle (the caller saves them); `onLive` at once, on every change (the
   * caller tells Studio's open window, so its settings never show an old value).
   */
  constructor(
    private pref: HudPref,
    private readonly onChange: (pref: HudPref) => void,
    private readonly onLive: (pref: HudPref) => void = () => {}
  ) {}

  getPref(): HudPref {
    return this.pref
  }

  /** Listen to the HUD window (its menu and its drag bar). Only that window is believed. */
  listen(): void {
    const mine = (e: IpcMainEvent): boolean =>
      !!this.win && !this.win.isDestroyed() && e.sender === this.win.webContents
    ipcMain.on('hud:menu', (e, open: unknown) => mine(e) && this.setMenu(open === true))
    ipcMain.on('hud:patch', (e, patch: unknown) => {
      const v = hudPatchSchema.safeParse(patch)
      if (mine(e) && v.success) this.setPref(v.data)
    })
    ipcMain.on('hud:drag', (e, what: unknown) => {
      if (!mine(e)) return
      if (what === 'start') this.dragStart()
      else if (what === 'end') this.dragEnd()
    })
    ipcMain.on('hud:dragmove', (e, dx: unknown, dy: unknown) => {
      if (mine(e) && typeof dx === 'number' && typeof dy === 'number') this.dragMove(dx, dy)
    })
  }

  /** Change some of the settings (from Studio's settings, the tray or the HUD's own menu). */
  setPref(patch: Partial<HudPref>): void {
    const before = this.pref
    this.pref = { ...before, ...patch, opacity: clampOpacity(patch.opacity ?? before.opacity) }
    this.queueChange()
    this.onLive(this.pref)
    if (this.pref.mode === 'off') return this.hide()
    if (this.pref.mode === 'pinned') return this.show()
    if (this.shown) {
      this.refresh()
      this.armHide() // was pinned, or something changed while it is up: it goes after a moment
    } else this.flash() // show how the change looks
  }

  /** The profile the pad is on now (null = unknown, e.g. no pad). `announce`: it just changed, so flash it. */
  setProfile(profile: Profile | null, announce: boolean): void {
    this.data = profile ? hudData(profile) : null
    if (!this.data) return this.hide()
    if (this.pref.mode === 'pinned') this.show()
    else if (this.pref.mode === 'flash' && announce) this.flash()
    else if (this.shown) void this.render() // the same profile was edited: show the new keys
  }

  /** A key on the pad went down or up: light it up on the HUD while it is held. */
  press(index: number, down: boolean): void {
    if (!this.shown || !this.win || this.win.isDestroyed()) return
    void this.win.webContents.executeJavaScript(`press(${index | 0},${down})`).catch(() => {})
  }

  /** True for the HUD's own window (so code looking for Studio's main window can skip it). */
  owns(w: BrowserWindow): boolean {
    return w === this.win
  }

  flash(): void {
    if (this.pref.mode === 'off' || !this.data) return
    this.show()
  }

  destroy(): void {
    this.clearTimers()
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      this.onChange(this.pref)
    }
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
    this.ready = null
    this.shown = false
  }

  private show(): void {
    if (!this.data) return
    this.clearTimers()
    const win = this.window()
    win.setBounds(this.bounds())
    this.shown = true
    this.watchMouse()
    void this.render().then(() => {
      if (win.isDestroyed() || !this.shown) return
      win.showInactive() // never steal focus from the app underneath
      win.setAlwaysOnTop(true, 'screen-saver') // re-assert: another topmost window may have come up since
      void win.webContents.executeJavaScript('visible(true)').catch(() => {})
    })
    this.armHide()
  }

  private hide(): void {
    this.clearTimers()
    this.shown = false
    this.menu = false
    this.hover = false
    this.dragBase = null
    const win = this.win
    if (!win || win.isDestroyed()) return
    win.setIgnoreMouseEvents(true, { forward: true })
    void win.webContents.executeJavaScript('visible(false)').catch(() => {})
    this.fadeTimer = setTimeout(() => {
      this.fadeTimer = null
      if (!win.isDestroyed()) win.hide()
    }, FADE_MS)
    this.destroyTimer = setTimeout(() => this.destroy(), IDLE_DESTROY_MS)
  }

  /** In "on switch" mode the HUD goes after a moment, but not while the mouse is on it, the menu is open or it is being moved. */
  private armHide(): void {
    if (this.flashTimer) clearTimeout(this.flashTimer)
    this.flashTimer = null
    if (this.pref.mode !== 'flash' || !this.shown) return
    if (this.hover || this.menu || this.dragBase) return
    this.flashTimer = setTimeout(() => this.hide(), FLASH_MS)
  }

  /**
   * While the HUD is up, check where the mouse is: over the panel the window takes clicks (the three dots, the menu, the
   * drag bar), anywhere else they go through to the app underneath. The main process works this out itself, because a
   * report from the page can be missed (the HUD can appear under a mouse that is not moving, and a click right after
   * moving in can come before the report), and the click would then land on the app below.
   */
  private watchMouse(): void {
    if (this.mouseTimer) return
    this.mouseTimer = setInterval(() => {
      const win = this.win
      if (!win || win.isDestroyed() || !this.shown) return
      // a drag keeps the panel under the mouse even while the window lags behind it
      const on = this.dragBase !== null || inside(win.getBounds(), screen.getCursorScreenPoint())
      if (on === this.hover) return
      this.hover = on
      if (on) win.setIgnoreMouseEvents(false)
      else win.setIgnoreMouseEvents(true, { forward: true })
      this.armHide()
    }, MOUSE_POLL_MS)
  }

  private setMenu(open: boolean): void {
    if (this.menu === open || !this.shown) return
    this.menu = open
    this.refresh()
    this.armHide()
  }

  private dragStart(): void {
    if (!this.shown || this.menu || !this.win || this.win.isDestroyed()) return
    this.dragBase = this.win.getBounds()
    this.armHide()
  }

  private dragMove(dx: number, dy: number): void {
    const base = this.dragBase
    if (!base || !this.win || this.win.isDestroyed() || !Number.isFinite(dx + dy)) return
    // always the full bounds: moving a window between screens of different scale can otherwise resize it
    this.win.setBounds({
      x: Math.round(base.x + dx),
      y: Math.round(base.y + dy),
      width: base.width,
      height: base.height
    })
  }

  private dragEnd(): void {
    if (!this.dragBase || !this.win || this.win.isDestroyed()) return
    this.dragBase = null
    const b = this.win.getBounds()
    this.setPref({ pos: { x: b.x, y: b.y } })
  }

  /** Put the window where the settings say, and draw it again. */
  private refresh(): void {
    const win = this.win
    if (!win || win.isDestroyed() || !this.shown) return
    win.setBounds(this.bounds())
    void this.render()
  }

  private async render(): Promise<void> {
    if (!this.ready || !this.win || this.win.isDestroyed()) return
    await this.ready
    if (!this.data || this.win.isDestroyed()) return
    const state = { data: this.data, pref: this.pref, menu: this.menu }
    await this.win.webContents
      .executeJavaScript(`render(${JSON.stringify(state)})`)
      .catch((e) => console.error('[hud] could not draw:', e))
  }

  /**
   * Where the window goes: where the user dragged it (kept on a screen), else the chosen corner of the work area of
   * the screen the mouse is on. Slim is centred along the top or bottom edge. The open menu keeps the same anchor.
   */
  private bounds(): Rectangle {
    const { w, h } = this.menu ? MENU : SIZES[this.pref.size]
    const pos = this.pref.pos
    if (pos) {
      const a = screen.getDisplayNearestPoint(pos).workArea
      return {
        x: clamp(pos.x, a.x, a.x + a.width - w),
        y: clamp(pos.y, a.y, a.y + a.height - h),
        width: w,
        height: h
      }
    }
    const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const left = this.pref.corner.endsWith('left')
    const top = this.pref.corner.startsWith('top')
    const centred = this.pref.size === 'slim' && !this.menu
    return {
      x: centred
        ? a.x + Math.round((a.width - w) / 2)
        : left
          ? a.x + MARGIN
          : a.x + a.width - w - MARGIN,
      y: top ? a.y + MARGIN : a.y + a.height - h - MARGIN,
      width: w,
      height: h
    }
  }

  private queueChange(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.onChange(this.pref)
    }, SAVE_DELAY_MS)
  }

  private window(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      width: SIZES[this.pref.size].w,
      height: SIZES[this.pref.size].h,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false, // moved by its drag bar, which sets its bounds itself
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'SnekPad HUD',
      webPreferences: {
        preload: join(__dirname, '../preload/hud.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    // clicks go through to the app underneath until the mouse is over the panel (the page tells us, see setHover)
    win.setIgnoreMouseEvents(true, { forward: true })
    win.on('closed', () => {
      if (this.win === win) {
        this.win = null
        this.ready = null
        this.shown = false
      }
    })
    this.ready = win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(hudPage)}`)
    this.win = win
    return win
  }

  private clearTimers(): void {
    for (const t of [this.flashTimer, this.fadeTimer, this.destroyTimer]) if (t) clearTimeout(t)
    this.flashTimer = this.fadeTimer = this.destroyTimer = null
    if (this.mouseTimer) clearInterval(this.mouseTimer)
    this.mouseTimer = null
  }
}
