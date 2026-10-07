// DeviceSession: the one place that talks request/reply over a Link.
//
// The pad answers one command at a time, so exactly one exchange may be in flight. Every operation
// (push, pull, LED preview) goes through a FIFO queue, and the reply handler belongs to the
// exchange that is running. Without this, an LED preview sent while a push waits for CFG_END would
// steal that reply.

import { ConfigReceiver, configFrames, crcHex, getCfgLine, ledLine, liveViewSchema, parseReply, type Reply } from '../../shared/protocol'
import type { PullResult, PushResult } from '../../shared/api'
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

  constructor(private readonly link: Link) {
    link.onLine((line) => this.handler?.(line)) // lines nobody is waiting for are dropped
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
        if (json.length !== length || crcHex(json) !== crc) return finish({ ok: false, error: 'pad config was damaged in transit' })
        try {
          const v = liveViewSchema.safeParse(JSON.parse(json))
          finish(v.success ? { ok: true, view: v.data } : { ok: false, error: 'pad config not understood' })
        } catch {
          finish({ ok: false, error: 'pad config not understood' })
        }
      }
      this.link.write(getCfgLine())
    })
  }
}

const reasonOf = (r: Reply): string => (r.kind === 'err' ? r.reason : 'unexpected reply')
