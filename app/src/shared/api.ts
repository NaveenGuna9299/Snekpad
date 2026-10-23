// The typed bridge between the renderer and the main process (exposed by the preload script).

import type { Config, Template, ValidationResult } from './config'
import type { ThemePref } from './theme'
import type { UpdateInfo } from './update'
import type { LiveView, PadInput } from './protocol'
import type { FirmwareProgress, FirmwareUpdateResult, FwInfoResult } from './firmwareUpdate'

export type DeviceState = {
  status: 'disconnected' | 'connected'
  kind?: 'serial' | 'mock'
  label?: string
  error?: string
  /** The pad speaks protocol 2: it reports its active profile and key presses. */
  events?: boolean
  /** Firmware version the pad reported in its HELLO reply (x.y.z); absent if it did not send one. */
  firmware?: string
  /** The pad was flashed with the development tools (key test: TEST, knob events). Never true on a customer pad. */
  dev?: boolean
  /** The pad never answered HELLO, so it runs firmware from before protocol 2. */
  legacy?: boolean
  /** Index of the profile the pad is running (known once the pad reports it). */
  activeProfile?: number
}

/** The firmware shipped inside this build of Studio (not its bytes), or why there is none. */
export type FirmwareBundleInfo =
  | { ok: true; version: string; circuitpython: string; files: number; bytes: number }
  | { ok: false; error: string; missing: boolean }

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
  /** Levels of the sound the computer plays, for the pad's music effects: four bands (0 to 63) and a beat (0 = none). */
  sendMusic(bands: readonly number[], beat: number): void
  /** Tell the main process whether a music effect is chosen: then closing the window hides it (the music keeps playing in the lights from the tray). */
  setMusicActive(on: boolean): void
  /**
   * Key test screen open / closed. While open, the window ignores shortcuts (Ctrl/Alt/Cmd combos and
   * function keys), because the pad types its normal shortcuts into whatever has focus, and one of
   * them can be Ctrl+W.
   */
  setKeyTest(on: boolean): Promise<void>
  /** Programs with a window right now, with their own icons (Windows). */
  runningPrograms(): Promise<RunningProgram[]>
  /** Keep the icon of a picked program so it still shows when the program is closed. */
  rememberProgram(proc: string): Promise<void>
  programIcon(proc: string): Promise<string | null>
  /** Start with Windows (hidden in the tray). `supported` is false in dev builds and off Windows. */
  getStartup(): Promise<{ supported: boolean; enabled: boolean }>
  setStartup(on: boolean): Promise<boolean>
  /** True when this Studio was installed with the Windows installer, so it has an uninstaller of its own to run. */
  canUninstall(): Promise<boolean>
  /** Starts that uninstaller and closes Studio. Does nothing when canUninstall is false. */
  uninstall(): Promise<void>
  /** Asks GitHub whether a newer release exists. Never downloads or installs anything. */
  checkForUpdate(): Promise<UpdateInfo>
  openReleasePage(): Promise<void>
  getAutoUpdateCheck(): Promise<boolean>
  setAutoUpdateCheck(on: boolean): Promise<void>
  onDeviceState(cb: (s: DeviceState) => void): () => void
  /** Key presses reported by the pad (profile changes arrive as part of the device state). */
  onDeviceEvent(cb: (e: PadInput) => void): () => void
  /** The pad firmware inside this build of Studio, if there is one. */
  firmwareBundle(): Promise<FirmwareBundleInfo>
  /** Ask the pad about itself and its last firmware update (a pad without the updater does not answer). */
  firmwareInfo(): Promise<FwInfoResult>
  /**
   * Send the bundled firmware to the pad. The pad asks for a knob press first; progress arrives through
   * onFirmwareProgress. On success the pad restarts by itself and installs it.
   */
  updateFirmware(): Promise<FirmwareUpdateResult>
  /** Stop a firmware update that is running; the pad keeps its old firmware. */
  cancelFirmwareUpdate(): Promise<void>
  onFirmwareProgress(cb: (p: FirmwareProgress) => void): () => void
}
