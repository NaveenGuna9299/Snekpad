import { contextBridge, ipcRenderer } from 'electron'
import type { SnekApi, DeviceState } from '../shared/api'
import type { PadInput } from '../shared/protocol'
import type { FirmwareProgress } from '../shared/firmwareUpdate'

const api: SnekApi = {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  push: (config) => ipcRenderer.invoke('device:push', config),
  loadBaseline: () => ipcRenderer.invoke('baseline:load'),
  saveBaseline: (config) => ipcRenderer.invoke('baseline:save', config),
  deviceState: () => ipcRenderer.invoke('device:state'),
  pull: () => ipcRenderer.invoke('device:pull'),
  loadTemplates: () => ipcRenderer.invoke('templates:load'),
  saveTemplates: (list) => ipcRenderer.invoke('templates:save', list),
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: (theme) => ipcRenderer.invoke('theme:set', theme),
  useMock: (on) => ipcRenderer.invoke('device:mock', on),
  previewLed: (layer, key, color) => ipcRenderer.invoke('device:led', layer, key, color),
  setKeyTest: (on) => (__DEV_TOOLS__ ? ipcRenderer.invoke('app:keyTest', on) : Promise.resolve()),
  runningPrograms: () => ipcRenderer.invoke('programs:running'),
  rememberProgram: (proc) => ipcRenderer.invoke('programs:remember', proc),
  programIcon: (proc) => ipcRenderer.invoke('programs:icon', proc),
  getStartup: () => ipcRenderer.invoke('startup:get'),
  setStartup: (on) => ipcRenderer.invoke('startup:set', on),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  openReleasePage: () => ipcRenderer.invoke('update:open'),
  getAutoUpdateCheck: () => ipcRenderer.invoke('update:getAuto'),
  setAutoUpdateCheck: (on) => ipcRenderer.invoke('update:setAuto', on),
  firmwareBundle: () => ipcRenderer.invoke('firmware:bundle'),
  firmwareInfo: () => ipcRenderer.invoke('firmware:info'),
  updateFirmware: () => ipcRenderer.invoke('firmware:update'),
  cancelFirmwareUpdate: () => ipcRenderer.invoke('firmware:cancel'),
  onFirmwareProgress: (cb) => {
    const handler = (_: unknown, p: FirmwareProgress): void => cb(p)
    ipcRenderer.on('firmware:progress', handler)
    return () => ipcRenderer.removeListener('firmware:progress', handler)
  },
  onDeviceEvent: (cb) => {
    const handler = (_: unknown, e: PadInput): void => cb(e)
    ipcRenderer.on('device:event', handler)
    return () => ipcRenderer.removeListener('device:event', handler)
  },
  onDeviceState: (cb) => {
    const handler = (_: unknown, s: DeviceState): void => cb(s)
    ipcRenderer.on('device:state', handler)
    return () => ipcRenderer.removeListener('device:state', handler)
  }
}

// Only this typed API reaches the renderer: no Node, no raw ipcRenderer.
contextBridge.exposeInMainWorld('api', api)
