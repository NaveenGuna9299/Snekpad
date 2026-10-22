import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bundleInfo, readBundle } from '../src/main/firmwareBundle'
import { crcHexBytes } from '../src/shared/firmwareUpdate'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** A bundle folder like the one the release build puts in resources/firmware. */
function makeBundle(
  edit: (m: Record<string, unknown> & { files: Record<string, unknown>[] }) => void = () => {}
): string {
  const dir = mkdtempSync(join(tmpdir(), 'fwbundle-'))
  dirs.push(dir)
  const files = {
    'firmware.mpy': Buffer.from('FIRMWARE'.repeat(100)),
    'rgb_keys.mpy': Buffer.from('RGB'.repeat(50))
  }
  for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data)
  const manifest = {
    format: 1,
    version: '0.4.0',
    circuitpython: '10.3.1',
    files: Object.entries(files).map(([name, data]) => ({
      name,
      size: data.length,
      crc32: crcHexBytes(data)
    }))
  }
  edit(manifest)
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  return dir
}

describe('readBundle', () => {
  it('reads a good bundle', () => {
    const r = readBundle(makeBundle())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bundle.manifest.version).toBe('0.4.0')
      expect(Object.keys(r.bundle.data)).toEqual(['firmware.mpy', 'rgb_keys.mpy'])
      expect(r.bundle.data['rgb_keys.mpy']).toHaveLength(150)
    }
  })

  it('says so when this build has no bundle (a development run)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fwbundle-'))
    dirs.push(dir)
    const r = readBundle(dir)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.missing).toBe(true)
    expect(readBundle(join(dir, 'nope')).ok).toBe(false)
  })

  it('refuses a manifest that is not valid JSON or not a manifest', () => {
    const dir = makeBundle()
    writeFileSync(join(dir, 'manifest.json'), '{not json')
    const broken = readBundle(dir)
    expect(broken.ok).toBe(false)
    if (!broken.ok) expect(broken.missing).toBe(false)

    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ format: 1 }))
    expect(readBundle(dir).ok).toBe(false)
  })

  it('refuses a bundle with a file missing', () => {
    const dir = makeBundle()
    rmSync(join(dir, 'rgb_keys.mpy'))
    const r = readBundle(dir)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('rgb_keys.mpy is missing')
  })

  it('refuses a bundle with a damaged file', () => {
    const dir = makeBundle()
    const file = join(dir, 'firmware.mpy')
    const data = readFileSync(file)
    data[3] ^= 0xff
    writeFileSync(file, data)
    const r = readBundle(dir)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('firmware.mpy is damaged')
  })

  it('refuses a manifest that lists a file the pad would never take', () => {
    const dir = makeBundle((m) => (m.files[0].name = 'code.py'))
    expect(readBundle(dir).ok).toBe(false)
  })
})

describe('bundleInfo', () => {
  it('tells the window the version and size, not the bytes', () => {
    const info = bundleInfo(readBundle(makeBundle()))
    expect(info).toEqual({
      ok: true,
      version: '0.4.0',
      circuitpython: '10.3.1',
      files: 2,
      bytes: 950
    })
  })

  it('passes a problem on as it is', () => {
    const info = bundleInfo(readBundle(join(tmpdir(), 'no-such-folder-fwbundle')))
    expect(info.ok).toBe(false)
  })
})

describe('the bundle the firmware build produces (Programs/build/ota, when it has been built)', () => {
  const ota = join(__dirname, '..', '..', 'Programs', 'build', 'ota')
  const built = existsSync(join(ota, 'manifest.json'))

  it.skipIf(!built)('is accepted by Studio and is for the firmware in this repo', () => {
    const r = readBundle(ota)
    expect(r.ok, r.ok ? '' : r.error).toBe(true)
    if (r.ok) {
      const py = readFileSync(join(__dirname, '..', '..', 'Programs', 'app_profiles.py'), 'utf8')
      expect(r.bundle.manifest.version).toBe(/^FIRMWARE_VERSION = "([^"]+)"/m.exec(py)![1])
      expect(r.bundle.manifest.files.map((f) => f.name)).toContain('fw_update.mpy')
    }
  })
})
