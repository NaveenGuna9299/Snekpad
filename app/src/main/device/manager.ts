// DeviceManager: owns the connection to the pad, keeps the connection state, and exposes
// the few things the UI needs (push config, live LED preview, focused-app events).

import { EventEmitter } from 'events'
import { resolveForOs, type Config } from '../../shared/config'
import type { DeviceState, PullResult, PushResult } from '../../shared/api'
import { appLine, osLine, hostOsFrom } from '../../shared/protocol'
import type { Link } from './link'
import { MockLink } from './mockLink'
import { findPad } from './serialLink'
import { DeviceSession } from './session'

const SCAN_EVERY_MS = 3000
const NOT_CONNECTED = { ok: false, error: 'pad not connected' } as const

export class DeviceManager extends EventEmitter {
  state: DeviceState = { status: 'disconnected' }
  private link: Link | null = null
  private session: DeviceSession | null = null
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
    this.session = new DeviceSession(link)
    link.onClose((reason) => {
      if (this.link !== link) return
      this.link = null
      this.session = null
      this.setState({ status: 'disconnected', error: reason })
    })
    this.setState({ status: 'connected', kind: link.kind, label: link.label })
    this.session.send(osLine(this.os)) // tell the pad which OS it is plugged into
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
    this.session = null
    this.autoScan = !on
    if (on) this.attach(new MockLink())
    else {
      this.setState({ status: 'disconnected' })
      void this.scan()
    }
  }

    async push(config: Config): Promise<PushResult> {
    if (!this.session) return NOT_CONNECTED
    return this.session.push(JSON.stringify(resolveForOs(config, this.os)))
  }

  /** Read the config that is live on the pad (what its keys, colours and OLED show right now). */
  async pull(): Promise<PullResult> {
    return this.session ? this.session.pull() : NOT_CONNECTED
  }

  /** Live colour preview of one key (not saved on the pad). */
  async previewLed(layer: number, key: number, color: string): Promise<void> {
    await this.session?.preview(layer, key, color)
  }

  /** Tell the pad which app has focus (for automatic profile switching). */
  sendApp(proc: string, title: string): void {
    this.session?.send(appLine(proc, title))
  }
}
