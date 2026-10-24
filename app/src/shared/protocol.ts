// Serial protocol between the app and the pad (second USB serial port, "data").
// One message per line, fields separated by TAB. See PROTOCOL.md.
//
//   app -> pad                                   pad -> app
//   PING                                         PONG
//   OS<TAB>windows|macos|linux                   (no reply)
//   APP<TAB>process<TAB>title[<TAB>S]            (no reply; S = use the Studio slot)
//   SLOT_BEGIN<TAB>name<TAB>knob                 OK | ERR<TAB>reason   (the Studio slot: SLOT_KEY x 15, then SLOT_END)
//   LED<TAB>layer<TAB>key<TAB>#RRGGBB            OK | ERR<TAB>reason
//   CFG_BEGIN<TAB>length<TAB>crc32hex            OK | ERR<TAB>reason
//   CFG_LINE<TAB>chunk                           (no reply)
//   CFG_END                                      OK | ERR<TAB>reason
//   GET_CFG                                      CFG_BEGIN, CFG_LINE..., CFG_END (the config now on the pad) | ERR<TAB>reason
//   TEST                                         (no reply; key test: the pad types nothing for ~3 s, send it every second)
//   HELLO                                        HELLO<TAB>protocol<TAB>firmware (pads from protocol 2; older pads ignore it)
//   (nothing)                                    EVT<TAB>layer<TAB>n  /  EVT<TAB>key<TAB>n<TAB>0|1  (only after HELLO)

import { z } from 'zod'
import {
  FN_KEY,
  KEY_COUNT,
  LABEL_MAX,
  MAX_PROFILES,
  MAX_SLEEP_MINUTES,
  EFFECTS,
  type EffectId,
  type Config,
  type Profile
} from './config'
import { isFirmwareVersion } from './firmware'

export const CFG_CHUNK = 160 // characters of JSON per CFG_LINE (keeps pad buffers small)

export function crc32(text: string): number {
  return crc32Bytes(Buffer.from(text, 'utf8'))
}

