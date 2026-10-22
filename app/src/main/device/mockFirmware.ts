// The mock pad's side of a firmware update: the same rules as Programs/fw_update.py, so the whole update can be
// tried and tested without a pad. It stages files, checks them, waits for a (simulated) knob press, and on
// FW_COMMIT "restarts" as the new firmware, or, to test the safety net, comes back on the old one.

import {
  FW_ALLOWED,
  FW_CONFIRM_MS,
  FW_MAX_FILE,
  FW_MAX_FILES,
  FW_MAX_TOTAL,
  FW_SPACE_MARGIN
} from '../../shared/firmwareUpdate'
import { crc32Bytes } from '../../shared/protocol'

export type MockFirmwareOptions = {
  /** CircuitPython version the pad runs. */
  circuitpython?: string
  /** Free flash the pad reports. */
  freeBytes?: number
  /** 'auto' presses the knob by itself shortly after FW_BEGIN; 'manual' waits for pressKnob(). */
  knob?: 'auto' | 'manual'
  /** How long until the simulated knob press, in 'auto' mode. */
  autoKnobMs?: number
  /** How long the pad waits for the knob press. */
  confirmMs?: number
  /** Why the last update was undone, reported once by FW_INFO. */
  failedReason?: string | null
  /** The next update installs, fails its trial, and the pad comes back on the old firmware. */
  trialFails?: boolean
  /**
   * How the pad restarts after a config push or a firmware update. 'reconnect' closes the connection and the
   * pad comes back as a new one (a replug). 'soft' is what the real pad does: the connection stays open, the pad
   * is silent for a moment while it boots, then answers HELLO again as whatever firmware it now runs.
   */
  reload?: 'reconnect' | 'soft'
}

export type MockRestart = { firmware: string; failedReason: string | null }

type Phase = 'idle' | 'confirm' | 'receiving'

const dotted = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/

export class MockFirmware {
  phase: Phase = 'idle'
  /** The files that would be live on the pad after the last update (name -> bytes). */
  installed: Record<string, Uint8Array> = {}
  /** Files staged by the update in progress. */
  staged = new Map<string, Uint8Array>()
  private plan: { version: string; count: number; total: number } | null = null
  private cur: {
    name: string
    size: number
    crc: number
    parts: Buffer[]
    got: number
    error: string | null
  } | null = null
  private timers: ReturnType<typeof setTimeout>[] = []
  private failed: string | null

  constructor(
    private readonly firmware: () => string,
    private readonly opts: MockFirmwareOptions,
    private readonly io: { reply(text: string): void; restart(next: MockRestart): void }
  ) {
    this.failed = opts.failedReason ?? null
  }

  private get cp(): string {
    return this.opts.circuitpython ?? '10.3.1'
  }
  private get free(): number {
    return this.opts.freeBytes ?? 1_000_000
  }
  private err(reason: string): void {
    this.io.reply(`ERR\t${reason}`)
  }

  handle(line: string): void {
    const p = line.replace(/\r$/, '').split('\t')
    switch (p[0]) {
      case 'FW_INFO':
        this.io.reply(
          `FW_INFO\t${this.firmware()}\t${this.cp}\t${this.free}\t${this.failed ?? '-'}`
        )
        this.failed = null // reported once
        return
      case 'FW_BEGIN':
        return this.begin(p)
      case 'FW_ABORT':
        this.abort()
        return this.io.reply('OK')
    }
    if (this.phase !== 'receiving') {
      if (p[0] !== 'FW_DATA') this.err('no update in progress')
      return
    }
    switch (p[0]) {
      case 'FW_FILE':
        return this.file(p)
      case 'FW_DATA':
        return this.data(p)
      case 'FW_FILE_END':
        return this.fileEnd()
      case 'FW_COMMIT':
        return this.commit(p)
      default:
        return this.err('unknown command')
    }
  }

