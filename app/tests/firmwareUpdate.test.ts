import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FW_ALLOWED,
  FW_CHUNK_BYTES,
  FW_CONFIRM_MS,
  FW_MAX_FILE,
  FW_MAX_FILES,
  FW_MAX_TOTAL,
  FW_SPACE_MARGIN,
  bundleBytes,
  crcHexBytes,
  fwBeginLine,
  fwCommitLine,
  fwDataLines,
  fwFileLine,
  manifestSchema,
  parseFwInfo,
  verifyBundle,
  type FirmwareBundle
} from '../src/shared/firmwareUpdate'
import { crc32, crc32Bytes } from '../src/shared/protocol'

const bytes = (n: number, seed = 1): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 255)

function bundle(): FirmwareBundle {
  const data = {
    'firmware.mpy': bytes(1000, 1),
    'rgb_keys.mpy': bytes(250, 2),
    'snekpad32.bmp': bytes(574, 3)
  }
  return {
    manifest: {
      format: 1,
      version: '0.4.0',
      circuitpython: '10.3.1',
      files: Object.entries(data).map(([name, d]) => ({
        name: name as (typeof FW_ALLOWED)[number],
        size: d.length,
        crc32: crcHexBytes(d)
      }))
    },
    data
  }
}

describe('checksums', () => {
  it('computes the standard CRC-32 (the pad checks the same value)', () => {
    expect(crc32Bytes(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crcHexBytes(Buffer.from('123456789'))).toBe('cbf43926')
  })

  it('the text version still agrees with the bytes version', () => {
    expect(crc32('héllo wörld')).toBe(crc32Bytes(Buffer.from('héllo wörld', 'utf8')))
  })
})

describe('manifest', () => {
  const valid = (): unknown => JSON.parse(JSON.stringify(bundle().manifest))
  const edit = (
    fn: (m: Record<string, unknown> & { files: Record<string, unknown>[] }) => void
  ): boolean => {
    const m = valid() as Record<string, unknown> & { files: Record<string, unknown>[] }
    fn(m)
    return manifestSchema.safeParse(m).success
  }

  it('accepts a good manifest', () => {
    expect(manifestSchema.safeParse(valid()).success).toBe(true)
  })

  it('rejects a wrong format, version or CircuitPython version', () => {
    expect(edit((m) => (m.format = 2))).toBe(false)
    expect(edit((m) => (m.version = 'v1'))).toBe(false)
    expect(edit((m) => (m.version = '1.2'))).toBe(false)
    expect(edit((m) => (m.circuitpython = '10'))).toBe(false)
  })

  it('rejects files the pad would never accept', () => {
    for (const name of [
      'code.py',
      'boot.py',
      'fw_boot.mpy',
      'config.json',
      '../x.mpy',
      'kmk/a.mpy'
    ])
      expect(
        edit((m) => (m.files[0].name = name)),
        name
      ).toBe(false)
  })

  it('rejects bad sizes and checksums', () => {
    for (const size of [0, -1, 1.5, FW_MAX_FILE + 1])
      expect(edit((m) => (m.files[0].size = size))).toBe(false)
    for (const crc of ['', 'ABCDEF12', 'abc', 'zzzzzzzz', 'abcdef123'])
      expect(
        edit((m) => (m.files[0].crc32 = crc)),
        crc
      ).toBe(false)
  })

  it('rejects an empty or duplicated file list', () => {
    expect(edit((m) => (m.files = []))).toBe(false)
    expect(edit((m) => m.files.push({ ...m.files[0] }))).toBe(false)
  })

  it('rejects an update that is too big in total', () => {
    const files = FW_ALLOWED.slice(0, 6).map((name) => ({
      name,
      size: FW_MAX_FILE,
      crc32: '00000000'
    }))
    expect(manifestSchema.safeParse({ ...(valid() as object), files }).success).toBe(false)
  })
})

describe('verifyBundle', () => {
  it('accepts a whole bundle', () => {
    expect(verifyBundle(bundle())).toBeNull()
  })

  it('notices a missing, resized or changed file', () => {
    const missing = bundle()
    delete missing.data['rgb_keys.mpy']
    expect(verifyBundle(missing)).toContain('rgb_keys.mpy is missing')

    const short = bundle()
    short.data['firmware.mpy'] = short.data['firmware.mpy'].slice(1)
    expect(verifyBundle(short)).toContain('firmware.mpy has the wrong size')

    const changed = bundle()
    changed.data['firmware.mpy'][10] ^= 1
    expect(verifyBundle(changed)).toContain('firmware.mpy is damaged')
  })

  it('counts the bytes of the whole update', () => {
    expect(bundleBytes(bundle().manifest)).toBe(1000 + 250 + 574)
  })
})

describe('the lines sent to the pad', () => {
  it('describes the update to begin with', () => {
    expect(fwBeginLine(bundle().manifest)).toBe('FW_BEGIN\t0.4.0\t3\t1824\t10.3.1')
  })

  it('describes each file and the commit', () => {
    const f = bundle().manifest.files[1]
    expect(fwFileLine(f)).toBe(`FW_FILE\trgb_keys.mpy\t250\t${f.crc32}`)
    expect(fwCommitLine('0.4.0')).toBe('FW_COMMIT\t0.4.0')
  })

  it('cuts a file into base64 lines that put it back together exactly', () => {
    const data = bytes(1000)
    const lines = fwDataLines(data)
    expect(lines).toHaveLength(Math.ceil(1000 / FW_CHUNK_BYTES))
    const joined = Buffer.concat(lines.map((l) => Buffer.from(l.split('\t')[1], 'base64')))
    expect(new Uint8Array(joined)).toEqual(data)
  })

  it('keeps every line short and plain: one tab, no line breaks, ASCII only', () => {
    for (const line of fwDataLines(bytes(5000, 9))) {
      expect(line.length).toBeLessThanOrEqual('FW_DATA\t'.length + 128)
      expect(line.split('\t')).toHaveLength(2)
      expect(line).toMatch(/^[\x20-\x7e\t]+$/)
    }
  })

  it('handles files that are not a multiple of the chunk size, and a one byte file', () => {
    for (const n of [1, 95, 96, 97, 191, 192, 193]) {
      const data = bytes(n)
      const joined = Buffer.concat(
        fwDataLines(data).map((l) => Buffer.from(l.split('\t')[1], 'base64'))
      )
      expect(new Uint8Array(joined), String(n)).toEqual(data)
    }
  })
})

describe('FW_INFO', () => {
  it('reads what the pad says', () => {
    expect(parseFwInfo('FW_INFO\t0.3.4\t10.3.1\t812345\t-')).toEqual({
      firmware: '0.3.4',
      circuitpython: '10.3.1',
      freeBytes: 812345,
      failed: null
    })
  })

  it('reads why the last update was undone', () => {
    expect(
      parseFwInfo('FW_INFO\t0.3.4\t10.3.1\t812345\tnew firmware did not start\r')?.failed
    ).toBe('new firmware did not start')
  })

  it('drops anything malformed', () => {
    for (const line of [
      'FW_INFO',
      'FW_INFO\tx\t10.3.1\t1\t-',
      'FW_INFO\t0.3.4\t10\t1\t-',
      'FW_INFO\t0.3.4\t10.3.1\t-5\t-',
      'FW_INFO\t0.3.4\t10.3.1\tmany\t-',
      'OK',
      ''
    ])
      expect(parseFwInfo(line), line).toBeNull()
  })
})

describe('Studio and the pad agree on the rules (read from the pad firmware source)', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'Programs', 'fw_update.py'), 'utf8')
  const num = (name: string): number =>
    Number(new RegExp(`^${name} = (\\d+)`, 'm').exec(source)?.[1])

  it('sends exactly the files the pad accepts', () => {
    const block = /ALLOWED = \(([^)]*)\)/s.exec(source)![1]
    const names = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect([...FW_ALLOWED]).toEqual(names)
  })

  it('uses the same limits', () => {
    expect(FW_MAX_FILES).toBe(num('MAX_FILES'))
    expect(FW_MAX_FILE).toBe(num('MAX_FILE'))
    expect(FW_MAX_TOTAL).toBe(num('MAX_TOTAL'))
    expect(FW_SPACE_MARGIN).toBe(num('SPACE_MARGIN'))
    expect(FW_CONFIRM_MS).toBe(num('CONFIRM_S') * 1000)
  })

  it('answers FW_INFO and the other commands with the words Studio expects', () => {
    for (const word of [
      'FW_INFO',
      'FW_BEGIN',
      'FW_FILE',
      'FW_DATA',
      'FW_FILE_END',
      'FW_COMMIT',
      'FW_ABORT'
    ])
      expect(source).toContain(word)
  })
})
