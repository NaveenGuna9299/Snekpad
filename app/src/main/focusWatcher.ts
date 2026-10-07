// Watches which window has focus (Windows) and reports it, so the pad can switch to that program's
// profile. It asks Windows directly (user32 / kernel32 through koffi) from this process, so there
// is no helper process to keep alive; nothing is stored or sent anywhere except to the pad.

import { basename, extname } from 'path'
import koffi from 'koffi'

const POLL_MS = 400
const HEARTBEAT_MS = 1500 // the pad drops back to "no helper" after 5 s of silence
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

// our own window must not count as "the app in focus", or opening Studio would switch to General
const SELF = new Set(['electron', 'snekpad-studio', 'snekpad studio'])

type Win32 = {
  GetForegroundWindow: () => unknown
  GetWindowThreadProcessId: (hwnd: unknown, pid: number[]) => number
  GetWindowTextW: (hwnd: unknown, buf: Buffer, max: number) => number
  OpenProcess: (access: number, inherit: boolean, pid: number) => unknown
  QueryFullProcessImageNameW: (h: unknown, flags: number, buf: Buffer, size: number[]) => boolean
  CloseHandle: (h: unknown) => boolean
}

function loadWin32(): Win32 {
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')
  return {
    GetForegroundWindow: user32.func('void *GetForegroundWindow()'),
    GetWindowThreadProcessId: user32.func(
      'uint32 GetWindowThreadProcessId(void *hwnd, _Out_ uint32 *pid)'
    ),
    GetWindowTextW: user32.func('int GetWindowTextW(void *hwnd, _Out_ uint8_t *buf, int max)'),
    OpenProcess: kernel32.func('void *OpenProcess(uint32 access, bool inherit, uint32 pid)'),
    QueryFullProcessImageNameW: kernel32.func(
      'bool QueryFullProcessImageNameW(void *h, uint32 flags, _Out_ uint8_t *buf, _Inout_ uint32 *size)'
    ),
    CloseHandle: kernel32.func('bool CloseHandle(void *h)')
  }
}

export class FocusWatcher {
  private win32: Win32 | null = null
  private poll: NodeJS.Timeout | null = null
  private beat: NodeJS.Timeout | null = null
  private current: { proc: string; title: string } | null = null
  private last = ''

  constructor(private readonly send: (proc: string, title: string) => void) {}

  /** Re-send the current app right away (call this when a pad connects). */
  resend(): void {
    if (this.current) this.send(this.current.proc, this.current.title)
  }

  start(): void {
    if (process.platform !== 'win32' || this.poll) return
    try {
      this.win32 ??= loadWin32()
    } catch (e) {
      console.error('[focus] could not load the Windows API; profile switching is off:', e)
      return
    }
    this.check()
    this.poll = setInterval(() => this.check(), POLL_MS)
    this.beat = setInterval(() => this.resend(), HEARTBEAT_MS)
  }

  stop(): void {
    if (this.poll) clearInterval(this.poll)
    if (this.beat) clearInterval(this.beat)
    this.poll = this.beat = null
  }

  private check(): void {
    try {
      const w = this.win32
      if (!w) return
      const hwnd = w.GetForegroundWindow()
      if (!hwnd) return
      const pidOut = [0]
      w.GetWindowThreadProcessId(hwnd, pidOut)
      const pid = pidOut[0]
      if (!pid || pid === process.pid) return

      const proc = this.processName(w, pid)
      if (!proc || SELF.has(proc.toLowerCase())) return

      const titleBuf = Buffer.alloc(512)
      const n = w.GetWindowTextW(hwnd, titleBuf, 256)
      const title = n > 0 ? titleBuf.toString('utf16le', 0, n * 2) : ''

      const line = `${proc}\t${title}`
      if (line === this.last) return
      this.last = line
      this.current = { proc, title }
      this.send(proc, title)
    } catch (e) {
      console.error('[focus] check failed:', e)
    }
  }

  /** The program's name as the pad's rules know it: file name without the folder or ".exe". */
  private processName(w: Win32, pid: number): string {
    const h = w.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
    if (!h) return ''
    try {
      const buf = Buffer.alloc(1040) // 520 UTF-16 characters
      const size = [520]
      if (!w.QueryFullProcessImageNameW(h, 0, buf, size)) return ''
      const path = buf.toString('utf16le', 0, size[0] * 2)
      return basename(path, extname(path))
    } finally {
      w.CloseHandle(h)
    }
  }
}
