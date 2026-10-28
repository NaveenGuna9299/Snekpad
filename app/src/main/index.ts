import {
  app,
  shell,
  screen,
  nativeTheme,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  session,
  Tray,
  Menu,
  nativeImage
} from 'electron'
import { dirname, join } from 'path'
import { spawn } from 'child_process'
import { existsSync, writeFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { showSplash } from './splash'
import { DeviceManager } from './device/manager'
import { isMusicEffect } from '../shared/config'
import { FocusWatcher } from './focusWatcher'
import {
  backupsDir,
  loadConfig,
  saveConfig,
  backupPushed,
  loadBaseline,
  loadTemplates,
  saveTemplates,
  loadTheme,
  saveTheme,
  loadAutoUpdateCheck,
  saveAutoUpdateCheck,
  loadHud,
  saveHud
} from './store'
import { Hud } from './hud'
import { hudPatchSchema, HUD_MODES } from '../shared/hud'
import { checkForUpdate, openReleases } from './updater'
import { listRunning, rememberProgram, programIcon } from './programs'
import { bundleInfo, readBundle } from './firmwareBundle'
import {
  profileSchema,
  validateConfig,
  type Config,
  type Profile,
  type Template
} from '../shared/config'
import { exportBackup, exportProfile, importBackup, importProfile } from './files'
import type { PushResult } from '../shared/api'
import { chromeColors, themePrefSchema } from '../shared/theme'

// A local app has nothing worth caching. A cache left half-written by a killed process made the
// window open blank ("No file for ..." in the log), so don't keep the web/shader caches on disk.
app.commandLine.appendSwitch('disable-http-cache')
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
// The UI is flat panels and text, so software rendering is plenty and saves the GPU process.
app.disableHardwareAcceleration()

const LOGIN_DELAY_MS = 20000 // when started by Windows at login, wait this long before doing any work
const device = new DeviceManager()
// tells the pad which program is in focus, so it can switch profiles by itself
const focus = new FocusWatcher((proc, title) => device.sendApp(proc, title))
// Closing the window keeps the app running in the tray: profile switching needs it to stay alive.
let tray: Tray | null = null
// The music effects need the page (it listens to the sound and works out the levels). While one is chosen, closing the
// window only hides it, so the lights keep following the music from the tray; otherwise closing destroys the window and
// its renderer, so the tray costs no web-page memory.
let musicActive = false
let quitting = false
// the HUD over other apps; it follows the profile the pad says it is on
let config: Config | null = null
const hud = new Hud(
  loadHud(),
  (pref) => {
    saveHud(pref)
    tray?.setContextMenu(trayMenu()) // its radio buttons follow the settings
  },
  // Studio's settings window may be open while the HUD's own menu changes something
  (pref) => {
    for (const w of studioWindows()) w.webContents.send('hud:pref', pref)
  }
)
let hudKey: string | undefined // which profile the HUD was last told about (the pad's number, or the slot's profile id)

/** Tell the HUD which profile the pad is on. Only a real change of profile flashes it, not the first report or an edit. */
function updateHud(): void {
  const s = device.state
  const slotLayer = config?.profiles.length
  let profile =
    !config || s.status !== 'connected' || s.activeProfile === undefined
      ? null
      : s.activeProfile === slotLayer
        ? (config.studioProfiles.find((p) => p.id === s.slot) ?? null)
        : (config.profiles[s.activeProfile] ?? null)
  let key = profile
    ? s.activeProfile === slotLayer
      ? `slot:${profile.id}`
      : String(s.activeProfile)
    : undefined
  // an extra layer of the Studio-only profile is on top: the HUD shows its keys
  const sub = s.activeProfile === slotLayer ? (s.activeSub ?? 0) : 0
  const layer = profile && sub > 0 ? profile.layers[sub - 1] : undefined
  if (profile && layer) {
    key = `${key}:${sub}`
    profile = { ...profile, name: `${profile.name} · Layer ${sub + 1}`, keys: layer.keys }
  }
  hud.setProfile(profile, key !== undefined && hudKey !== undefined && key !== hudKey)
  hudKey = key
}

/** The native window buttons are drawn by the OS over our title bar, so they must match the theme. */
const overlay = (): { color: string; symbolColor: string; height: number } => {
  const c = chromeColors(nativeTheme.shouldUseDarkColors)
  return { color: c.background, symbolColor: c.symbol, height: 36 }
}

// DEVELOPMENT TOOLS (__DEV_TOOLS__ is false in the production build, so all of this is compiled out).
// True while the renderer shows the key test: the pad then types its shortcuts into this window, so
// the window must not act on them (Ctrl+W would close it).
let keyTestActive = false
function setKeyTest(on: boolean): void {
  if (!__DEV_TOOLS__) return
  keyTestActive = on
  device.setTestMode(on) // the pad types nothing while this is on, and goes back to normal if the app goes quiet
}
const isShortcut = (i: Electron.Input): boolean =>
  i.type === 'keyDown' && (i.control || i.alt || i.meta || /^F\d{1,2}$/.test(i.key))

function createWindow(onShown?: () => void, hidden = false): BrowserWindow {
  setKeyTest(false)
  // Fit the window to the screen: tall enough to show the whole home page, never bigger than the
  // usable area (taskbar excluded), and centred.
  const { width: areaW, height: areaH } = screen.getPrimaryDisplay().workAreaSize
  const mainWindow = new BrowserWindow({
    width: Math.min(1180, areaW - 40),
    height: Math.min(880, areaH - 40),
    minWidth: Math.min(900, areaW),
    minHeight: Math.min(600, areaH),
    center: true,
    show: false,
    autoHideMenuBar: true,
    title: 'SnekPad Studio',
    backgroundColor: chromeColors(nativeTheme.shouldUseDarkColors).background,
    // Discord-style window: our own title bar, with the OS drawing the window buttons over it
    titleBarStyle: 'hidden',
    titleBarOverlay: overlay(),
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // the music effects listen to the sound while the window is minimised, and the audio must start without a click
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  // Closing destroys the window (and its renderer process) instead of hiding it, so the tray-only
  // state costs no web-page memory. Edits are auto-saved, and showWindow() rebuilds it on demand.

  mainWindow.on('ready-to-show', () => {
    if (!hidden) mainWindow.show() // a window made only for the music effects stays in the tray
    onShown?.()
  })

  mainWindow.on('close', (e) => {
    if (musicActive && !quitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  // A blank window means the page failed to load or the renderer died: say why, and retry.
  const wc = mainWindow.webContents
  if (__DEV_TOOLS__) {
    wc.on('before-input-event', (e, input) => {
      if (keyTestActive && isShortcut(input)) e.preventDefault() // also stops menu accelerators
    })
    wc.on('did-start-loading', () => setKeyTest(false)) // a reload starts on the home screen
    mainWindow.on('closed', () => setKeyTest(false))
  }
  wc.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[window] load failed (${code} ${desc}) ${url}; retrying`)
    setTimeout(() => !mainWindow.isDestroyed() && wc.reload(), 500)
  })
  wc.on('render-process-gone', (_e, d) => {
    console.error(`[window] renderer gone: ${d.reason}; reloading`)
    if (!mainWindow.isDestroyed()) wc.reload()
  })
  wc.on('console-message', (e) => {
    if (e.level === 'error') console.error(`[renderer] ${e.message}`)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

// only an installed Windows build can sit in Windows' startup list (a dev build would register electron.exe)
// The Windows installer puts "Uninstall SnekPad Studio.exe" next to the app. Windows' own list of installed apps (Settings,
// Control Panel) can lag behind or miss an app, so Studio can start that uninstaller itself.
const uninstallerPath = (): string =>
  join(dirname(process.execPath), 'Uninstall SnekPad Studio.exe')
const canUninstall = (): boolean =>
  app.isPackaged && process.platform === 'win32' && existsSync(uninstallerPath())

const canAutoStart = (): boolean => app.isPackaged && process.platform === 'win32'

// Windows only reports the entry when asked with the same args it was registered with
const STARTUP_ARGS = ['--hidden']
const loginEnabled = (): boolean => app.getLoginItemSettings({ args: STARTUP_ARGS }).openAtLogin

function registerIpc(): void {
  ipcMain.handle('config:load', () => loadConfig())

  ipcMain.handle('config:save', (_e, config: Config) => {
    const v = validateConfig(config)
    if (v.ok) {
      saveConfig(v.config)
      device.setConfig(v.config) // the Studio-only profiles are kept here: the pad gets one when its app is in focus
      config = v.config
      updateHud()
    }
    return v
  })

  ipcMain.handle('device:push', async (_e, config: Config): Promise<PushResult> => {
    const v = validateConfig(config)
    if (!v.ok) return { ok: false, error: v.errors.join('; ') }
    saveConfig(v.config)
    device.setConfig(v.config)
    config = v.config
    updateHud()
    const r = await device.push(v.config)
    if (r.ok) backupPushed(v.config)
    return r
  })

  ipcMain.handle('device:try', async (_e, profile: unknown): Promise<PushResult> => {
    const p = profileSchema.safeParse(profile)
    return p.success
      ? device.tryProfile(p.data)
      : { ok: false, error: 'This profile cannot be shown.' }
  })

  ipcMain.handle('file:exportProfile', (_e, profile: Profile) => exportProfile(profile))
  ipcMain.handle('file:importProfile', () => importProfile())
  ipcMain.handle('file:exportBackup', (_e, config: Config) => exportBackup(config))
  ipcMain.handle('file:importBackup', () => importBackup(backupsDir()))

  ipcMain.handle('baseline:load', () => loadBaseline())
  ipcMain.handle('baseline:save', (_e, config: Config) => {
    const v = validateConfig(config)
    if (v.ok) backupPushed(v.config)
  })

  ipcMain.handle('theme:get', () => loadTheme())
  ipcMain.handle('theme:set', (_e, theme: unknown) => {
    const v = themePrefSchema.safeParse(theme)
    if (!v.success) return
    saveTheme(v.data)
    nativeTheme.themeSource = v.data // the renderer's prefers-color-scheme follows this
  })

  hud.listen()
  ipcMain.handle('hud:get', () => hud.getPref())
  ipcMain.handle('hud:set', (_e, patch: unknown) => {
    const v = hudPatchSchema.safeParse(patch)
    if (v.success) hud.setPref(v.data)
  })

  ipcMain.handle('templates:load', () => loadTemplates())
  ipcMain.handle('templates:save', (_e, list: Template[]) => saveTemplates(list))

  ipcMain.handle('startup:get', () => ({ supported: canAutoStart(), enabled: loginEnabled() }))
  ipcMain.handle('app:canUninstall', () => canUninstall())
  ipcMain.handle('app:uninstall', () => {
    if (!canUninstall()) return
    // the uninstaller closes a running Studio itself, but quitting first leaves nothing of ours to wait for
    spawn(uninstallerPath(), ['/currentuser'], { detached: true, stdio: 'ignore' }).unref()
    quitting = true
    app.quit()
  })
  ipcMain.handle('startup:set', (_e, on: boolean) => {
    if (canAutoStart()) app.setLoginItemSettings({ openAtLogin: on, args: STARTUP_ARGS })
    return loginEnabled()
  })

  ipcMain.handle('update:check', () => checkForUpdate())
  ipcMain.handle('update:open', () => openReleases())
  ipcMain.handle('update:getAuto', () => loadAutoUpdateCheck())
  ipcMain.handle('update:setAuto', (_e, on: boolean) => saveAutoUpdateCheck(on === true))

  ipcMain.handle('programs:running', () => listRunning().catch(() => []))
  ipcMain.handle('programs:remember', (_e, proc: string) => rememberProgram(proc))
  ipcMain.handle('programs:icon', (_e, proc: string) => programIcon(proc))

  ipcMain.handle('device:pull', () => device.pull())
  ipcMain.handle('device:state', () => device.state)
  ipcMain.handle('device:mock', (_e, on: boolean) => device.useMock(on))
  if (__DEV_TOOLS__) ipcMain.handle('app:keyTest', (_e, on: boolean) => setKeyTest(on === true))
  ipcMain.handle('device:led', (_e, layer: number, key: number, color: string) =>
    device.previewLed(layer, key, color)
  )

  // The music effects: the window listens to the sound the computer plays (system audio loopback, Windows) and sends the
  // levels here, which go on to the pad. The handler answers the window's request for "the screen" with the first
  // screen and its sound, so no picker appears; the window throws the picture away and keeps the sound.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
        .catch(() => callback({}))
    },
    { useSystemPicker: false }
  )
  // The page says whether a music effect is chosen. When it stops while the window is closed to the tray, the window
  // (kept only for the music) goes.
  ipcMain.on('music:active', (_e, on: unknown) => {
    musicActive = on === true
    tray?.setToolTip(trayTip())
    if (!musicActive) {
      for (const w of studioWindows()) if (!w.isVisible()) w.destroy()
    }
  })
  ipcMain.on('music:levels', (_e, bands: unknown, beat: unknown) => {
    if (!Array.isArray(bands) || typeof beat !== 'number') return
    device.sendMusic(
      bands.map((n) => (typeof n === 'number' ? n : 0)),
      beat
    )
  })

  // The firmware inside this build (resources/firmware). Read and checked each time, so a damaged bundle is never sent.
  // SNEKPAD_FIRMWARE_DIR (a folder with manifest.json) lets a development build try another bundle, for example a
  // test update. It is compiled out of the production build, which only ever sends the bundle it was built with.
  const bundleDir = (): string =>
    (__DEV_TOOLS__ && process.env['SNEKPAD_FIRMWARE_DIR']) ||
    join(app.getAppPath(), 'resources', 'firmware')
  ipcMain.handle('firmware:bundle', () => bundleInfo(readBundle(bundleDir())))
  ipcMain.handle('firmware:info', () => device.firmwareInfo())
  ipcMain.handle('firmware:update', async () => {
    const r = readBundle(bundleDir())
    if (!r.ok) return { ok: false, error: r.error }
    return device.updateFirmware(r.bundle, (p) => {
      for (const w of studioWindows()) w.webContents.send('firmware:progress', p)
    })
  })
  ipcMain.handle('firmware:cancel', () => device.cancelFirmwareUpdate())

  device.on('event', (e) => {
    for (const w of studioWindows()) w.webContents.send('device:event', e)
    if (e.kind === 'key') hud.press(e.index, e.down) // light the key up on the HUD
  })

  device.on('state', (s) => {
    for (const w of studioWindows()) w.webContents.send('device:state', s)
    updateHud()
  })
}

// one copy only: a second one would fight the first over the pad's serial port
if (!app.requestSingleInstanceLock()) app.quit()
else app.on('second-instance', () => showWindow())

const trayTip = (): string =>
  musicActive
    ? 'SnekPad Studio (profile switching and the music lights are on)'
    : 'SnekPad Studio (profile switching is on)'

/** Studio's own window(s): every window but the HUD. */
const studioWindows = (): BrowserWindow[] =>
  BrowserWindow.getAllWindows().filter((w) => !hud.owns(w))

const trayMenu = (): Menu =>
  Menu.buildFromTemplate([
    { label: 'Open SnekPad Studio', click: showWindow },
    {
      label: 'Keys HUD over apps',
      submenu: HUD_MODES.map((m) => ({
        label: m.label,
        type: 'radio' as const,
        checked: hud.getPref().mode === m.id,
        click: () => hud.setPref({ mode: m.id })
      }))
    },
    { type: 'separator' },
    { label: 'Quit (stops profile switching)', click: () => app.quit() }
  ])

function showWindow(): void {
  const w = studioWindows()[0]
  if (!w) return void createWindow()
  w.show()
  w.focus()
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.snekpad.studio')

  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  nativeTheme.themeSource = loadTheme()
  nativeTheme.on('updated', () => {
    if (process.platform === 'darwin') return // macOS draws its own window buttons
    for (const w of studioWindows()) {
      try {
        w.setTitleBarOverlay(overlay())
        w.setBackgroundColor(overlay().color)
      } catch {
        /* window closing */
      }
    }
  })

  registerIpc()
  const startHidden = process.argv.includes('--hidden')
  // At login the app stays out of Windows' way: no window or renderer is created, and the pad
  // connection and focus watcher wait until the desktop has settled.
  const startWork = (): void => {
    config = loadConfig()
    device.setConfig(config) // so the Studio-only profiles work from the tray, before any window is opened
    device.start()
    focus.start()
  }
  if (startHidden) {
    setTimeout(() => {
      startWork()
      // started with Windows and a music effect is chosen: make the page, hidden, so the lights follow the music
      if (isMusicEffect(loadConfig().settings.effect) && studioWindows().length === 0) {
        musicActive = true
        tray?.setToolTip(trayTip())
        createWindow(undefined, true)
      }
    }, LOGIN_DELAY_MS)
  } else startWork()

  // First run of an installed build: start with Windows (hidden in the tray) so profiles switch
  // without opening the window. After that the choice is the user's, set in the top bar.
  if (canAutoStart()) {
    const marker = join(app.getPath('userData'), 'startup-offered')
    if (!existsSync(marker)) {
      app.setLoginItemSettings({ openAtLogin: true, args: STARTUP_ARGS })
      try {
        writeFileSync(marker, '1')
      } catch {
        /* will just offer again next launch */
      }
    }
  }

  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }))
  tray.setToolTip(trayTip())
  tray.setContextMenu(trayMenu())
  tray.on('click', showWindow)

  if (!startHidden) {
    const splash = showSplash()
    createWindow(() => void splash.close())
  }

  app.on('activate', () => {
    if (studioWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  quitting = true
  hud.destroy()
  focus.stop()
  device.stop()
})

app.on('window-all-closed', () => {
  // the window only hides on close, so the app (and the focus watcher) keeps running in the tray
})