/** CRC-32 (zlib) of raw bytes: what the pad checks every file of a firmware update against. */
export function crc32Bytes(bytes: Uint8Array): number {
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
export const appLine = (proc: string, title: string, slot = false): string =>
  `APP\t${clean(proc, 40)}\t${clean(title, 60)}${slot ? '\tS' : ''}`

/**
 * The lines that put a profile on the pad's Studio slot (firmware 0.5.0 and later): SLOT_BEGIN, SLOT_KEY x 15 (12 keys, then
 * the knob turned right, turned left and pressed; a sequence is followed by its SLOT_STEP lines), SLOT_END. The pad answers each with OK or ERR, so they go one at a time.
 * Text is cleaned to what the pad can show; the action is the same JSON a config holds.
 */
export function slotFrames(profile: Profile): string[] {
  const lines = [`SLOT_BEGIN\t${clean(profile.name, 12)}\t${clean(profile.encoder.label, 10)}`]
  profile.keys.forEach((k, i) => {
    const a = k.action
    // A sequence goes as the key line without its steps, then one SLOT_STEP per step: the pad has no RAM to parse all of
    // them as one block of JSON (it fails for a long sequence), and a step at a time costs nothing.
    const action = a.type === 'sequence' ? '{"type":"sequence"}' : JSON.stringify(a)
    lines.push(`SLOT_KEY\t${i}\t${clean(k.label, LABEL_MAX)}\t${k.color}\t${action}`)
    if (a.type === 'sequence')
      for (const s of a.steps) lines.push(`SLOT_STEP\t${i}\t${s.keys.join('+')}\t${s.wait}`)
  })
  const { cw, ccw, press } = profile.encoder
  ;[cw, ccw, press].forEach((a, i) =>
    lines.push(`SLOT_KEY\t${KEY_COUNT + i}\t\t#000000\t${JSON.stringify(a)}`)
  )
  lines.push('SLOT_END')
  return lines
}
export const getCfgLine = (): string => 'GET_CFG'
export const helloLine = (): string => 'HELLO'
/**
 * The levels the pad's music effects follow: `M` and five characters, each 48 + a number 0 to 63 (four bands from bass to
 * treble, then the strength of a beat just heard, 0 = none). No tabs and no digits as text: the pad reads the bytes
 * straight off the line, because this goes out about 25 times a second. No reply.
 */
export const musicLine = (bands: readonly number[], beat: number): string => {
  const ch = (n: number): string =>
    String.fromCharCode(48 + Math.max(0, Math.min(63, Math.round(n) || 0)))
  return 'M' + [0, 1, 2, 3].map((i) => ch(bands[i] ?? 0)).join('') + ch(beat)
}

/** Key test heartbeat: for about 3 s after each one the pad reports keys but types nothing. No reply. */
export const testLine = (): string => 'TEST'

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
  // minutes of idle time before the screen and key LEDs switch off (0 = never). Pads from before this
  // setting leave it out, and a value that makes no sense is ignored rather than failing the whole view.
  s: z.number().int().min(0).max(MAX_SLEEP_MINUTES).optional().catch(undefined),
  // the key LED effect the pad runs. Pads from before effects leave it out, and a name this app does not know
  // (a newer firmware) is ignored rather than failing the whole view.
  e: z
    .enum(EFFECTS.map((x) => x.id) as [EffectId, ...EffectId[]])
    .optional()
    .catch(undefined),
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
    s: config.settings.sleepMinutes,
    e: config.settings.effect,
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
    settings: {
      ...config.settings,
      ...(view.s === undefined ? {} : { sleepMinutes: view.s }),
      ...(view.e === undefined ? {} : { effect: view.e })
    },
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

/**
 * What a pad says about itself in its HELLO reply. `firmware` is null when the pad does not send one;
 * `dev` is true for a pad flashed with the development tools (flash_pad.ps1 -Dev), which a customer pad never is.
 */
export type HelloInfo = { protocol: number; firmware: string | null; dev: boolean }

/**
 * Parse `HELLO<TAB>protocol[<TAB>firmware]`, or null if the line is not a HELLO reply. The firmware
 * field came later than the protocol number, so pads without it are still understood, and a firmware
 * field that is not `x.y.z` is ignored rather than trusted.
 */
export function parseHello(line: string): HelloInfo | null {
  if (!line.startsWith(HELLO_PREFIX)) return null
  const [protocol, firmware, flag] = line.replace(/\r$/, '').slice(HELLO_PREFIX.length).split('\t')
  const n = Number(protocol)
  if (!Number.isInteger(n) || n < 1) return null
  return {
    protocol: n,
    firmware: firmware && isFirmwareVersion(firmware) ? firmware : null,
    dev: flag === 'dev'
  }
}

export type PadEvent =
  | { kind: 'layer'; index: number } // the profile the pad is running changed
  | { kind: 'key'; index: number; down: boolean }
  | { kind: 'knob'; action: KnobAction } // the knob was turned right / left or pressed

/** What the knob did: turned right (clockwise), turned left, or pressed. */
export type KnobAction = 'cw' | 'ccw' | 'press'
const KNOB_ACTIONS: readonly string[] = ['cw', 'ccw', 'press']

/** The events that come from the pad's own controls (not the profile change); sent on to the screen. */
export type PadInput = Exclude<PadEvent, { kind: 'layer' }>

/** Parse an `EVT` line; anything malformed or out of range is dropped (null). */
export function parseEvent(line: string): PadEvent | null {
  if (!line.startsWith(EVT_PREFIX)) return null
  const [, kind, a, b] = line.replace(/\r$/, '').split('\t')
  if (kind === 'knob') return KNOB_ACTIONS.includes(a) ? { kind, action: a as KnobAction } : null
  const index = Number(a)
  if (!Number.isInteger(index) || index < 0) return null
  if (kind === 'layer') return index <= MAX_PROFILES ? { kind, index } : null // MAX_PROFILES itself is the Studio slot
  if (kind === 'key')
    return index < KEY_COUNT && (b === '0' || b === '1') ? { kind, index, down: b === '1' } : null
  return null
}
