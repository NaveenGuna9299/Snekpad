// Serial protocol between the app and the pad (second USB serial port, "data").
// One message per line, fields separated by TAB. See PROTOCOL.md.
//
//   app -> pad                                   pad -> app
//   PING                                         PONG
//   OS<TAB>windows|macos|linux                   (no reply)
//   APP<TAB>process<TAB>title                    (no reply)
//   LED<TAB>layer<TAB>key<TAB>#RRGGBB            OK | ERR<TAB>reason
//   CFG_BEGIN<TAB>length<TAB>crc32hex            OK | ERR<TAB>reason
//   CFG_LINE<TAB>chunk                           (no reply)
//   CFG_END                                      OK | ERR<TAB>reason
//   GET_CFG                                      CFG_BEGIN, CFG_LINE..., CFG_END (the config now on the pad) | ERR<TAB>reason
//   HELLO                                        HELLO<TAB>version (pads from protocol 2; older pads ignore it)
//   (nothing)                                    EVT<TAB>layer<TAB>n  /  EVT<TAB>key<TAB>n<TAB>0|1  (only after HELLO)

import { z } from 'zod'
import { FN_KEY, KEY_COUNT, LABEL_MAX, MAX_PROFILES, type Config } from './config'

export const CFG_CHUNK = 160 // characters of JSON per CFG_LINE (keeps pad buffers small)

