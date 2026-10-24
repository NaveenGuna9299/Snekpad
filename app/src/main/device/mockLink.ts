// A fake pad so the whole app works without hardware (and for tests).
// It answers the protocol the way the firmware does.

import { OTA_FIRMWARE, REQUIRED_FIRMWARE, SLOT_FIRMWARE } from '../../shared/firmware'
import { isNewer } from '../../shared/update'
import { ConfigReceiver, configFrames, liveViewOf, PROTOCOL_VERSION } from '../../shared/protocol'
import type { Link } from './link'
import { MockFirmware, type MockFirmwareOptions, type MockRestart } from './mockFirmware'

/** How long a mock pad is silent while it restarts (soft restart). */
export const MOCK_BOOT_MS = 1500

/** The reason a mock pad gives when it closes because a firmware update restarted it. */
export const RESTARTING = 'restarting'

export class MockLink implements Link {
  readonly kind = 'mock' as const
  readonly label = 'Mock pad'
  readonly log: string[] = [] // every line the app sent, for tests and debugging
  config = ''

  private lineCb: (line: string) => void = () => {}
  private closeCb: (reason?: string) => void = () => {}
  private rx = new ConfigReceiver()
  /** The firmware the pad runs now: changes when a firmware update was installed by a soft restart. */
  private current: string | null
  /** True while the pad is restarting: it answers nothing. */
  private booting = false
  /** The pad's firmware update receiver; absent on a pad too old to have one (it ignores FW_ lines). */
  readonly fw: MockFirmware | null
  /** Set when a firmware update was committed: how the pad comes back after its restart. */
  restartAs: MockRestart | null = null
  /** The profile on the pad's Studio slot (firmware 0.5.0 and later); null until Studio sends one, and after a restart. */
  slot: { name: string; knob: string; keys: Record<number, string> } | null = null
  private slotRx: { name: string; knob: string; keys: Record<number, string> } | null = null

  /**
   * firmware: what the fake pad reports in HELLO; null = a pad from before versions were reported.
   * dev: the fake pad is a development flash (has the key test tools), like flash_pad.ps1 -Dev.
   */
  constructor(
    firmware: string | null = REQUIRED_FIRMWARE,
    private readonly dev = true,
    private readonly fwOptions: MockFirmwareOptions = {}
  ) {
    this.current = firmware
    const canUpdate = firmware !== null && !isNewer(OTA_FIRMWARE, firmware)
    this.fw = canUpdate
      ? new MockFirmware(() => this.current ?? firmware, fwOptions, {
          reply: (text) => setTimeout(() => this.lineCb(text), 5),
          restart: (next) => {
            this.restartAs = next
            if (fwOptions.reload === 'soft') this.softRestart(next.firmware)
            else setTimeout(() => this.closeCb(RESTARTING), 20)
          }
        })
      : null
  }

  /** A restart that keeps the connection open, like the real pad's: silent for a moment, then it is `firmware`. */
  private softRestart(firmware: string | null): void {
    setTimeout(() => {
      this.current = firmware
      this.slot = null // the slot is RAM: a restart forgets it
      this.slotRx = null
      this.booting = true
      setTimeout(() => (this.booting = false), MOCK_BOOT_MS)
    }, 20)
  }

  /** The user presses the knob on the pad (answers the firmware update prompt). */
  pressKnob(): void {
    this.fw?.pressKnob()
  }

  /** The same pad after a restart: the firmware it now runs, its config, its options. */
  reborn(): MockLink {
    const next = new MockLink(this.restartAs?.firmware ?? this.current, this.dev, {
      ...this.fwOptions,
      failedReason: this.restartAs?.failedReason ?? null,
      trialFails: false
    })
    next.config = this.config
    if (this.fw && !this.restartAs?.failedReason)
      Object.assign(next.fw?.installed ?? {}, this.fw.installed)
    return next
  }

  write(line: string): void {
    this.log.push(line)
    if (this.booting) return // restarting: nothing answers
    const cmd = line.split('\t')[0]
    let reply: string | null = null
    if (cmd === 'GET_CFG') {
      const frames = this.config
        ? configFrames(JSON.stringify(liveViewOf(JSON.parse(this.config))))
        : ['ERR\tno config on pad']
      frames.forEach((f, i) => setTimeout(() => this.lineCb(f), 5 + i))
      return
    }
    if (cmd === 'PING') reply = 'PONG'
    else if (cmd === 'HELLO')
      reply = `HELLO\t${PROTOCOL_VERSION}${this.current ? `\t${this.current}${this.dev ? '\tdev' : ''}` : ''}`
    else if (cmd === 'LED') reply = 'OK'
    else if (cmd.startsWith('FW_')) this.fw?.handle(line)
    else if (cmd.startsWith('SLOT_')) reply = this.slotCommand(line)
    else if (cmd.startsWith('CFG_')) {
      reply = this.rx.handle(line)
      if (cmd === 'CFG_END' && reply === 'OK') {
        this.config = this.rx.received
        if (this.fwOptions.reload === 'soft') this.softRestart(this.current) // the pad restarts to use it
      }
    }
    if (reply) setTimeout(() => this.lineCb(reply), 5)
  }

  /** The pad's side of SLOT_*: the same rules as Programs/app_profiles.py (`_slot_cmd`). A pad before 0.5.0 stays silent. */
  private slotCommand(line: string): string | null {
    if (!this.current || isNewer(SLOT_FIRMWARE, this.current)) return null
    const p = line.replace(/\r$/, '').split('\t')
    if (p[0] === 'SLOT_BEGIN') {
      this.slot = null // the old profile is let go before the new one is built
      this.slotRx = {
        name: (p[1] ?? '').slice(0, 12) || 'Studio',
        knob: (p[2] ?? '').slice(0, 10),
        keys: {}
      }
      return 'OK'
    }
    const rx = this.slotRx
    if (!rx) return 'ERR\tno SLOT_BEGIN'
    if (p[0] === 'SLOT_KEY') {
      const n = Number(p[1])
      if (!Number.isInteger(n) || n < 0 || n > 14 || p.length < 5) {
        this.slotRx = null
        return 'ERR\tbad key number'
      }
      rx.keys[n] = p.slice(4).join('\t')
      return 'OK'
    }
    if (p[0] === 'SLOT_STEP') {
      const n = Number(p[1])
      if (!Number.isInteger(n) || !rx.keys[n]?.includes('"sequence"') || p.length < 4) {
        this.slotRx = null
        return 'ERR\tno sequence'
      }
      rx.keys[n] += `\n${p[2]}\t${p[3]}` // the key's action, then its steps
      return 'OK'
    }
    if (p[0] === 'SLOT_END') {
      this.slotRx = null
      if (Object.keys(rx.keys).length !== 15) return 'ERR\tprofile incomplete'
      this.slot = rx
      return 'OK'
    }
    this.slotRx = null
    return 'ERR\tunknown command'
  }

  /** Pretend the pad sent this line on its own (for tests and the mock pad). */
  emit(line: string): void {
    this.lineCb(line)
  }

  onLine(cb: (line: string) => void): void {
    this.lineCb = cb
  }

  onClose(cb: (reason?: string) => void): void {
    this.closeCb = cb
  }

  close(): void {
    this.closeCb()
  }
}
