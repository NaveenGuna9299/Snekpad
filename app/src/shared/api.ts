// The typed bridge between the renderer and the main process (exposed by the preload script).

import type { Config, Template, ValidationResult } from './config'
import type { LiveView } from './protocol'

export type DeviceState = {
  status: 'disconnected' | 'connected'
  kind?: 'serial' | 'mock'
  label?: string
  error?: string
}

export type PushResult = { ok: true } | { ok: false; error: string }

/** What the connected pad shows right now (labels, colours, OLED text); an error if the pad has no support for it. */
export type PullResult = { ok: true; view: LiveView } | { ok: false; error: string }

export type RunningProgram = { proc: string; title: string; icon: string | null }

export interface SnekApi {
  loadConfig(): Promise<Config>
  saveConfig(config: Config): Promise<ValidationResult>
  /** Validates, saves a backup of what was sent, then sends it to the pad. */
  push(config: Config): Promise<PushResult>
  deviceState(): Promise<DeviceState>
  /** Reads the live config (keys, colours, OLED text) from the connected pad. */
  pull(): Promise<PullResult>
  /** The user's own saved profiles. */
  loadTemplates(): Promise<Template[]>
  saveTemplates(list: Template[]): Promise<Template[]>
  useMock(on: boolean): Promise<void>
  previewLed(layer: number, key: number, color: string): Promise<void>
  /** Programs with a window right now, with their own icons (Windows). */
  runningPrograms(): Promise<RunningProgram[]>
  /** Keep the icon of a picked program so it still shows when the program is closed. */
  rememberProgram(proc: string): Promise<void>
  programIcon(proc: string): Promise<string | null>
  onDeviceState(cb: (s: DeviceState) => void): () => void
}