export function crc32(text: string): number {
  const bytes = Buffer.from(text, 'utf8')
  let crc = 0xffffffff
  for (const b of bytes) {
    crc ^= b
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

export const crcHex = (text: string): string => crc32(text).toString(16).padStart(8, '0')

/** ASCII only, no tabs or line breaks: one message is always one line. */
export function clean(text: string, limit: number): string {
  return text
    .replace(/[\t\r\n]/g, ' ')
    .replace(/[^\x20-\x7e]/g, '?')
    .slice(0, limit)
}

export type HostOs = 'windows' | 'macos' | 'linux'

/** Map Node's process.platform to the OS names used on the wire. */
export function hostOsFrom(platform: string): HostOs {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  return 'linux'
}

export const pingLine = (): string => 'PING'
export const osLine = (os: HostOs): string => `OS\t${os}`
export const appLine = (proc: string, title: string): string =>
  `APP\t${clean(proc, 40)}\t${clean(title, 60)}`
export const getCfgLine = (): string => 'GET_CFG'
export const helloLine = (): string => 'HELLO'

/** 1 = the original protocol; 2 adds HELLO and the pad's own EVT lines. */
export const PROTOCOL_VERSION = 2
export const ledLine = (layer: number, key: number, color: string): string =>
  `LED\t${layer}\t${key}\t${color}`

/** All lines needed to send a config (compact JSON, chunked, length + CRC checked). */
export function configFrames(json: string): string[] {
  const lines = [`CFG_BEGIN\t${json.length}\t${crcHex(json)}`]
  for (let i = 0; i < json.length; i += CFG_CHUNK)
    lines.push(`CFG_LINE\t${json.slice(i, i + CFG_CHUNK)}`)
  lines.push('CFG_END')
  return lines
}

export type Reply =
  | { kind: 'pong' }
  | { kind: 'ok' }
  | { kind: 'err'; reason: string }
  | { kind: 'other'; line: string }

export function parseReply(line: string): Reply {
  const l = line.replace(/\r$/, '')
  if (l === 'PONG') return { kind: 'pong' }
  if (l === 'OK') return { kind: 'ok' }
  if (l.startsWith('ERR')) return { kind: 'err', reason: l.split('\t')[1] ?? 'unknown error' }
  return { kind: 'other', line: l }
}

/** Receiving side of CFG_*: used by the mock device and by tests (the firmware does the same in Python). */
export class ConfigReceiver {
  private expected: { length: number; crc: string } | null = null
  private buf = ''

  handle(line: string): string | null {
    const [cmd, a, b] = line.split('\t')
    if (cmd === 'CFG_BEGIN') {
      this.expected = { length: Number(a), crc: b }
      this.buf = ''
      return 'OK'
    }
    if (cmd === 'CFG_LINE') {
      this.buf += line.slice('CFG_LINE\t'.length)
      return null
    }
    if (cmd === 'CFG_END') {
      const e = this.expected
      this.expected = null
      if (!e) return 'ERR\tno CFG_BEGIN'
      if (this.buf.length !== e.length) return 'ERR\tlength mismatch'
      if (crcHex(this.buf) !== e.crc) return 'ERR\tcrc mismatch'
      return 'OK'
    }
    return null
  }

  get received(): string {
    return this.buf
  }
}

// ---- GET_CFG: what the pad shows right now ---------------------------------------------------
// The firmware keeps its keys, colours and OLED text in code, so it can't send back a full config.
// It reports the display side only; the app keeps its own saved actions and lays this over them.

const liveColor = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const liveViewSchema = z.object({
  h: z.literal(32).catch(32), // OLED height
  p: z
    .array(
      z.object({
        n: z.string(), // profile name
        k: z.string(), // knob text on the top bar
        l: z.array(z.string()).length(KEY_COUNT), // key labels
        c: z.array(liveColor).length(KEY_COUNT) // key colours
      })
    )
    .min(1)
})
export type LiveView = z.infer<typeof liveViewSchema>

/** The view a pad would report for this config (used by the mock pad). */
export function liveViewOf(config: Config): LiveView {
  return {
    h: config.device.oled.height,
    p: config.profiles.map((p) => ({
      n: p.name,
      k: p.encoder.label,
      l: p.keys.map((k) => k.label),
      c: p.keys.map((k) => k.color)
    }))
  }
}

/** Lay what the pad shows over the saved config. Profiles are matched by position; actions stay as saved. */
export function applyLiveView(config: Config, view: LiveView): Config {
  return {
    ...config,
    device: { ...config.device, oled: { ...config.device.oled, height: view.h } },
    profiles: config.profiles.map((profile, i) => {
      const live = view.p[i]
      if (!live) return profile
      return {
        ...profile,
        name: live.n.slice(0, 12) || profile.name,
        encoder: { ...profile.encoder, label: live.k.slice(0, 10) },
        keys: profile.keys.map((key, j) =>
          j === FN_KEY
            ? { ...key, color: live.c[j] }
            : { ...key, label: live.l[j].slice(0, LABEL_MAX), color: live.c[j] }
        )
      }
    })
  }
}

// ---- HELLO and EVT: the pad talking first -----------------------------------------------------
// A pad that understands protocol 2 answers HELLO with its version and from then on reports which
// profile is active and which keys are held. An older pad ignores HELLO, so the app just never
// sees events from it and everything else works as before.

export const HELLO_PREFIX = 'HELLO\t'
export const EVT_PREFIX = 'EVT\t'

/** The version in a `HELLO<TAB>n` reply, or null if the line is not one. */
export function parseHello(line: string): number | null {
  if (!line.startsWith(HELLO_PREFIX)) return null
  const n = Number(line.slice(HELLO_PREFIX.length).split('\t')[0])
  return Number.isInteger(n) && n >= 1 ? n : null
}

export type PadEvent =
  | { kind: 'layer'; index: number } // the profile the pad is running changed
  | { kind: 'key'; index: number; down: boolean }

/** Parse an `EVT` line; anything malformed or out of range is dropped (null). */
export function parseEvent(line: string): PadEvent | null {
  if (!line.startsWith(EVT_PREFIX)) return null
  const [, kind, a, b] = line.replace(/\r$/, '').split('\t')
  const index = Number(a)
  if (!Number.isInteger(index) || index < 0) return null
  if (kind === 'layer') return index < MAX_PROFILES ? { kind, index } : null
  if (kind === 'key')
    return index < KEY_COUNT && (b === '0' || b === '1') ? { kind, index, down: b === '1' } : null
  return null
}
