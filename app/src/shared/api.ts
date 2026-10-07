// The typed bridge between the renderer and the main process (exposed by the preload script).

import type { Config, Template, ValidationResult } from './config'
import type { ThemePref } from './theme'
import type { UpdateInfo } from './update'
import type { LiveView, PadEvent } from './protocol'

export type DeviceState = {
  status: 'disconnected' | 'connected'
  kind?: 'serial' | 'mock'
  label?: string
  error?: string
  /** The pad speaks protocol 2: it reports its active profile and key presses. */
  events?: boolean
  /** Index of the profile the pad is running (known once the pad reports it). */
  activeProfile?: number
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
  /** The config the pad is known to hold (last push, or last adopted from the pad); null if never. */
  loadBaseline(): Promise<Config | null>
  saveBaseline(config: Config): Promise<void>
  deviceState(): Promise<DeviceState>
  /** Reads the live config (keys, colours, OLED text) from the connected pad. */
  pull(): Promise<PullResult>
  /** The user's own saved profiles. */
  loadTemplates(): Promise<Template[]>
  saveTemplates(list: Template[]): Promise<Template[]>
  /** The colour theme choice; `system` follows the OS. */
  getTheme(): Promise<ThemePref>
  setTheme(theme: ThemePref): Promise<void>
  useMock(on: boolean): Promise<void>
  previewLed(layer: number, key: number, color: string): Promise<void>
  /** Programs with a window right now, with their own icons (Windows). */
  runningPrograms(): Promise<RunningProgram[]>
  /** Keep the icon of a picked program so it still shows when the program is closed. */
  rememberProgram(proc: string): Promise<void>
  programIcon(proc: string): Promise<string | null>
  /** Start with Windows (hidden in the tray). `supported` is false in dev builds and off Windows. */
  getStartup(): Promise<{ supported: boolean; enabled: boolean }>
  setStartup(on: boolean): Promise<boolean>
  /** Asks GitHub whether a newer release exists. Never downloads or installs anything. */
  checkForUpdate(): Promise<UpdateInfo>
  openReleasePage(): Promise<void>
  getAutoUpdateCheck(): Promise<boolean>
  setAutoUpdateCheck(on: boolean): Promise<void>
  onDeviceState(cb: (s: DeviceState) => void): () => void
  /** Key presses reported by the pad (profile changes arrive as part of the device state). */
  onDeviceEvent(cb: (e: Extract<PadEvent, { kind: 'key' }>) => void): () => void
}
