// SnekPad Studio Setup: a themed front end for the real NSIS installer.
// The NSIS setup.exe is bundled as a payload and run silently; this window only shows progress.

const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const { spawn, spawnSync } = require('node:child_process')
const { runSetup } = require('./installRunner')
const fs = require('node:fs')
const path = require('node:path')

const DRY_RUN = process.env.SNEKPAD_SETUP_DRYRUN === '1'
const PRODUCT = 'SnekPad Studio'

let win = null
let child = null

const payloadDir = app.isPackaged
  ? path.join(process.resourcesPath, 'payload')
  : path.join(__dirname, 'payload')

function defaultDir() {
  const base = process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local')
  return path.join(base, 'Programs', PRODUCT)
}

function readMeta() {
  try {
    return JSON.parse(fs.readFileSync(path.join(payloadDir, 'payload.json'), 'utf8'))
  } catch {
    return { version: app.getVersion(), expectedBytes: 300 * 1024 * 1024 }
  }
}

function dirSize(dir) {
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) stack.push(p)
      else
        try {
          total += fs.statSync(p).size
        } catch {
          /* file vanished mid-scan */
        }
    }
  }
  return total
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data)
}

function install(dir) {
  const meta = readMeta()
  let done = false
  const finish = (ok, error) => {
    if (done) return
    done = true
    clearInterval(timer)
    child = null
    send('install:done', { ok, error, dir })
  }

  // NSIS gives no progress in silent mode, so estimate it from how much has landed on disk.
  let shown = 0
  const timer = setInterval(() => {
    if (DRY_RUN) {
      shown = Math.min(100, shown + 2)
      send('install:progress', shown)
      if (shown >= 100) finish(true)
      return
    }
    const pct = Math.min(97, Math.floor((dirSize(dir) / meta.expectedBytes) * 100))
    shown = Math.max(shown, pct)
    send('install:progress', shown)
  }, 250)

  if (DRY_RUN) return

  const setup = path.join(payloadDir, 'setup.exe')
  if (!fs.existsSync(setup)) return finish(false, 'The installer payload is missing.')
  // The setup is run again if the old version could not be removed (see installRunner.js).
  runSetup({
    // /D must be the last argument and must not be quoted, even if the path has spaces.
    start: () =>
      spawn(setup, ['/S', `/D=${dir}`], { windowsVerbatimArguments: true, windowsHide: true }),
    stopStudio,
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    onChild: (c) => (child = c)
  }).then((r) => (r.ok ? finish(true) : finish(false, r.error)))
}

/** Closes a running SnekPad Studio (it lives in the tray when its window is closed), so its files can be replaced. */
function stopStudio() {
  if (process.platform !== 'win32') return false
  const r = spawnSync('taskkill', ['/F', '/IM', `${PRODUCT}.exe`], { windowsHide: true })
  return r.status === 0 // 0 = it found one and closed it
}

function launchInstalled(dir) {
  if (DRY_RUN) return
  const exe = path.join(dir, `${PRODUCT}.exe`)
  if (fs.existsSync(exe)) spawn(exe, [], { detached: true, stdio: 'ignore' }).unref()
}

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 640,
    height: 440,
    useContentSize: true,
    frame: false,
    resizable: false,
    maximizable: false,
    backgroundColor: '#08090b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, 'index.html'))
  win.once('ready-to-show', () => win.show())

  ipcMain.handle('setup:info', () => ({ dir: defaultDir(), version: readMeta().version }))
  ipcMain.handle('setup:choose-dir', async (_e, current) => {
    const r = await dialog.showOpenDialog(win, {
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    const picked = r.filePaths[0]
    // Always install into a SnekPad Studio folder, so the uninstaller never owns a shared folder.
    return path.basename(picked).toLowerCase() === PRODUCT.toLowerCase()
      ? picked
      : path.join(picked, PRODUCT)
  })
  ipcMain.on('setup:install', (_e, dir) => install(dir))
  ipcMain.on('setup:launch', (_e, dir) => {
    launchInstalled(dir)
    app.quit()
  })
  ipcMain.on('setup:minimize', () => win.minimize())
  ipcMain.on('setup:close', () => app.quit())
})

app.on('window-all-closed', () => app.quit())
