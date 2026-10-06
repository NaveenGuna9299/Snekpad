// Running programs and their icons (Windows). The icon is the program's own icon, read from its
// .exe on this computer: nothing is downloaded. Icons of programs the user picked are saved in
// the user data folder so they still show when the program is closed.

import { app } from 'electron'
import { execFile } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import type { RunningProgram } from '../shared/api'

// windows that are not "programs" a user would want a profile for
const IGNORE = new Set([
  'electron', 'snekpad-studio', 'applicationframehost', 'textinputhost', 'systemsettings',
  'searchhost', 'startmenuexperiencehost', 'shellexperiencehost', 'lockapp', 'widgets', 'explorer'
])

const lastPaths = new Map<string, string>() // process name -> .exe path, from the latest listing
let saved: Record<string, string> | null = null

const iconFile = (): string => {
  const d = join(app.getPath('userData'), 'snekpad')
  mkdirSync(d, { recursive: true })
  return join(d, 'program-icons.json')
}

function loadSaved(): Record<string, string> {
  if (saved) return saved
  try {
    saved = existsSync(iconFile()) ? JSON.parse(readFileSync(iconFile(), 'utf8')) : {}
  } catch {
    saved = {}
  }
  return saved!
}

function powershell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    )
  })
}

async function iconOf(path: string): Promise<string | null> {
  try {
    const img = await app.getFileIcon(path, { size: 'large' })
    return img.isEmpty() ? null : img.toDataURL()
  } catch {
    return null
  }
}

/** Programs that currently have a window, with their icons. Windows only for now. */
export async function listRunning(): Promise<RunningProgram[]> {
  if (process.platform !== 'win32') return []
  const out = await powershell(
    'Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path } | ' +
      'Select-Object ProcessName,Path,MainWindowTitle | ConvertTo-Json -Compress'
  )
  if (!out.trim()) return []
  const raw = JSON.parse(out) as { ProcessName: string; Path: string; MainWindowTitle: string }[] | { ProcessName: string; Path: string; MainWindowTitle: string }
  const rows = Array.isArray(raw) ? raw : [raw]

  const seen = new Set<string>()
  const result: RunningProgram[] = []
  for (const r of rows) {
    const proc = r.ProcessName.toLowerCase()
    if (IGNORE.has(proc) || seen.has(proc)) continue
    seen.add(proc)
    lastPaths.set(proc, r.Path)
    result.push({ proc, title: r.MainWindowTitle, icon: await iconOf(r.Path) })
  }
  return result.sort((a, b) => a.proc.localeCompare(b.proc))
}

/** Save the icon of a program the user picked, so chips keep showing it later. */
export async function rememberProgram(proc: string): Promise<void> {
  const path = lastPaths.get(proc.toLowerCase())
  if (!path) return
  const icon = await iconOf(path)
  if (!icon) return
  const s = loadSaved()
  s[proc.toLowerCase()] = icon
  writeFileSync(iconFile(), JSON.stringify(s), 'utf8')
}

export function programIcon(proc: string): string | null {
  return loadSaved()[proc.toLowerCase()] ?? null
}
