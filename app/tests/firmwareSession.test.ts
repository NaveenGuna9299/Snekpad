import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeviceSession } from '../src/main/device/session'
import { MockLink } from '../src/main/device/mockLink'
import type { MockFirmwareOptions } from '../src/main/device/mockFirmware'
import {
  crcHexBytes,
  type FirmwareBundle,
  type FirmwareProgress,
  type FirmwareUpdateResult
} from '../src/shared/firmwareUpdate'

const bytes = (n: number, seed: number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => (i * 13 + seed) & 255)

function bundle(circuitpython = '10.3.1'): FirmwareBundle {
  const data = {
    'firmware.mpy': bytes(2500, 1),
    'rgb_keys.mpy': bytes(700, 2),
    'snekpad32.bmp': bytes(574, 3)
  }
  return {
    manifest: {
      format: 1,
      version: '0.4.0',
      circuitpython,
      files: Object.entries(data).map(([name, d]) => ({
        name: name as keyof typeof data,
        size: d.length,
        crc32: crcHexBytes(d)
      }))
    },
    data
  }
}

const OTA_PAD = '0.3.4'

/** A session on a mock pad that can take updates. */
function pad(
  options: MockFirmwareOptions = {},
  firmware: string | null = OTA_PAD
): { link: MockLink; s: DeviceSession } {
  const link = new MockLink(firmware, false, options)
  return { link, s: new DeviceSession(link) }
}

const frames = (link: MockLink, prefix: string): string[] =>
  link.log.filter((l) => l.startsWith(prefix))
const untouched = (link: MockLink): void => {
  expect(Object.keys(link.fw?.installed ?? {})).toEqual([])
  expect(link.fw?.staged.size ?? 0).toBe(0)
  expect(link.fw?.phase ?? 'idle').toBe('idle')
  expect(link.restartAs).toBeNull()
}

afterEach(() => vi.useRealTimers())

