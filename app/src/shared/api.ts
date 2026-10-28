// The typed bridge between the renderer and the main process (exposed by the preload script).

import type { Config, Profile, Template, ValidationResult } from './config'
import type { ThemePref } from './theme'
import type { HudPref } from './hud'
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
  /** Which extra layer of the Studio profile is on top: 0 or unset = its main keys, 1 = Layer 2, 2 = Layer 3. */
  activeSub?: number
  /** The id of the Studio-only profile that is on the pad's slot right now (layer number = the pad's profile count). */
  slot?: string
  /** The pad refused this Studio-only profile: `reason` is 'too big' (not enough RAM for its macros) or the pad's own words. */
  slotError?: { id: string; reason: string }
}

/** The firmware shipped inside this build of Studio (not its bytes), or why there is none. */
export type FirmwareBundleInfo =
  | { ok: true; version: string; circuitpython: string; files: number; bytes: number }
  | { ok: false; error: string; missing: boolean }

export type PushResult = { ok: true } | { ok: false; error: string }

/** What the connected pad shows right now (labels, colours, OLED text); an error if the pad has no support for it. */
export type PullResult = { ok: true; view: LiveView } | { ok: false; error: string }

export type RunningProgram = { proc: string; title: string; icon: string | null }

/** Result of writing an export or backup file. `cancelled` = the user closed the dialog (not an error to show). */
export type FileResult =
  { ok: true; path: string } | { ok: false; error: string; cancelled?: boolean }
export type ImportProfileResult =
  { ok: true; profile: Profile; file: string } | { ok: false; error: string; cancelled?: boolean }
export type ImportBackupResult =
  { ok: true; config: Config; file: string } | { ok: false; error: string; cancelled?: boolean }

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
  /** Save one profile to a file the user picks (to share it or keep it). */
  exportProfile(profile: Profile): Promise<FileResult>
  /** Pick a profile file and read it. The profile still has the id it was exported with: give it a new one. */
  importProfile(): Promise<ImportProfileResult>
  /** Save the whole config (pad profiles, Studio-only profiles, settings) to a file the user picks. */
  exportBackup(config: Config): Promise<FileResult>
  /** Pick a backup file (the dialog opens on Studio's own safety copies) and read it. Nothing is replaced yet. */
  importBackup(): Promise<ImportBackupResult>
  /** The user's own saved profiles. */
  loadTemplates(): Promise<Template[]>
  saveTemplates(list: Template[]): Promise<Template[]>
  /** The colour theme choice; `system` follows the OS. */
  getTheme(): Promise<ThemePref>
  setTheme(theme: ThemePref): Promise<void>
  /** The keys HUD over other apps: off, shown for a moment on each profile switch, or always; and its corner. */
  getHud(): Promise<HudPref>
  setHud(patch: Partial<HudPref>): Promise<void>
  /** The HUD settings changed (from the HUD's own menu or the tray), so an open settings menu can follow. */
  onHud(cb: (pref: HudPref) => void): () => void
  useMock(on: boolean): Promise<void>
  previewLed(layer: number, key: number, color: string): Promise<void>
  /** "Try on pad": show a Studio-only profile on the pad for about 15 seconds, whatever app is in focus. */
  tryProfile(profile: Profile): Promise<PushResult>
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
