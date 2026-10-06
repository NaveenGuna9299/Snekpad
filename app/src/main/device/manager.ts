// DeviceManager: owns the connection to the pad, keeps the connection state, and exposes
// the few things the UI needs (push config, live LED preview, focused-app events).

import { EventEmitter } from 'events'
import { resolveForOs, type Config } from '../../shared/config'
import type { DeviceState, PullResult, PushResult } from '../../shared/api'
import { configFrames, getCfgLine, ConfigReceiver, crcHex, liveViewSchema, ledLine, appLine, osLine, hostOsFrom, parseReply, type Reply } from '../../shared/protocol'
import type { Link } from './link'
import { MockLink } from './mockLink'
import { findPad } from './serialLink'

const SCAN_EVERY_MS = 3000
const REPLY_TIMEOUT_MS = 2000
const SAVE_TIMEOUT_MS = 10000 // the pad checks, test-builds and writes the config to flash before it answers CFG_END

export class DeviceManager extends EventEmitter {
  state: DeviceState = { status: 'disconnected' }
  private link: Link | null = null
  private collector: ((line: string) => void) | null = null
  private waiter: ((r: Reply) => void) | null = null
  private timer: NodeJS.Timeout | null = null
  private scanning = false
  private autoScan = true
  readonly os = hostOsFrom(process.platform) // the computer the pad is plugged into

  start(): void {
    this.scan()
    this.timer = setInterval(() => this.scan(), SCAN_EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.link?.close()
  }

  private setState(s: DeviceState): void {
    this.state = s
    this.emit('state', s)
  }

  private attach(link: Link): void {
    this.link = link
    link.onLine((line) => {
      if (this.collector) return this.collector(line)
      const r = parseReply(line)
      if (this.waiter) {
        const w = this.waiter
        this.waiter = null
        w(r)
      }
    })
    link.onClose((reason) => {
      if (this.link !== link) return
      this.link = null
      this.setState({ status: 'disconnected', error: reason })
    })
    this.setState({ status: 'connected', kind: link.kind, label: link.label })
    link.write(osLine(this.os)) // tell the pad which OS it is plugged into
  }

  /** Look for a real pad (skipped while connected or while the mock is chosen). */
  private async scan(): Promise<void> {
    if (this.link || this.scanning || !this.autoScan) return
    this.scanning = true
    try {
      const link = await findPad()
      if (link) this.attach(link)
    } catch (e) {
      this.setState({ status: 'disconnected', error: (e as Error).message })
    } finally {
      this.scanning = false
    }
  }

  useMock(on: boolean): void {
    this.link?.close()
    this.link = null
    this.autoScan = !on
    if (on) this.attach(new MockLink())
    else {
      this.setState({ status: 'disconnected' })
      void this.scan()
    }
  }

  private request(line: string, timeoutMs = REPLY_TIMEOUT_MS): Promise<Reply> {
    return new Promise((resolve) => {
      if (!this.link) return resolve({ kind: 'err', reason: 'pad not connected' })
      const t = setTimeout(() => {
        this.waiter = null
        resolve({ kind: 'err', reason: 'no reply from pad' })
      }, timeoutMs)
      this.waiter = (r) => {
        clearTimeout(t)
        resolve(r)
      }
      this.link.write(line)
    })
  }

  async push(config: Config): Promise<PushResult> {
    if (!this.link) return { ok: false, error: 'pad not connected' }
    const frames = configFrames(JSON.stringify(resolveForOs(config, this.os)))
    const begin = await this.request(frames[0])
    if (begin.kind !== 'ok') return { ok: false, error: begin.kind === 'err' ? begin.reason : 'unexpected reply' }
    for (const line of frames.slice(1, -1)) this.link.write(line)
    const end = await this.request(frames[frames.length - 1], SAVE_TIMEOUT_MS)
    if (end.kind === 'ok') return { ok: true }
    return { ok: false, error: end.kind === 'err' ? end.reason : 'unexpected reply' }
  }

  /** Read the config that is live on the pad (what its keys, colours and OLED show right now). */
  pull(): Promise<PullResult> {
    return new Promise((resolve) => {
      const link = this.link
      if (!link) return resolve({ ok: false, error: 'pad not connected' })
      const rx = new ConfigReceiver()
      let length = -1
      let crc = ''
      const finish = (r: PullResult): void => {
        clearTimeout(timer)
        this.collector = null
        resolve(r)
      }
      const timer = setTimeout(() => finish({ ok: false, error: 'no reply from pad' }), REPLY_TIMEOUT_MS * 2)
      this.collector = (line) => {
        const [cmd, a, b] = line.trimEnd().split(String.fromCharCode(9))
        if (cmd === 'ERR') return finish({ ok: false, error: a ?? 'unknown error' })
        if (cmd === 'CFG_BEGIN') {
          length = Number(a)
          crc = b
        }
        if (cmd !== 'CFG_BEGIN' && cmd !== 'CFG_LINE' && cmd !== 'CFG_END') return
        rx.handle(line)
        if (cmd !== 'CFG_END') return
        const json = rx.received
        if (json.length !== length || crcHex(json) !== crc) return finish({ ok: false, error: 'pad config was damaged in transit' })
        try {
          const v = liveViewSchema.safeParse(JSON.parse(json))
          finish(v.success ? { ok: true, view: v.data } : { ok: false, error: 'pad config not understood' })
        } catch {
          finish({ ok: false, error: 'pad config not understood' })
        }
      }
      link.write(getCfgLine())
    })
  }

  /** Live colour preview of one key (not saved on the pad). */
  async previewLed(layer: number, key: number, color: string): Promise<void> {
    if (this.link) await this.request(ledLine(layer, key, color))
  }

  /** Tell the pad which app has focus (for automatic profile switching). */
  sendApp(proc: string, title: string): void {
    this.link?.write(appLine(proc, title))
  }
}
