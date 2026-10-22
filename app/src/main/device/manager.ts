// DeviceManager: owns the connection to the pad, keeps the connection state, and exposes
// the few things the UI needs (push config, live LED preview, focused-app events).

import { EventEmitter } from 'events'
import { resolveForOs, type Config } from '../../shared/config'
import type { DeviceState, PullResult, PushResult } from '../../shared/api'
import type {
  FirmwareBundle,
  FirmwareProgress,
  FirmwareUpdateResult,
  FwInfoResult
} from '../../shared/firmwareUpdate'
import { appLine, osLine, hostOsFrom, testLine, type PadEvent } from '../../shared/protocol'
import type { Link } from './link'
import { MockLink, RESTARTING } from './mockLink'
import { findPad } from './serialLink'
import { DeviceSession } from './session'

const SCAN_EVERY_MS = 3000
const MOCK_RESTART_MS = 1500 // how long the mock pad takes to come back after a firmware update
const HELLO_WAIT_MS = 1000 // wait this long for the HELLO answer before asking again
const TEST_EVERY_MS = 1000 // the pad leaves test mode about 3 s after the last TEST line
const HELLO_TRIES = 3 // after this many unanswered HELLOs the pad runs firmware from before protocol 2
const HELLO_RESTART_TRIES = 60 // a pad that restarted (after a push or a firmware update) gets this many seconds to answer
const RESTART_GRACE_MS = 1500 // the pad restarts about half a second after it says OK: greet only after that
const NOT_CONNECTED = { ok: false, error: 'pad not connected' } as const

export class DeviceManager extends EventEmitter {
  state: DeviceState = { status: 'disconnected' }
  private link: Link | null = null
  private session: DeviceSession | null = null
  private timer: NodeJS.Timeout | null = null
  private helloTimer: NodeJS.Timeout | null = null
  private testTimer: NodeJS.Timeout | null = null
  private scanning = false
  private autoScan = true
  readonly os = hostOsFrom(process.platform) // the computer the pad is plugged into

