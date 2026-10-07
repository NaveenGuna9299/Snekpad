// Local storage of the config. Everything stays on this computer (no cloud, no telemetry).

import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { z } from 'zod'
import { themePrefSchema, type ThemePref } from '../shared/theme'
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

export function saveConfig(config: Config): void {
  writeAtomic(join(dir(), 'config.json'), JSON.stringify(config, null, 2))
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
export function loadTheme(): ThemePref {
  try {
    const raw = JSON.parse(readFileSync(join(dir(), 'settings.json'), 'utf8'))
    const v = themePrefSchema.safeParse(raw?.theme)
    return v.success ? v.data : 'system'
  } catch {
    return 'system'
  }
}

export function saveTheme(theme: ThemePref): void {
  writeAtomic(join(dir(), 'settings.json'), JSON.stringify({ theme }, null, 2))
}
