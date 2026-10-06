import { app, shell, screen, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { showSplash } from './splash'
import { DeviceManager } from './device/manager'
import { loadConfig, saveConfig, backupPushed, loadTemplates, saveTemplates } from './store'
import { listRunning, rememberProgram, programIcon } from './programs'
import { validateConfig, type Config, type Template } from '../shared/config'
import type { PushResult } from '../shared/api'

// A local app has nothing worth caching. A cache left half-written by a killed process made the
// window open blank ("No file for ..." in the log), so don't keep the web/shader caches on disk.
app.commandLine.appendSwitch('disable-http-cache')
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

const device = new DeviceManager()

function createWindow(onShown?: () => void): BrowserWindow {
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
    backgroundColor: '#1a1b1e',
    // Discord-style window: our own title bar, with the OS drawing the window buttons over it
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1a1b1e', symbolColor: '#b5bac1', height: 36 },
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    onShown?.()
  })

  // A blank window means the page failed to load or the renderer died: say why, and retry.
  const wc = mainWindow.webContents
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

  ipcMain.handle('templates:load', () => loadTemplates())
  ipcMain.handle('templates:save', (_e, list: Template[]) => saveTemplates(list))

  ipcMain.handle('programs:running', () => listRunning().catch(() => []))
  ipcMain.handle('programs:remember', (_e, proc: string) => rememberProgram(proc))
  ipcMain.handle('programs:icon', (_e, proc: string) => programIcon(proc))

  ipcMain.handle('device:pull', () => device.pull())
  ipcMain.handle('device:state', () => device.state)
  ipcMain.handle('device:mock', (_e, on: boolean) => device.useMock(on))
  ipcMain.handle('device:led', (_e, layer: number, key: number, color: string) =>
    device.previewLed(layer, key, color)
  )

  device.on('state', (s) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('device:state', s)
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.snekpad.studio')

  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  registerIpc()
  device.start()
  const splash = showSplash()
  createWindow(() => void splash.close())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => device.stop())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