describe('sending a firmware update', () => {
  it('stages every file, commits, and the pad restarts on the new firmware', async () => {
    const { link, s } = pad()
    const b = bundle()
    const r = await s.updateFirmware(b)
    expect(r).toEqual({ ok: true })
    for (const f of b.manifest.files) expect(link.fw?.installed[f.name]).toEqual(b.data[f.name])
    expect(link.restartAs).toEqual({ firmware: '0.4.0', failedReason: null })
    expect(s.updating).toBe(false)
  })

  it('sends the lines in the order the pad expects', async () => {
    const { link, s } = pad()
    await s.updateFirmware(bundle())
    const kinds = link.log.map((l) => l.split('\t')[0]).filter((k) => k.startsWith('FW_'))
    expect(kinds[0]).toBe('FW_INFO')
    expect(kinds[1]).toBe('FW_BEGIN')
    expect(kinds[kinds.length - 1]).toBe('FW_COMMIT')
    expect(frames(link, 'FW_FILE\t')).toHaveLength(3)
    expect(frames(link, 'FW_FILE_END')).toHaveLength(3)
    // each file: FW_FILE, its data lines, FW_FILE_END, never mixed
    let open = false
    for (const k of kinds.slice(2, -1)) {
      if (k === 'FW_FILE') {
        expect(open).toBe(false)
        open = true
      } else if (k === 'FW_FILE_END') {
        expect(open).toBe(true)
        open = false
      } else expect(open).toBe(true)
    }
  })

  it('sends one data line at a time and waits for the pad to answer PING after each', async () => {
    // a pad on firmware 0.4.0 has only a few KB of free RAM while it receives: several lines read at once ran it out
    const { link, s } = pad()
    await s.updateFirmware(bundle())
    const lines = link.log
    let data = 0
    lines.forEach((l, i) => {
      if (l.startsWith('FW_DATA	')) {
        data++
        expect(lines[i + 1], `after data line ${data}`).toBe('PING')
      }
    })
    expect(data).toBeGreaterThan(50)
    // and never two data lines in a row without a PING between them
    for (let i = 1; i < lines.length; i++)
      expect(lines[i].startsWith('FW_DATA	') && lines[i - 1].startsWith('FW_DATA	')).toBe(false)
  })

  it('keeps every data line short', async () => {
    const { link, s } = pad()
    await s.updateFirmware(bundle())
    for (const l of frames(link, 'FW_DATA	')) expect(l.length).toBeLessThanOrEqual(8 + 64)
  })

  it('reports progress: checking, waiting for the knob, sending, finishing', async () => {
    const { s } = pad()
    const seen: FirmwareProgress[] = []
    await s.updateFirmware(bundle(), (p) => seen.push(p))
    expect(seen.map((p) => p.phase).filter((p, i, a) => a.indexOf(p) === i)).toEqual([
      'checking',
      'waiting',
      'sending',
      'finishing'
    ])
    const sending = seen.filter((p) => p.phase === 'sending') as Extract<
      FirmwareProgress,
      { phase: 'sending' }
    >[]
    expect(sending.length).toBeGreaterThan(3)
    for (let i = 1; i < sending.length; i++)
      expect(sending[i].sent).toBeGreaterThanOrEqual(sending[i - 1].sent)
    expect(sending[sending.length - 1].sent).toBeLessThanOrEqual(sending[0].total)
    expect(sending.map((p) => p.file)).toEqual(
      expect.arrayContaining(['firmware.mpy', 'rgb_keys.mpy', 'snekpad32.bmp'])
    )
  })

  it('sends nothing until the knob on the pad is pressed', async () => {
    const { link, s } = pad({ knob: 'manual' })
    let waiting = false
    const run = s.updateFirmware(bundle(), (p) => {
      if (p.phase === 'waiting') waiting = true
    })
    await vi.waitFor(() => expect(waiting).toBe(true))
    await new Promise((r) => setTimeout(r, 100))
    expect(frames(link, 'FW_BEGIN')).toHaveLength(1)
    expect(frames(link, 'FW_FILE')).toHaveLength(0)
    expect(frames(link, 'FW_DATA')).toHaveLength(0)
    link.pressKnob()
    expect(await run).toEqual({ ok: true })
  })

  it('gives up cleanly when the knob is never pressed', async () => {
    const { link, s } = pad({ knob: 'manual', confirmMs: 60 })
    const r = await s.updateFirmware(bundle())
    expect(r).toEqual({ ok: false, error: 'not confirmed on the pad' })
    expect(frames(link, 'FW_FILE')).toHaveLength(0)
    untouched(link)
  })

  it('refuses an update built for another CircuitPython, before sending anything', async () => {
    const { link, s } = pad()
    const r = await s.updateFirmware(bundle('9.2.0'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('CircuitPython 9.2.0')
    expect(frames(link, 'FW_BEGIN')).toHaveLength(0)
    untouched(link)
  })

  it('refuses an update that does not fit in the pad', async () => {
    const { link, s } = pad({ freeBytes: 5000 })
    const r = await s.updateFirmware(bundle())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('free space')
    expect(frames(link, 'FW_BEGIN')).toHaveLength(0)
    untouched(link)
  })

  it('tells the user when the pad is too old to take an update', async () => {
    vi.useFakeTimers()
    const { link, s } = pad({}, '0.3.3') // no updater: it ignores FW_ lines
    const run = s.updateFirmware(bundle())
    await vi.advanceTimersByTimeAsync(5000)
    const r = await run
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('one flash from the computer')
    expect(frames(link, 'FW_BEGIN')).toHaveLength(0)
  })

  it('never starts with a damaged bundle', async () => {
    const { link, s } = pad()
    const b = bundle()
    b.data['firmware.mpy'][5] ^= 1
    const r = await s.updateFirmware(b)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('damaged')
    expect(link.log.filter((l) => l.startsWith('FW_'))).toEqual([])
  })
})

describe('when something goes wrong on the way', () => {
  /** Change what is written to the pad: the function gets each line and returns what to send (or null to drop it). */
  function tamper(link: MockLink, fn: (line: string) => string | null): void {
    const write = link.write.bind(link)
    link.write = (line) => {
      const out = fn(line)
      if (out !== null) write(out)
    }
  }

  it('a flipped bit in a data line is caught by the file check; nothing is installed', async () => {
    const { link, s } = pad()
    let done = false
    tamper(link, (line) => {
      if (!done && line.startsWith('FW_DATA\t')) {
        done = true
        const raw = Buffer.from(line.split('\t')[1], 'base64')
        raw[0] ^= 0x01
        return `FW_DATA\t${raw.toString('base64')}`
      }
      return line
    })
    const r = await s.updateFirmware(bundle())
    expect(r).toEqual({ ok: false, error: 'crc mismatch' })
    untouched(link)
  })

  it('a lost data line is caught by the size check; nothing is installed', async () => {
    const { link, s } = pad()
    let dropped = false
    tamper(link, (line) => {
      if (!dropped && line.startsWith('FW_DATA\t')) {
        dropped = true
        return null
      }
      return line
    })
    const r = await s.updateFirmware(bundle())
    expect(r).toEqual({ ok: false, error: 'size mismatch' })
    untouched(link)
  })

  it('extra data is caught too', async () => {
    const { link, s } = pad()
    let extra = false
    tamper(link, (line) => {
      if (!extra && line.startsWith('FW_FILE_END')) {
        extra = true
        link.write(`FW_DATA\t${Buffer.from('extra').toString('base64')}`)
      }
      return line
    })
    const r = await s.updateFirmware(bundle())
    expect(r.ok).toBe(false)
    untouched(link)
  })

  it('a failed update leaves the session and the pad ready for another try', async () => {
    const { link, s } = pad()
    let broken = true
    tamper(link, (line) => {
      if (broken && line.startsWith('FW_DATA\t')) {
        broken = false
        return null
      }
      return line
    })
    expect((await s.updateFirmware(bundle())).ok).toBe(false)
    untouched(link)
    expect(await s.updateFirmware(bundle())).toEqual({ ok: true })
    expect(Object.keys(link.fw?.installed ?? {})).toHaveLength(3)
  })

  it('a pad that stops answering in the middle gives up with a plain error, and tells the pad to drop it', async () => {
    vi.useFakeTimers()
    const { link, s } = pad()
    tamper(link, (line) =>
      line.startsWith('FW_FILE\t') && link.log.filter((l) => l.startsWith('FW_FILE\t')).length > 1
        ? null
        : line
    )
    const run = s.updateFirmware(bundle())
    await vi.advanceTimersByTimeAsync(10000)
    const r = (await run) as Extract<FirmwareUpdateResult, { ok: false }>
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no reply from pad')
    expect(frames(link, 'FW_ABORT').length).toBeGreaterThan(0)
    expect(link.restartAs).toBeNull()
  })

  it('stops with a plain error when the pad stops answering the pacing PING', async () => {
    vi.useFakeTimers()
    const { link, s } = pad()
    let pings = 0
    tamper(link, (line) => (line === 'PING' && ++pings > 5 ? null : line))
    const run = s.updateFirmware(bundle())
    await vi.advanceTimersByTimeAsync(10000)
    const r = (await run) as Extract<FirmwareUpdateResult, { ok: false }>
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no reply from pad')
    expect(frames(link, 'FW_ABORT').length).toBeGreaterThan(0)
    expect(link.restartAs).toBeNull()
    expect(frames(link, 'FW_DATA	').length).toBeLessThan(10) // it did not carry on sending
  })
})

describe('cancelling', () => {
  it('while the pad waits for the knob', async () => {
    const { link, s } = pad({ knob: 'manual' })
    let waiting = false
    const run = s.updateFirmware(bundle(), (p) => {
      if (p.phase === 'waiting') waiting = true
    })
    await vi.waitFor(() => expect(waiting).toBe(true))
    s.cancelFirmwareUpdate()
    const r = await run
    expect(r).toEqual({ ok: false, error: 'cancelled', cancelled: true })
    untouched(link)
    expect(s.updating).toBe(false)
  })

  it('while sending', async () => {
    const { link, s } = pad()
    let cancelled = false
    const r = await s.updateFirmware(bundle(), (p) => {
      if (p.phase === 'sending' && !cancelled) {
        cancelled = true
        s.cancelFirmwareUpdate()
      }
    })
    expect(r).toEqual({ ok: false, error: 'cancelled', cancelled: true })
    untouched(link)
    expect(frames(link, 'FW_COMMIT')).toHaveLength(0)
  })

  it('does nothing when no update is running', () => {
    const { link, s } = pad()
    s.cancelFirmwareUpdate()
    expect(frames(link, 'FW_ABORT')).toHaveLength(0)
  })

  it('a cancelled update can be started again', async () => {
    const { s } = pad()
    let once = false
    await s.updateFirmware(bundle(), () => {
      if (!once) {
        once = true
        s.cancelFirmwareUpdate()
      }
    })
    expect(await s.updateFirmware(bundle())).toEqual({ ok: true })
  })
})

describe('while an update runs', () => {
  it('says so, and colour previews are not sent in between', async () => {
    const { link, s } = pad({ knob: 'manual' })
    let waiting = false
    const run = s.updateFirmware(bundle(), (p) => {
      if (p.phase === 'waiting') waiting = true
    })
    expect(s.updating).toBe(true)
    await vi.waitFor(() => expect(waiting).toBe(true))
    await s.preview(0, 1, '#ff0000')
    expect(link.log.filter((l) => l.startsWith('LED'))).toEqual([])
    link.pressKnob()
    await run
    expect(s.updating).toBe(false)
  })

  it('the pad speaking on its own (events) does not disturb it', async () => {
    const { link, s } = pad()
    const run = s.updateFirmware(bundle(), (p) => {
      if (p.phase === 'sending') {
        link.emit('EVT\tkey\t3\t1')
        link.emit('EVT\tlayer\t1')
      }
    })
    expect(await run).toEqual({ ok: true })
  })
})

describe('FW_INFO', () => {
  it('reads the pad firmware, CircuitPython version and free space', async () => {
    const { s } = pad({ freeBytes: 123456 })
    expect(await s.firmwareInfo()).toEqual({
      ok: true,
      firmware: OTA_PAD,
      circuitpython: '10.3.1',
      freeBytes: 123456,
      failed: null
    })
  })

  it('reports why the last update was undone, once', async () => {
    const { s } = pad({ failedReason: 'new firmware did not start' })
    const first = await s.firmwareInfo()
    expect(first.ok && first.failed).toBe('new firmware did not start')
    const second = await s.firmwareInfo()
    expect(second.ok && second.failed).toBeNull()
  })

  it('a pad without the updater does not answer', async () => {
    vi.useFakeTimers()
    const { s } = pad({}, '0.3.3')
    const p = s.firmwareInfo()
    await vi.advanceTimersByTimeAsync(3000)
    expect(await p).toEqual({ ok: false, error: 'no reply from pad' })
  })
})
