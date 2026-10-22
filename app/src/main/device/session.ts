// DeviceSession: the one place that talks request/reply over a Link.
//
// The pad answers one command at a time, so exactly one exchange may be in flight. Every operation
// (push, pull, LED preview) goes through a FIFO queue, and the reply handler belongs to the
// exchange that is running. Without this, an LED preview sent while a push waits for CFG_END would
// steal that reply.

import {
  ConfigReceiver,
  configFrames,
  crcHex,
  getCfgLine,
  helloLine,
  ledLine,
  liveViewSchema,
  parseEvent,
  parseHello,
  parseReply,
  EVT_PREFIX,
  type HelloInfo,
  type PadEvent,
  type Reply
} from '../../shared/protocol'
import type { PullResult, PushResult } from '../../shared/api'
import {
  FW_CONFIRM_MS,
  FW_SPACE_MARGIN,
  bundleBytes,
  fwAbortLine,
  fwBeginLine,
  fwCommitLine,
  fwDataLines,
  fwFileEndLine,
  fwFileLine,
  fwInfoLine,
  parseFwInfo,
  verifyBundle,
  type FirmwareBundle,
  type FirmwareProgress,
  type FirmwareUpdateResult,
  type FwInfoResult
} from '../../shared/firmwareUpdate'
import type { Link } from './link'

export const REPLY_TIMEOUT_MS = 2000
export const SETTLE_MS = 300 // after a timeout, let a late reply arrive (and be dropped) before the next command
export const SAVE_TIMEOUT_MS = 10000 // the pad checks, test-builds and writes the config to flash before it answers CFG_END

export class DeviceSession {
  private tail: Promise<unknown> = Promise.resolve()
  private handler: ((line: string) => void) | null = null
  private ledQueued = new Map<string, string>() // "layer:key" -> latest colour, not yet sent
  private stale = false // the last exchange timed out, so a late reply may still be on its way
  private longOps = 0 // push / pull in flight or waiting
  private fwOps = 0 // firmware updates queued or running
  private fwCancelled = false

  /** Protocol version the pad announced with HELLO; 1 until (and unless) it does. */
  version = 1
  /** Firmware version the pad announced with HELLO; null if it did not (or has not yet). */
  firmware: string | null = null
  private eventCb: (e: PadEvent) => void = () => {}
  private helloCb: (info: HelloInfo) => void = () => {}

  constructor(private readonly link: Link) {
    link.onLine((line) => this.route(line))
  }

  /** Called for each report the pad sends on its own (profile change, key held / released). */
  onEvent(cb: (e: PadEvent) => void): void {
    this.eventCb = cb
  }

  /** Called when the pad answers HELLO. */
  onHello(cb: (info: HelloInfo) => void): void {
    this.helloCb = cb
  }

  /** Ask the pad to announce itself and start reporting events. Pads without support ignore it. */
  hello(): void {
    this.link.write(helloLine())
  }

  /**
   * One incoming line. The pad's own reports (EVT) and its HELLO answer can arrive at any time,
   * even in the middle of an exchange, so they are peeled off here and never counted as a reply.
   */
  private route(line: string): void {
    if (line.startsWith(EVT_PREFIX)) {
      const e = parseEvent(line)
      if (e) this.eventCb(e)
      return
    }
    const hello = parseHello(line)
    if (hello !== null) {
      this.version = hello.protocol
      this.firmware = hello.firmware
      this.helloCb(hello)
      return
    }
    this.handler?.(line) // lines nobody is waiting for are dropped
  }

  /** True while a push or pull is queued or running. */
  get busy(): boolean {
    return this.longOps > 0
  }

  /** Fire and forget (OS / APP lines). One line per write, so it can never split another message. */
  send(line: string): void {
    this.link.write(line)
  }

  push(json: string): Promise<PushResult> {
    return this.exclusive(async () => {
      const frames = configFrames(json)
      const begin = await this.exchange(frames[0], REPLY_TIMEOUT_MS)
      if (begin.kind !== 'ok') return { ok: false, error: reasonOf(begin) }
      for (const line of frames.slice(1, -1)) this.link.write(line)
      const end = await this.exchange(frames[frames.length - 1], SAVE_TIMEOUT_MS)
      return end.kind === 'ok' ? { ok: true } : { ok: false, error: reasonOf(end) }
    }, true)
  }

