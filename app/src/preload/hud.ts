// The HUD window's own bridge: just enough for its three-dots menu and for dragging it. The page is built by
// src/main/hudPage.ts and draws everything from text the main process hands it.
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('hudApi', {
  menu: (open: boolean) => ipcRenderer.send('hud:menu', open === true),
  set: (patch: unknown) => ipcRenderer.send('hud:patch', patch),
  dragStart: () => ipcRenderer.send('hud:drag', 'start'),
  dragMove: (dx: number, dy: number) => ipcRenderer.send('hud:dragmove', dx, dy),
  dragEnd: () => ipcRenderer.send('hud:drag', 'end')
})