  /** The user presses the knob on the pad. */
  pressKnob(): void {
    if (this.phase !== 'confirm') return
    this.clearTimers()
    this.phase = 'receiving'
    this.io.reply('OK')
  }

  private begin(p: string[]): void {
    if (this.phase !== 'idle') return this.err('busy')
    const [, version, count, total, cp] = p
    const n = Number(count)
    const t = Number(total)
    if (!version || !dotted.test(version)) return this.err('bad version')
    if (!Number.isInteger(n) || !Number.isInteger(t)) return this.err('bad FW_BEGIN')
    if (n < 1 || n > FW_MAX_FILES || t < 1 || t > FW_MAX_TOTAL) return this.err('update too big')
    if (cp !== this.cp) return this.err(`needs CircuitPython ${cp}, pad has ${this.cp}`)
    if (this.free < t * 2 + FW_SPACE_MARGIN) return this.err('not enough free space')
    this.plan = { version, count: n, total: t }
    this.staged.clear()
    this.phase = 'confirm'
    if ((this.opts.knob ?? 'auto') === 'auto')
      this.timers.push(setTimeout(() => this.pressKnob(), this.opts.autoKnobMs ?? 300))
    this.timers.push(
      setTimeout(() => {
        if (this.phase !== 'confirm') return
        this.err('not confirmed on the pad')
        this.abort()
      }, this.opts.confirmMs ?? FW_CONFIRM_MS)
    )
  }

  private file(p: string[]): void {
    if (this.cur) return this.err('previous file not finished')
    const [, name, size, crc] = p
    const s = Number(size)
    if (!(FW_ALLOWED as readonly string[]).includes(name) || this.staged.has(name))
      return this.err('file not allowed')
    if (!Number.isInteger(s) || s < 1 || s > FW_MAX_FILE) return this.err('bad size')
    this.cur = { name, size: s, crc: parseInt(crc, 16), parts: [], got: 0, error: null }
    this.io.reply('OK')
  }

  private data(p: string[]): void {
    const cur = this.cur
    if (!cur) return
    const bytes = Buffer.from(p[1] ?? '', 'base64')
    if (cur.got + bytes.length > cur.size) cur.error = 'too much data'
    else {
      cur.parts.push(bytes)
      cur.got += bytes.length
    }
  }

  private fileEnd(): void {
    const cur = this.cur
    if (!cur) return this.err('no file')
    this.cur = null
    const data = Buffer.concat(cur.parts)
    let problem = cur.error
    if (!problem && data.length !== cur.size) problem = 'size mismatch'
    if (!problem && crc32Bytes(data) !== cur.crc) problem = 'crc mismatch'
    if (problem) {
      this.abort()
      return this.err(problem)
    }
    this.staged.set(cur.name, new Uint8Array(data))
    this.io.reply('OK')
  }

  private commit(p: string[]): void {
    const plan = this.plan
    if (this.cur || !plan || p[1] !== plan.version) return this.err('not ready')
    const total = [...this.staged.values()].reduce((n, d) => n + d.length, 0)
    if (this.staged.size !== plan.count || total !== plan.total) {
      this.abort()
      return this.err('update incomplete')
    }
    this.io.reply('OK')
    const failsTrial = this.opts.trialFails === true
    if (!failsTrial) for (const [name, data] of this.staged) this.installed[name] = data
    else this.failed = 'new firmware did not start' // the same pad keeps running after a soft restart
    this.phase = 'idle'
    this.io.restart(
      failsTrial
        ? { firmware: this.firmware(), failedReason: 'new firmware did not start' }
        : { firmware: plan.version, failedReason: null }
    )
    this.staged.clear()
  }

  abort(): void {
    this.clearTimers()
    this.cur = null
    this.plan = null
    this.staged.clear()
    this.phase = 'idle'
  }

  private clearTimers(): void {
    this.timers.forEach(clearTimeout)
    this.timers = []
  }
}
