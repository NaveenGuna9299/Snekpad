import { contextBridge, ipcRenderer } from 'electron'
import type { SnekApi, DeviceState } from '../shared/api'

const api: SnekApi = {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  push: (config) => ipcRenderer.invoke('device:push', config),
  deviceState: () => ipcRenderer.invoke('device:state'),
  pull: () => ipcRenderer.invoke('device:pull'),
  loadTemplates: () => ipcRenderer.invoke('templates:load'),
  saveTemplates: (list) => ipcRenderer.invoke('templates:save', list),
  useMock: (on) => ipcRenderer.invoke('device:mock', on),
  previewLed: (layer, key, color) => ipcRenderer.invoke('device:led', layer, key, color),
  runningPrograms: () => ipcRenderer.invoke('programs:running'),
  rememberProgram: (proc) => ipcRenderer.invoke('programs:remember', proc),
  programIcon: (proc) => ipcRenderer.invoke('programs:icon', proc),
  getStartup: () => ipcRenderer.invoke('startup:get'),
  setStartup: (on) => ipcRenderer.invoke('startup:set', on),
  onDeviceState: (cb) => {
    const handler = (_: unknown, s: DeviceState): void => cb(s)
    ipcRenderer.on('device:state', handler)
    return () => ipcRenderer.removeListener('device:state', handler)
  }
}

// Only this typed API reaches the renderer: no Node, no raw ipcRenderer.
contextBridge.exposeInMainWorld('api', api)
