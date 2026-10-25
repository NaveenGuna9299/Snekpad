// Export and import of profiles and backups: the file dialogs and the reading and writing. What a file may hold, and the
// checks on it, are in shared/backup.ts (so they can be tested without a window).

import { BrowserWindow, app, dialog } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  backupFileName,
  backupFileText,
  parseBackupFile,
  parseProfileFile,
  profileFileName,
  profileFileText
} from '../shared/backup'
import { profileSchema, validateConfig, type Config, type Profile } from '../shared/config'
import type { FileResult, ImportBackupResult, ImportProfileResult } from '../shared/api'

const filters = [{ name: 'SnekPad file', extensions: ['json'] }]
const cancelled = { ok: false, error: 'Cancelled.', cancelled: true } as const

async function chooseSave(title: string, name: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow()
  const options = { title, defaultPath: join(app.getPath('documents'), name), filters }
  const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
  return r.canceled || !r.filePath ? null : r.filePath
}

async function chooseOpen(title: string, folder?: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow()
  const options = {
    title,
    defaultPath: folder ?? app.getPath('documents'),
    filters,
    properties: ['openFile' as const]
  }
  const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
}

const readText = (path: string): { ok: true; text: string } | { ok: false; error: string } => {
  try {
    return { ok: true, text: readFileSync(path, 'utf8') }
  } catch (e) {
    return { ok: false, error: `Could not read the file: ${(e as Error).message}` }
  }
}

export async function exportProfile(input: Profile): Promise<FileResult> {
  const p = profileSchema.safeParse(input)
  if (!p.success) return { ok: false, error: 'This profile cannot be saved.' }
  const path = await chooseSave('Export this profile', profileFileName(p.data))
  if (!path) return cancelled
  try {
    writeFileSync(path, profileFileText(p.data), 'utf8')
    return { ok: true, path }
  } catch (e) {
    return { ok: false, error: `Could not write the file: ${(e as Error).message}` }
  }
}

export async function importProfile(): Promise<ImportProfileResult> {
  const path = await chooseOpen('Import a profile')
  if (!path) return cancelled
  const t = readText(path)
  if (!t.ok) return t
  const r = parseProfileFile(t.text)
  return r.ok ? { ok: true, profile: r.profile, file: path } : r
}

export async function exportBackup(input: Config): Promise<FileResult> {
  const v = validateConfig(input)
  if (!v.ok) return { ok: false, error: 'The config cannot be saved: ' + v.errors[0] }
  const path = await chooseSave('Back up all profiles and settings', backupFileName())
  if (!path) return cancelled
  try {
    writeFileSync(path, backupFileText(v.config), 'utf8')
    return { ok: true, path }
  } catch (e) {
    return { ok: false, error: `Could not write the file: ${(e as Error).message}` }
  }
}

/** `folder` is where the dialog opens: Studio's own safety copies. */
export async function importBackup(folder: string): Promise<ImportBackupResult> {
  const path = await chooseOpen('Restore from a backup', folder)
  if (!path) return cancelled
  const t = readText(path)
  if (!t.ok) return t
  const r = parseBackupFile(t.text)
  return r.ok ? { ok: true, config: r.config, file: path } : r
}