  start(): void {
    this.scan()
    this.timer = setInterval(() => this.scan(), SCAN_EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.clearHelloTimer()
    this.setTestMode(false)
    this.link?.close()
  }

  private setState(s: DeviceState): void {
    this.state = s
    this.emit('state', s)
  }

  private clearHelloTimer(): void {
    if (this.helloTimer) clearTimeout(this.helloTimer)
    this.helloTimer = null
  }

  private attach(link: Link): void {
    this.link = link
    const session = new DeviceSession(link)
    this.session = session
    session.onHello(({ protocol, firmware, dev }) => {
      if (this.session !== session || protocol < 2) return
      this.clearHelloTimer()
      this.setState({
        ...this.state,
        events: true,
        legacy: undefined,
        firmware: firmware ?? undefined,
        dev: dev || undefined
      })
    })
    session.onEvent((e) => this.onPadEvent(session, e))
    link.onClose((reason) => {
      if (this.link !== link) return
      this.clearHelloTimer()
      this.link = null
      this.session = null
      // a pad restarting for a firmware update is not an error
      this.setState({ status: 'disconnected', error: reason === RESTARTING ? undefined : reason })
      if (reason === RESTARTING && link instanceof MockLink) this.restartMock(link)
    })
    this.setState({ status: 'connected', kind: link.kind, label: link.label })
    session.send(osLine(this.os)) // tell the pad which OS it is plugged into
    this.clearHelloTimer()
    this.greet(session, 0)
  }

  /**
   * Say HELLO (a pad that knows protocol 2 then reports its firmware, profile and key presses). The
   * first HELLO can be lost while the port is still settling, so it is repeated; only a pad that
   * stayed silent through all of them is taken to run firmware from before protocol 2.
   */
  private greet(session: DeviceSession, attempt: number, tries = HELLO_TRIES): void {
    if (this.session !== session || this.state.events) return
    if (attempt >= tries) {
      this.helloTimer = null
      // only a pad that never answered since it was plugged in is "from before protocol 2"; one that was
      // restarted on purpose may just be slow, so it stays "not said yet"
      if (tries === HELLO_TRIES) this.setState({ ...this.state, legacy: true })
      return
    }
    session.hello()
    this.helloTimer = setTimeout(() => this.greet(session, attempt + 1, tries), HELLO_WAIT_MS)
  }

  /**
   * The pad restarts itself after saving a config and after installing a firmware update. That is a software
   * restart: the USB port stays open, so nothing disconnects, but the pad has forgotten the greeting and may now
   * run other firmware. So forget what was known about it and greet again until it answers. It restarts about half
   * a second after its OK, and until then the OLD firmware would still answer a greeting, so the first one waits.
   */
  private afterRestart(session: DeviceSession): void {
    if (this.session !== session) return
    this.clearHelloTimer()
    this.setState({
      ...this.state,
      events: undefined,
      firmware: undefined,
      dev: undefined,
      legacy: undefined,
      activeProfile: undefined
    })
    this.helloTimer = setTimeout(
      () => this.greet(session, 0, HELLO_RESTART_TRIES),
      RESTART_GRACE_MS
    )
  }

  private onPadEvent(session: DeviceSession, e: PadEvent): void {
    if (this.session !== session) return // a late line from a pad that is gone
    if (e.kind === 'layer') {
      if (this.state.activeProfile !== e.index)
        this.setState({ ...this.state, activeProfile: e.index })
    } else {
      this.emit('event', e)
    }
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
    this.clearHelloTimer()
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
    const session = this.session
    if (!session) return NOT_CONNECTED
    const r = await session.push(JSON.stringify(resolveForOs(config, this.os)))
    if (r.ok) this.afterRestart(session) // the pad restarts to use the new config
    return r
  }

  /** Read the config that is live on the pad (what its keys, colours and OLED show right now). */
  async pull(): Promise<PullResult> {
    return this.session ? this.session.pull() : NOT_CONNECTED
  }

  /** Live colour preview of one key (not saved on the pad). */
  async previewLed(layer: number, key: number, color: string): Promise<void> {
    await this.session?.preview(layer, key, color)
  }

  /**
   * Key test: while on, send TEST every second so the pad reports keys without typing them. It is only a
   * heartbeat, so if this app closes or crashes the pad gets its keys back by itself within seconds.
   * Pads without support ignore the line.
   */
  setTestMode(on: boolean): void {
    if (!__DEV_TOOLS__) return // development tools only: compiled out of the production build
    if (this.testTimer) clearInterval(this.testTimer)
    this.testTimer = null
    if (!on) return
    this.session?.send(testLine())
    this.testTimer = setInterval(() => this.session?.send(testLine()), TEST_EVERY_MS)
  }

  /** Tell the pad which app has focus (for automatic profile switching). Paused during a firmware update. */
  sendApp(proc: string, title: string): void {
    if (this.session?.updating) return
    this.session?.send(appLine(proc, title))
  }

  /** What the pad says about itself and its last firmware update (FW_INFO). */
  async firmwareInfo(): Promise<FwInfoResult> {
    return this.session ? this.session.firmwareInfo() : NOT_CONNECTED
  }

  /** Send a firmware update to the pad. On success the pad is about to restart and disconnect. */
  async updateFirmware(
    bundle: FirmwareBundle,
    onProgress: (p: FirmwareProgress) => void
  ): Promise<FirmwareUpdateResult> {
    const session = this.session
    if (!session) return NOT_CONNECTED
    const r = await session.updateFirmware(bundle, onProgress)
    if (r.ok) this.afterRestart(session) // the pad restarts to install it, possibly without disconnecting
    return r
  }

  cancelFirmwareUpdate(): void {
    this.session?.cancelFirmwareUpdate()
  }

  /** The mock pad comes back after its firmware update restart, running whatever it installed. */
  private restartMock(old: MockLink): void {
    setTimeout(() => {
      if (!this.link && !this.autoScan) this.attach(old.reborn())
    }, MOCK_RESTART_MS)
  }
}
