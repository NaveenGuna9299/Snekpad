import {
  app,
  shell,
  screen,
  nativeTheme,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  nativeImage
} from 'electron'
import { join } from 'path'
import { existsSync, writeFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { showSplash } from './splash'
import { DeviceManager } from './device/manager'
import { FocusWatcher } from './focusWatcher'
import {
  loadConfig,
  saveConfig,
  backupPushed,
  loadBaseline,
  loadTemplates,
  saveTemplates,
  loadTheme,
  saveTheme,
  loadAutoUpdateCheck,
  saveAutoUpdateCheck
} from './store'
import { checkForUpdate, openReleases } from './updater'
import { listRunning, rememberProgram, programIcon } from './programs'
import { bundleInfo, readBundle } from './firmwareBundle'
import { validateConfig, type Config, type Template } from '../shared/config'
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

function createWindow(onShown?: () => void): BrowserWindow {
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
      nodeIntegration: false
    }
  })

  // Closing destroys the window (and its renderer process) instead of hiding it, so the tray-only
  // state costs no web-page memory. Edits are auto-saved, and showWindow() rebuilds it on demand.

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    onShown?.()
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
const canAutoStart = (): boolean => app.isPackaged && process.platform === 'win32'

// Windows only reports the entry when asked with the same args it was registered with
const STARTUP_ARGS = ['--hidden']
const loginEnabled = (): boolean => app.getLoginItemSettings({ args: STARTUP_ARGS }).openAtLogin

function registerIpc(): void {
  ipcMain.handle('config:load', () => loadConfig())

  ipcMain.handle('config:save', (_e, config: Config) => {
    const v = validateConfig(config)
    if (v.ok) saveConfig(v.config)
    return v
  })

  ipcMain.handle('device:push', async (_e, config: Config): Promise<PushResult> => {
    const v = validateConfig(config)
    if (!v.ok) return { ok: false, error: v.errors.join('; ') }
    saveConfig(v.config)
    const r = await device.push(v.config)
    if (r.ok) backupPushed(v.config)
    return r
  })

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

  ipcMain.handle('templates:load', () => loadTemplates())
  ipcMain.handle('templates:save', (_e, list: Template[]) => saveTemplates(list))

  ipcMain.handle('startup:get', () => ({ supported: canAutoStart(), enabled: loginEnabled() }))
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
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('firmware:progress', p)
    })
  })
  ipcMain.handle('firmware:cancel', () => device.cancelFirmwareUpdate())

  device.on('event', (e) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('device:event', e)
  })

  device.on('state', (s) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('device:state', s)
  })
}

// one copy only: a second one would fight the first over the pad's serial port
if (!app.requestSingleInstanceLock()) app.quit()
else app.on('second-instance', () => showWindow())

function showWindow(): void {
  const w = BrowserWindow.getAllWindows()[0]
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
    for (const w of BrowserWindow.getAllWindows()) {
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
    device.start()
    focus.start()
  }
  if (startHidden) setTimeout(startWork, LOGIN_DELAY_MS)
  else startWork()

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

  const show = showWindow
  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }))
  tray.setToolTip('SnekPad Studio (profile switching is on)')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open SnekPad Studio', click: show },
      { label: 'Quit (stops profile switching)', click: () => app.quit() }
    ])
  )
  tray.on('click', show)

  if (!startHidden) {
    const splash = showSplash()
    createWindow(() => void splash.close())
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  focus.stop()
  device.stop()
})

app.on('window-all-closed', () => {
  // the window only hides on close, so the app (and the focus watcher) keeps running in the tray
})
