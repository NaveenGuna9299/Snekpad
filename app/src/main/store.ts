// Local storage of the config. Everything stays on this computer (no cloud, no telemetry).

import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { z } from 'zod'
import { themePrefSchema, type ThemePref } from '../shared/theme'
import { rollingBackup } from './autoBackup'
import {
  defaultConfig,
  migrateConfig,
  templateSchema,
  validateConfig,
  type Config,
  type Template
} from '../shared/config'

const dir = (): string => {
  const d = join(app.getPath('userData'), 'snekpad')
  mkdirSync(d, { recursive: true })
  return d
}

/** Write to a temp file, then rename, so a crash never leaves a half-written file. */
function writeAtomic(path: string, text: string): void {
  const tmp = path + '.tmp'
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

export function loadConfig(): Config {
  const file = join(dir(), 'config.json')
  if (!existsSync(file)) return defaultConfig()
  try {
    const v = validateConfig(migrateConfig(JSON.parse(readFileSync(file, 'utf8'))))
    if (v.ok) return v.config
    console.warn('saved config is invalid, using defaults:', v.errors)
  } catch (e) {
    console.warn('could not read saved config, using defaults:', e)
  }
  return defaultConfig()
}

let lastSafetyCopy = 0

/** Where Studio keeps its own safety copies of the config (and where "Restore from a backup" opens first). */
export const backupsDir = (): string => join(dir(), 'backups')

export function saveConfig(config: Config): void {
  const file = join(dir(), 'config.json')
  lastSafetyCopy = rollingBackup(backupsDir(), file, lastSafetyCopy) // a copy of what is about to be replaced
  writeAtomic(file, JSON.stringify(config, null, 2))
}

/** The config the pad is known to hold: the last successful push, or the last one adopted from the pad. */
export function loadBaseline(): Config | null {
  const file = join(dir(), 'last-pushed.json')
  if (!existsSync(file)) return null
  try {
    const v = validateConfig(migrateConfig(JSON.parse(readFileSync(file, 'utf8'))))
    return v.ok ? v.config : null
  } catch {
    return null
  }
}

/** Keep a copy of the config the pad is known to hold (written after each successful push). */
export function backupPushed(config: Config): void {
  writeAtomic(join(dir(), 'last-pushed.json'), JSON.stringify(config, null, 2))
}

/** The user's own saved profiles ("More profiles"). Bad entries are dropped, not fatal. */
export function loadTemplates(): Template[] {
  const file = join(dir(), 'templates.json')
  if (!existsSync(file)) return []
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(raw)
      ? raw.flatMap((t) => {
          const r = templateSchema.safeParse(t)
          return r.success ? [r.data] : []
        })
      : []
  } catch (e) {
    console.warn('could not read saved profiles:', e)
    return []
  }
}

export function saveTemplates(list: Template[]): Template[] {
  const clean = z.array(templateSchema).max(100).parse(list)
  writeAtomic(join(dir(), 'templates.json'), JSON.stringify(clean, null, 2))
  return clean
}

/** App-level preferences (not part of the pad config). Unreadable or unknown values fall back to defaults. */
function readSettings(): Record<string, unknown> {
  try {
    const raw = JSON.parse(readFileSync(join(dir(), 'settings.json'), 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function writeSetting(key: string, value: unknown): void {
  const all = { ...readSettings(), [key]: value }
  writeAtomic(join(dir(), 'settings.json'), JSON.stringify(all, null, 2))
}

export function loadTheme(): ThemePref {
  const v = themePrefSchema.safeParse(readSettings().theme)
  return v.success ? v.data : 'system'
}

export function saveTheme(theme: ThemePref): void {
  writeSetting('theme', theme)
}

/** Whether to look for a newer release when the window opens (on by default). */
export function loadAutoUpdateCheck(): boolean {
  return readSettings().autoUpdateCheck !== false
}

export function saveAutoUpdateCheck(on: boolean): void {
  writeSetting('autoUpdateCheck', on)
}
