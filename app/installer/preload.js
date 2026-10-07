const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('setup', {
  info: () => ipcRenderer.invoke('setup:info'),
  chooseDir: (current) => ipcRenderer.invoke('setup:choose-dir', current),
  install: (dir) => ipcRenderer.send('setup:install', dir),
  launch: (dir) => ipcRenderer.send('setup:launch', dir),
  minimize: () => ipcRenderer.send('setup:minimize'),
  close: () => ipcRenderer.send('setup:close'),
  onProgress: (cb) => ipcRenderer.on('install:progress', (_e, p) => cb(p)),
  onDone: (cb) => ipcRenderer.on('install:done', (_e, r) => cb(r))
})
