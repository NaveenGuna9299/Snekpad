// Watches which window has focus (Windows) and reports it, so the pad can switch to that program's
// profile. A single long-lived PowerShell prints "process<TAB>title" whenever the focused window
// changes; nothing is stored or sent anywhere except to the pad.

import { spawn, type ChildProcess } from 'child_process'

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -Namespace W -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
'@
$last = ''
while ($true) {
  $h = [W.U]::GetForegroundWindow()
  if ($h -ne [IntPtr]::Zero) {
    $procId = 0
    [void][W.U]::GetWindowThreadProcessId($h, [ref]$procId)
    $sb = New-Object System.Text.StringBuilder 256
    [void][W.U]::GetWindowText($h, $sb, 256)
    $p = (Get-Process -Id $procId).ProcessName
    $line = "$p\`t$($sb.ToString())"
    if ($line -ne $last) { $last = $line; [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
  }
  Start-Sleep -Milliseconds 400
}
`

// our own window must not count as "the app in focus", or opening Studio would switch to General
const SELF = new Set(['electron', 'snekpad-studio'])
const HEARTBEAT_MS = 1500 // the pad drops back to "no helper" after 5 s of silence

export class FocusWatcher {
  private child: ChildProcess | null = null
  private beat: NodeJS.Timeout | null = null
  private current: { proc: string; title: string } | null = null
  private stopped = false

  constructor(private readonly send: (proc: string, title: string) => void) {}

  /** Re-send the current app right away (call this when a pad connects). */
  resend(): void {
    if (this.current) this.send(this.current.proc, this.current.title)
  }

  start(): void {
    if (process.platform !== 'win32') return
    this.stopped = false
    this.spawnShell()
    this.beat = setInterval(() => this.resend(), HEARTBEAT_MS)
  }

  stop(): void {
    this.stopped = true
    if (this.beat) clearInterval(this.beat)
    this.child?.kill()
  }

  private spawnShell(): void {
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true
    })
    this.child = child
    let buf = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => {
      buf += d
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '')
        buf = buf.slice(i + 1)
        const tab = line.indexOf('\t')
        const proc = tab < 0 ? line : line.slice(0, tab)
        const title = tab < 0 ? '' : line.slice(tab + 1)
        if (!proc || SELF.has(proc.toLowerCase())) continue
        this.current = { proc, title }
        this.send(proc, title)
      }
    })
    child.on('exit', () => {
      if (!this.stopped) setTimeout(() => this.spawnShell(), 2000)
    })
  }
}
