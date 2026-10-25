import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FILE_VERSION,
  autoBackupName,
  backupFileName,
  backupFileText,
  parseBackupFile,
  parseProfileFile,
  profileFileName,
  profileFileText
} from '../src/shared/backup'
import { blankProfile, defaultConfig, type Config } from '../src/shared/config'
import { AUTO_BACKUP_EVERY_MS, AUTO_BACKUP_KEEP, rollingBackup } from '../src/main/autoBackup'

describe('a profile file', () => {
  const profile = defaultConfig().studioProfiles[0]

  it('reads back exactly what was exported', () => {
    const r = parseProfileFile(profileFileText(profile))
    expect(r.ok).toBe(true)
    expect(r.ok && r.profile).toEqual(profile)
  })

  it('keeps titles, sequences and the knob', () => {
    const p = defaultConfig().profiles[2] // Terminal: a sequence and text macros
    p.match.titles = ['ssh', 'WSL']
    const r = parseProfileFile(profileFileText(p))
    expect(r.ok && r.profile).toEqual(p)
  })

  it('is plain JSON that says what it is', () => {
    const o = JSON.parse(profileFileText(profile))
    expect(o.snekpad).toBe('snekpad-profile')
    expect(o.version).toBe(FILE_VERSION)
    expect(o.profile.name).toBe('Browser')
  })

  it('refuses text that is not JSON', () => {
    const r = parseProfileFile('hello')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/not valid JSON/)
  })

  it('refuses JSON that is not a SnekPad file', () => {
    for (const text of ['{}', '[]', 'null', '{"snekpad":"other"}', '42']) {
      const r = parseProfileFile(text)
      expect(r.ok, text).toBe(false)
      expect(!r.ok && r.error, text).toMatch(/not a SnekPad file/)
    }
  })

  it('says so when it is given a backup instead of a profile, and the other way round', () => {
    const r = parseProfileFile(backupFileText(defaultConfig()))
    expect(!r.ok && r.error).toBe('This file holds a backup, not a profile.')
    const b = parseBackupFile(profileFileText(profile))
    expect(!b.ok && b.error).toBe('This file holds a profile, not a backup.')
  })

  it('refuses a file made by a newer Studio', () => {
    const o = JSON.parse(profileFileText(profile))
    o.version = FILE_VERSION + 1
    const r = parseProfileFile(JSON.stringify(o))
    expect(!r.ok && r.error).toMatch(/newer SnekPad Studio/)
  })

  it('refuses a file with no profile in it', () => {
    const r = parseProfileFile('{"snekpad":"snekpad-profile","version":1}')
    expect(!r.ok && r.error).toBe('This file has no profile in it.')
    const s = parseProfileFile('{"snekpad":"snekpad-profile","version":1,"profile":"x"}')
    expect(s.ok).toBe(false)
  })

  it('refuses a profile that breaks the rules, and says where', () => {
    const o = JSON.parse(profileFileText(profile))
    o.profile.keys[0].color = 'red'
    const r = parseProfileFile(JSON.stringify(o))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/cannot be used: keys\.0\.color/)
    const o2 = JSON.parse(profileFileText(profile))
    o2.profile.keys.pop()
    expect(parseProfileFile(JSON.stringify(o2)).ok).toBe(false)
  })

  it('refuses a profile whose FN key was changed', () => {
    const o = JSON.parse(profileFileText(profile))
    o.profile.keys[11].action = { type: 'none' }
    const r = parseProfileFile(JSON.stringify(o))
    expect(!r.ok && r.error).toMatch(/key 12 must stay the FN key/)
  })

  it('upgrades an old macro action the same way an old config is', () => {
    const o = JSON.parse(profileFileText(profile))
    o.profile.keys[0].action = { type: 'macro', steps: [['CTRL', 'K'], 'UP'] }
    const r = parseProfileFile(JSON.stringify(o))
    expect(r.ok).toBe(true)
    expect(r.ok && r.profile.keys[0].action.type).toBe('sequence')
  })

  it('names the file after the profile, safely', () => {
    expect(profileFileName(profile)).toBe('snekpad-profile-browser.json')
    expect(profileFileName({ ...profile, name: 'My: App/2?' })).toBe(
      'snekpad-profile-my-app-2.json'
    )
    expect(profileFileName({ ...profile, name: '???' })).toBe('snekpad-profile-profile.json')
  })
})

