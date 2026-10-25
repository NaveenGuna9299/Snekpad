// Studio's own safety copies of the config. Studio-only profiles live nowhere but in config.json on this computer, so a
// slip (a deleted profile, a restore of the starter profiles) would lose them. Before config.json is overwritten, a copy
// of what was in it is kept, at most one every 30 minutes, and only the newest 10: the state from before your last
// stretch of editing is always there. They are ordinary backup files: "Restore from a backup" opens them.
// No electron here, so it can be tested with a temporary folder.

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { autoBackupName, backupFileText } from '../shared/backup'
import { migrateConfig, validateConfig } from '../shared/config'

export const AUTO_BACKUP_EVERY_MS = 30 * 60 * 1000
export const AUTO_BACKUP_KEEP = 10
const AUTO_NAME = /^snekpad-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/

/**
 * Keep a copy of `configFile` (as it is now, before it is overwritten) in `dir`, unless one was kept less than 30 minutes
 * ago (`last`). Returns the time of the latest copy, to pass in next time. Never throws: a backup must not stop a save.
 */
export function rollingBackup(
  dir: string,
  configFile: string,
  last: number,
  now = Date.now()
): number {
  if (now - last < AUTO_BACKUP_EVERY_MS || !existsSync(configFile)) return last
  try {
    const v = validateConfig(migrateConfig(JSON.parse(readFileSync(configFile, 'utf8'))))
    if (!v.ok) return last // what is there is not a config worth keeping
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, autoBackupName(new Date(now))), backupFileText(v.config), 'utf8')
    const old = readdirSync(dir)
      .filter((f) => AUTO_NAME.test(f))
      .sort()
    for (const f of old.slice(0, Math.max(0, old.length - AUTO_BACKUP_KEEP)))
      unlinkSync(join(dir, f))
    return now
  } catch (e) {
    console.warn('could not keep a safety copy of the config:', e)
    return last
  }
}
