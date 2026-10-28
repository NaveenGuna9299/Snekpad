// DeviceManager: owns the connection to the pad, keeps the connection state, and exposes
// the few things the UI needs (push config, live LED preview, focused-app events).

import { EventEmitter } from 'events'
import {
  bestMatch,
  resolveForOs,
  resolveProfileForOs,
  type Config,
  type Profile
} from '../../shared/config'
import { hasSlot } from '../../shared/firmware'
import type { DeviceState, PullResult, PushResult } from '../../shared/api'
import type {
  FirmwareBundle,
  FirmwareProgress,
  FirmwareUpdateResult,
  FwInfoResult
} from '../../shared/firmwareUpdate'
import {
  appLine,
  musicLine,
  osLine,
  hostOsFrom,
  slotFrames,
  testLine,
  type PadEvent
} from '../../shared/protocol'
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
const SLOT_RETRY_MS = 10000 // after the pad refused a Studio profile, wait this long before trying again
const PREVIEW_MS = 15000 // how long "Try on pad" keeps a profile on the pad
const PREVIEW_PROC = 'snekpad-preview' // the "program" the pad is told about while it shows a profile for "Try on pad"
const NOT_CONNECTED = { ok: false, error: 'pad not connected' } as const

/** What the pad's slot holds of a profile: everything it shows or does, but not which apps it belongs to. */
const fingerprint = (p: Profile): string => JSON.stringify([p.name, p.keys, p.encoder, p.layers])

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
  // The Studio slot: the profiles Studio keeps itself, and what the pad's slot holds right now. The pad forgets the slot
  // whenever it restarts or reconnects, so `slotHeld` is cleared then and the profile is sent again.
  private padProfiles: Profile[] = []
  private studioProfiles: Profile[] = []
  private slotHeld: string | null = null // fingerprint of the profile on the pad's slot (null = none known)
  private slotBusy = false // a slot is being sent: the focus lines go out without it meanwhile
  private slotRetryAt = 0 // after a failure, wait a little before sending it again
  private slotRefused: string | null = null // fingerprint of a profile the pad said is too big for it
  private lastFocus: { proc: string; title: string } | null = null
  private preview: { id: string; profile: Profile; until: number } | null = null // "Try on pad" shows this until then

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
    this.slotHeld = null
    this.slotBusy = false
    this.slotRefused = null
    this.preview = null
    link.onClose((reason) => {
      if (this.link !== link) return
      this.clearHelloTimer()
      this.link = null
      this.session = null
      this.slotHeld = null
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
    this.slotHeld = null // the slot is RAM: a restarted pad has none
    this.slotRefused = null // and its RAM is free again
    this.setState({
      ...this.state,
      events: undefined,
      firmware: undefined,
      dev: undefined,
      legacy: undefined,
      activeProfile: undefined,
      activeSub: undefined,
      slot: undefined,
      slotError: undefined
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
    } else if (e.kind === 'sub') {
      if ((this.state.activeSub ?? 0) !== e.index) this.setState({ ...this.state, activeSub: e.index })
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

  /** The profiles Studio can put on the pad: called when the saved config loads and whenever it changes. */
  setConfig(config: Config): void {
    this.padProfiles = config.profiles
    this.studioProfiles = config.studioProfiles
    // a profile that was edited is sent again the next time its app is in focus (the fingerprint differs)
    if (
      this.slotHeld !== null &&
      !this.studioProfiles.some((p) => fingerprint(p) === this.slotHeld)
    )
      this.slotHeld = null
    // a profile the pad found too big was edited (or deleted): it gets another try, and the warning goes
    if (
      this.slotRefused !== null &&
      !this.studioProfiles.some((p) => fingerprint(p) === this.slotRefused)
    ) {
      this.slotRefused = null
      if (this.state.slotError) this.setState({ ...this.state, slotError: undefined })
    }
  }

  async push(config: Config): Promise<PushResult> {
    const session = this.session
    if (!session) return NOT_CONNECTED
    // the pad only gets its own profiles; the Studio-only ones stay here
    const forPad = { ...resolveForOs(config, this.os), studioProfiles: undefined }
    const r = await session.push(JSON.stringify(forPad))
    if (r.ok) this.afterRestart(session) // the pad restarts to use the new config
    return r
  }

  /** Read the config that is live on the pad (what its keys, colours and OLED show right now). */
  async pull(): Promise<PullResult> {
    if (!this.session) return NOT_CONNECTED
    const r = await this.session.pull()
    // a pad short of RAM drops the Studio profile to read its config: send it again the next time its app is in focus
    this.slotHeld = null
    return r
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

  /**
   * Tell the pad which app has focus (for automatic profile switching). Paused during a firmware update.
   * The pad's own profiles come first (it matches those itself). If the app has none there but has a Studio-only profile,
   * that profile goes onto the pad's slot (only when it is not there already) and the line says to use the slot.
   */
  sendApp(proc: string, title: string): void {
    const session = this.session
    if (!session || session.updating) return
    this.lastFocus = { proc, title }
    // "Try on pad" holds a profile on the pad for a few seconds, whatever app is in focus
    const profile = this.activePreview() ?? this.studioProfileFor(proc, title)
    if (!profile || !hasSlot(this.state)) return session.send(appLine(proc, title))

    const held = fingerprint(profile)
    if (this.slotHeld === held) {
      session.send(appLine(proc, title, true))
      if (this.state.slot !== profile.id) this.setState({ ...this.state, slot: profile.id })
      return
    }
    // Being sent, or refused (this very profile was too big: it is tried again when it changes, or the pad restarts) or just
    // failed (tried again after a pause): until the profile is there the pad matches by itself (General).
    if (this.slotBusy || this.slotRefused === held || Date.now() < this.slotRetryAt)
      return session.send(appLine(proc, title))
    void this.loadSlot(session, profile, held).then((r) => {
      if (!r.ok) return
      const f = this.lastFocus // the app in focus now, which may no longer be the one that asked for this profile
      if (f) this.sendApp(f.proc, f.title)
    })
    session.send(appLine(proc, title))
  }

  /** Put a Studio-only profile on the pad's slot and keep track of what the pad says about it. */
  private async loadSlot(
    session: DeviceSession,
    profile: Profile,
    held: string
  ): Promise<PushResult> {
    this.slotBusy = true
    const r = await session.loadSlot(slotFrames(resolveProfileForOs(profile, this.os)))
    this.slotBusy = false
    if (this.session !== session) return NOT_CONNECTED // the pad went away meanwhile
    if (r.ok) {
      this.slotHeld = held
      this.setState({ ...this.state, slot: profile.id, slotError: undefined })
      return r
    }
    this.slotHeld = null
    // not enough RAM for its macros: the same profile would fail again, so wait until it is changed
    const tooBig = /too big|memory/i.test(r.error)
    if (tooBig) this.slotRefused = held
    else this.slotRetryAt = Date.now() + SLOT_RETRY_MS
    this.setState({
      ...this.state,
      slot: undefined,
      slotError: { id: profile.id, reason: tooBig ? 'too big' : r.error }
    })
    console.warn('[slot] the pad refused the profile:', r.error)
    return r
  }

  /**
   * "Try on pad": show a Studio-only profile on the pad for a few seconds without its app being in focus, to look at its
   * keys, colours and screen. Studio goes on sending the profile (also when it is edited) until the time is up.
   */
  async tryProfile(profile: Profile): Promise<PushResult> {
    const session = this.session
    if (!session) return NOT_CONNECTED
    if (session.updating) return { ok: false, error: 'A firmware update is running.' }
    if (!hasSlot(this.state))
      return { ok: false, error: 'This pad needs firmware 0.5.0 or newer for Studio profiles.' }
    const held = fingerprint(profile)
    if (this.slotHeld !== held) {
      const r = await this.loadSlot(session, profile, held)
      if (!r.ok)
        return /too big|memory/i.test(r.error)
          ? { ok: false, error: 'It is too big for the pad: use fewer or shorter macros.' }
          : r
    }
    this.preview = { id: profile.id, profile, until: Date.now() + PREVIEW_MS }
    session.send(appLine(PREVIEW_PROC, 'Try on pad', true))
    return { ok: true }
  }

  /** The Studio-only profile that "Try on pad" is showing, while its time lasts. */
  private activePreview(): Profile | null {
    const p = this.preview
    if (!p) return null
    if (Date.now() >= p.until) {
      this.preview = null
      return null
    }
    // the saved copy when there is one (so an edit shows up at once), else the one that was sent
    return this.studioProfiles.find((x) => x.id === p.id) ?? p.profile
  }

  private studioProfileFor(proc: string, title: string): Profile | null {
    if (this.studioProfiles.length === 0) return null
    // The pad's own profiles are matched by the pad. A Studio-only profile takes the app only when it fits better (a title
    // word beats a program, both beat either), so with equal fit the pad's own profile wins.
    const own = bestMatch(this.padProfiles, proc, title)
    const studio = bestMatch(this.studioProfiles, proc, title)
    return studio.index >= 0 && studio.score > own.score ? this.studioProfiles[studio.index] : null
  }

  /** The music levels for the pad's Equalizer and Beat pulse effects. Dropped during a firmware update. */
  sendMusic(bands: readonly number[], beat: number): void {
    if (this.session?.updating) return
    this.session?.send(musicLine(bands, beat))
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