describe('a backup file', () => {
  const config = (): Config => {
    const c = defaultConfig()
    c.settings.effect = 'rainbow'
    c.settings.sleepMinutes = 7
    c.studioProfiles.push(blankProfile('mine', 'Mine'))
    return c
  }

  it('reads back the whole config: pad profiles, Studio-only profiles and settings', () => {
    const c = config()
    const r = parseBackupFile(backupFileText(c))
    expect(r.ok).toBe(true)
    expect(r.ok && r.config).toEqual(c)
    expect(r.ok && r.config.studioProfiles.map((p) => p.id)).toEqual(['browser', 'mine'])
  })

  it('upgrades a backup made when the pad held four profiles', () => {
    const c = JSON.parse(JSON.stringify(defaultConfig()))
    c.profiles = [...c.profiles, ...c.studioProfiles]
    delete c.studioProfiles
    const text = JSON.stringify({ snekpad: 'snekpad-backup', version: 1, config: c })
    const r = parseBackupFile(text)
    expect(r.ok).toBe(true)
    expect(r.ok && r.config.profiles).toHaveLength(3)
    expect(r.ok && r.config.studioProfiles.map((p) => p.id)).toEqual(['browser'])
  })

  it('refuses a config that breaks the rules', () => {
    const c = defaultConfig()
    c.profiles[0].id = 'other'
    const r = parseBackupFile(backupFileText(c))
    expect(!r.ok && r.error).toMatch(/cannot be used.*first profile must be General/)
  })

  it('refuses a backup with no config in it', () => {
    const r = parseBackupFile('{"snekpad":"snekpad-backup","version":1}')
    expect(r.ok).toBe(false)
  })

  it('names the file with the local date, and a safety copy with the time too', () => {
    const d = new Date(2026, 9, 5, 14, 7) // 5 October 2026, 14:07 local
    expect(backupFileName(d)).toBe('snekpad-backup-2026-10-05.json')
    expect(autoBackupName(d)).toBe('snekpad-backup-2026-10-05-1407.json')
  })
})

describe("Studio's own safety copies", () => {
  let folder: string
  let dir: string
  let configFile: string
  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'snekpad-backup-test-'))
    dir = join(folder, 'backups')
    configFile = join(folder, 'config.json')
    writeFileSync(configFile, JSON.stringify(defaultConfig()))
  })
  afterEach(() => rmSync(folder, { recursive: true, force: true }))

  const T0 = new Date(2026, 9, 5, 10, 0).getTime()
  const files = (): string[] => readdirSync(dir).sort()

  it('keeps a copy of the config before it is overwritten, as a backup file that restores', () => {
    const last = rollingBackup(dir, configFile, 0, T0)
    expect(last).toBe(T0)
    expect(files()).toEqual(['snekpad-backup-2026-10-05-1000.json'])
    const r = parseBackupFile(readFileSync(join(dir, files()[0]), 'utf8'))
    expect(r.ok && r.config).toEqual(defaultConfig())
  })

  it('keeps at most one copy every 30 minutes', () => {
    let last = rollingBackup(dir, configFile, 0, T0)
    last = rollingBackup(dir, configFile, last, T0 + AUTO_BACKUP_EVERY_MS - 1)
    expect(files()).toHaveLength(1)
    last = rollingBackup(dir, configFile, last, T0 + AUTO_BACKUP_EVERY_MS)
    expect(files()).toHaveLength(2)
    expect(last).toBe(T0 + AUTO_BACKUP_EVERY_MS)
  })

  it('keeps the newest ten and removes older ones, and leaves other files alone', () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'notes.txt'), 'mine')
    writeFileSync(join(dir, 'snekpad-backup-2026-01-01.json'), '{}') // a backup the user made by hand
    let last = 0
    for (let i = 0; i < AUTO_BACKUP_KEEP + 4; i++)
      last = rollingBackup(dir, configFile, last, T0 + i * AUTO_BACKUP_EVERY_MS)
    const auto = files().filter((f) => /-\d{4}\.json$/.test(f))
    expect(auto).toHaveLength(AUTO_BACKUP_KEEP)
    expect(auto[0]).toBe(autoBackupName(new Date(T0 + 4 * AUTO_BACKUP_EVERY_MS)))
    expect(files()).toContain('notes.txt')
    expect(files()).toContain('snekpad-backup-2026-01-01.json')
  })

  it('does nothing without a config file, and keeps nothing that is not a config', () => {
    rmSync(configFile)
    expect(rollingBackup(dir, configFile, 0, T0)).toBe(0)
    writeFileSync(configFile, '{"not":"a config"}')
    expect(rollingBackup(dir, configFile, 0, T0)).toBe(0)
    writeFileSync(configFile, 'garbage')
    expect(rollingBackup(dir, configFile, 0, T0)).toBe(0)
    expect(readdirSync(folder)).not.toContain('backups')
  })

  it('never throws, even when it cannot write', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    writeFileSync(join(folder, 'backups'), 'a file where the folder should be')
    expect(() => rollingBackup(dir, configFile, 0, T0)).not.toThrow()
    expect(rollingBackup(dir, configFile, 0, T0)).toBe(0)
    warn.mockRestore()
  })

  it('keeps a config saved by an older Studio in the new format', () => {
    const old = JSON.parse(JSON.stringify(defaultConfig()))
    old.profiles = [...old.profiles, ...old.studioProfiles]
    delete old.studioProfiles
    writeFileSync(configFile, JSON.stringify(old))
    rollingBackup(dir, configFile, 0, T0)
    const r = parseBackupFile(readFileSync(join(dir, files()[0]), 'utf8'))
    expect(r.ok && r.config.studioProfiles.map((p) => p.id)).toEqual(['browser'])
  })
})
