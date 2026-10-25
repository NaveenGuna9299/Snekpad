// The files Studio writes when you export a profile or back up everything, and the checks when one is read back in.
// A profile file holds one profile (to share it, or to move it to another computer); a backup holds the whole config:
// the pad's profiles, the Studio-only ones and the settings. Both are plain JSON you can open in a text editor.

import {
  FN_KEY,
  migrateConfig,
  profileSchema,
  validateConfig,
  type Config,
  type Profile
} from './config'

export const FILE_VERSION = 1
const PROFILE_KIND = 'snekpad-profile'
const BACKUP_KIND = 'snekpad-backup'

export type ProfileFileResult = { ok: true; profile: Profile } | { ok: false; error: string }
export type BackupFileResult = { ok: true; config: Config } | { ok: false; error: string }

export const profileFileText = (profile: Profile): string =>
  JSON.stringify({ snekpad: PROFILE_KIND, version: FILE_VERSION, profile }, null, 2)

export const backupFileText = (config: Config): string =>
  JSON.stringify({ snekpad: BACKUP_KIND, version: FILE_VERSION, config }, null, 2)

/** A file name that is safe on every system: letters, digits, dashes. */
const safe = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'profile'

export const profileFileName = (profile: Profile): string =>
  `snekpad-profile-${safe(profile.name)}.json`

const two = (n: number): string => String(n).padStart(2, '0')
const day = (d: Date): string => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`

/** The name offered for a backup you make yourself: one per day, local date. */
export const backupFileName = (date = new Date()): string => `snekpad-backup-${day(date)}.json`

/** The name of a copy Studio keeps by itself (see main/autoBackup.ts): date and time, so none overwrites another. */
export const autoBackupName = (date = new Date()): string =>
  `snekpad-backup-${day(date)}-${two(date.getHours())}${two(date.getMinutes())}.json`

function open(
  text: string,
  kind: string
): { ok: true; body: Record<string, unknown> } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'This is not a SnekPad file (it is not valid JSON).' }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'This is not a SnekPad file.' }
  const body = raw as Record<string, unknown>
  if (body.snekpad !== kind) {
    const other =
      body.snekpad === PROFILE_KIND ? 'a profile' : body.snekpad === BACKUP_KIND ? 'a backup' : null
    return {
      ok: false,
      error: other
        ? `This file holds ${other}, not ${kind === PROFILE_KIND ? 'a profile' : 'a backup'}.`
        : 'This is not a SnekPad file.'
    }
  }
  if (typeof body.version !== 'number' || body.version > FILE_VERSION)
    return {
      ok: false,
      error: 'This file was made by a newer SnekPad Studio. Update Studio to open it.'
    }
  return { ok: true, body }
}

/** Read a profile file. The profile keeps its id, so the caller gives it a fresh one before adding it. */
export function parseProfileFile(text: string): ProfileFileResult {
  const f = open(text, PROFILE_KIND)
  if (!f.ok) return f
  if (!f.body.profile || typeof f.body.profile !== 'object')
    return { ok: false, error: 'This file has no profile in it.' }
  // the same upgrades an old config gets (sequences written as macros), by wrapping the profile in a config
  const wrapped = migrateConfig({ profiles: [f.body.profile] }) as { profiles: unknown[] }
  const p = profileSchema.safeParse(wrapped.profiles[0])
  if (!p.success) {
    const i = p.error.issues[0]
    return {
      ok: false,
      error: `This profile cannot be used: ${i.path.join('.') || 'profile'}: ${i.message}`
    }
  }
  if (p.data.keys[FN_KEY].action.type !== 'fn')
    return {
      ok: false,
      error: `This profile cannot be used: key ${FN_KEY + 1} must stay the FN key.`
    }
  return { ok: true, profile: p.data }
}

/** Read a backup file: the whole config, checked and upgraded the same way a saved one is. */
export function parseBackupFile(text: string): BackupFileResult {
  const f = open(text, BACKUP_KIND)
  if (!f.ok) return f
  const v = validateConfig(migrateConfig(f.body.config))
  if (!v.ok) return { ok: false, error: `This backup cannot be used: ${v.errors[0]}` }
  return { ok: true, config: v.config }
}