  pull(): Promise<PullResult> {
    return this.exclusive(() => this.collect(), true)
  }

  /** True while a firmware update is queued or running: nothing else should be sent to the pad then. */
  get updating(): boolean {
    return this.fwOps > 0
  }

  /** What the pad says about itself and its last update (FW_INFO). A pad without the updater does not answer. */
  firmwareInfo(): Promise<FwInfoResult> {
    return this.exclusive(() => this.readFwInfo(), false)
  }

  /** Stop a running firmware update: the pad throws away what it has staged and nothing changes. */
  cancelFirmwareUpdate(): void {
    if (!this.updating) return
    this.fwCancelled = true
    this.link.write(fwAbortLine())
    this.stale = true // the pad answers FW_ABORT with an OK: let it arrive (and be dropped) before the next command
  }

  /**
   * Send a firmware update (see PROTOCOL.md, "Firmware update"). It only stages the files on the pad and commits
   * them; the pad installs them when it restarts, so on success the pad is about to disconnect. Any failure
   * leaves the pad exactly as it was.
   */
  updateFirmware(
    bundle: FirmwareBundle,
    onProgress: (p: FirmwareProgress) => void = () => {}
  ): Promise<FirmwareUpdateResult> {
    this.fwOps++
    this.fwCancelled = false
    return this.exclusive(() => this.sendFirmware(bundle, onProgress), true).finally(() => {
      this.fwOps--
    })
  }

  /**
   * Live colour preview. Repeated calls for the same key before the first is sent collapse into
   * one (a colour-picker drag is dozens of calls), and previews are dropped during a push or pull,
   * because the pad gets the final colours from that anyway.
   */
  preview(layer: number, key: number, color: string): Promise<void> {
    if (this.busy) return Promise.resolve()
    const id = `${layer}:${key}`
    if (this.ledQueued.has(id)) {
      this.ledQueued.set(id, color)
      return Promise.resolve()
    }
    this.ledQueued.set(id, color)
    return this.exclusive(async () => {
      const c = this.ledQueued.get(id)!
      this.ledQueued.delete(id)
      await this.exchange(ledLine(layer, key, c), REPLY_TIMEOUT_MS)
    }, false)
  }

  // ---- internals ----------------------------------------------------------------------------

  private exclusive<T>(task: () => Promise<T>, long: boolean): Promise<T> {
    if (long) this.longOps++
    const run = this.tail.then(task)
    this.tail = run
      .catch(() => {})
      .finally(() => {
        if (long) this.longOps--
      })
    return run
  }

  /** After a timeout, wait out a possible late reply so it cannot answer the next command. */
  private async settle(): Promise<void> {
    if (!this.stale) return
    this.stale = false
    await new Promise((r) => setTimeout(r, SETTLE_MS))
  }

  /** Write one line and wait for the pad's single-line reply. */
  private async exchange(line: string, timeoutMs: number): Promise<Reply> {
    await this.settle()
    return new Promise((resolve) => {
      const done = (r: Reply): void => {
        clearTimeout(timer)
        this.handler = null
        resolve(r)
      }
      const timer = setTimeout(() => {
        this.stale = true
        done({ kind: 'err', reason: 'no reply from pad' })
      }, timeoutMs)
      this.handler = (l) => done(parseReply(l))
      this.link.write(line)
    })
  }

  private async readFwInfo(): Promise<FwInfoResult> {
    const r = await this.exchange(fwInfoLine(), REPLY_TIMEOUT_MS)
    if (r.kind === 'other') {
      const info = parseFwInfo(r.line)
      if (info) return { ok: true, ...info }
    }
    if (r.kind === 'err' && r.reason === 'no reply from pad')
      return { ok: false, error: 'no reply from pad' }
    return { ok: false, error: r.kind === 'err' ? r.reason : 'unexpected reply' }
  }

  private async sendFirmware(
    bundle: FirmwareBundle,
    onProgress: (p: FirmwareProgress) => void
  ): Promise<FirmwareUpdateResult> {
    const { manifest } = bundle
    const total = bundleBytes(manifest)
    const fail = (error: string, abort = true): FirmwareUpdateResult => {
      if (abort) {
        this.link.write(fwAbortLine()) // the pad throws away what it staged
        this.stale = true // ... and answers OK: let that arrive (and be dropped) before the next command
      }
      return this.fwCancelled
        ? { ok: false, error: 'cancelled', cancelled: true }
        : { ok: false, error }
    }

    const bad = verifyBundle(bundle)
    if (bad) return fail(bad, false)

    onProgress({ phase: 'checking' })
    const info = await this.readFwInfo()
    if (!info.ok)
      return fail(
        info.error === 'no reply from pad'
          ? 'This pad cannot take a firmware update from Studio yet. It needs one flash from the computer first.'
          : info.error,
        false
      )
    if (info.circuitpython !== manifest.circuitpython)
      return fail(
        `This update is for CircuitPython ${manifest.circuitpython}, the pad runs ${info.circuitpython}.`,
        false
      )
    if (info.freeBytes < total * 2 + FW_SPACE_MARGIN)
      return fail('The pad does not have enough free space for the update.', false)
    if (this.fwCancelled) return fail('', false)

    onProgress({ phase: 'waiting' })
    const begin = await this.exchange(fwBeginLine(manifest), FW_CONFIRM_MS + 5000)
    if (this.fwCancelled) return fail('')
    if (begin.kind !== 'ok')
      return fail(reasonOf(begin), begin.kind === 'err' && begin.reason === 'no reply from pad')

    let sent = 0
    for (const f of manifest.files) {
      onProgress({ phase: 'sending', file: f.name, sent, total })
      const opened = await this.exchange(fwFileLine(f), REPLY_TIMEOUT_MS)
      if (this.fwCancelled) return fail('')
      if (opened.kind !== 'ok') return fail(reasonOf(opened))
      const lines = fwDataLines(bundle.data[f.name])
      const chunk = f.size / Math.max(lines.length, 1)
      for (let i = 0; i < lines.length; i++) {
        this.link.write(lines[i])
        if (i % 16 === 15) {
          onProgress({
            phase: 'sending',
            file: f.name,
            sent: Math.round(sent + chunk * (i + 1)),
            total
          })
          await new Promise((r) => setImmediate(r)) // let the progress reach the window and a cancel reach us
          if (this.fwCancelled) return fail('')
        }
      }
      const closed = await this.exchange(fwFileEndLine(), REPLY_TIMEOUT_MS * 2)
      if (this.fwCancelled) return fail('')
      if (closed.kind !== 'ok')
        return fail(
          reasonOf(closed),
          closed.kind === 'err' && closed.reason === 'no reply from pad'
        )
      sent += f.size
    }

    onProgress({ phase: 'finishing' })
    const commit = await this.exchange(fwCommitLine(manifest.version), SAVE_TIMEOUT_MS)
    if (commit.kind !== 'ok') return fail(reasonOf(commit))
    return { ok: true } // the pad restarts now and installs the update
  }

  /** GET_CFG: collect CFG_BEGIN / CFG_LINE... / CFG_END and check length and CRC. */
  private async collect(): Promise<PullResult> {
    await this.settle()
    return new Promise((resolve) => {
      const rx = new ConfigReceiver()
      let length = -1
      let crc = ''
      const finish = (r: PullResult): void => {
        clearTimeout(timer)
        this.handler = null
        resolve(r)
      }
      const timer = setTimeout(() => {
        this.stale = true
        finish({ ok: false, error: 'no reply from pad' })
      }, REPLY_TIMEOUT_MS * 2)
      this.handler = (line) => {
        const [cmd, a, b] = line.trimEnd().split('\t')
        if (cmd === 'ERR') return finish({ ok: false, error: a ?? 'unknown error' })
        if (cmd === 'CFG_BEGIN') {
          length = Number(a)
          crc = b
        }
        if (cmd !== 'CFG_BEGIN' && cmd !== 'CFG_LINE' && cmd !== 'CFG_END') return
        rx.handle(line)
        if (cmd !== 'CFG_END') return
        const json = rx.received
        if (json.length !== length || crcHex(json) !== crc)
          return finish({ ok: false, error: 'pad config was damaged in transit' })
        try {
          const v = liveViewSchema.safeParse(JSON.parse(json))
          finish(
            v.success
              ? { ok: true, view: v.data }
              : { ok: false, error: 'pad config not understood' }
          )
        } catch {
          finish({ ok: false, error: 'pad config not understood' })
        }
      }
      this.link.write(getCfgLine())
    })
  }
}

const reasonOf = (r: Reply): string => (r.kind === 'err' ? r.reason : 'unexpected reply')
