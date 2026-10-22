// The firmware bundle that ships inside this build of Studio (resources/firmware: manifest.json and the files
// it lists, made by Programs/build_mpy.py and put there by the release build or `npm run firmware:bundle`).
// No Electron imports: the folder is passed in, so this can be tested with a temporary folder.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  bundleBytes,
  manifestSchema,
  verifyBundle,
  type FirmwareBundle
} from '../shared/firmwareUpdate'

export type BundleResult =
  { ok: true; bundle: FirmwareBundle } | { ok: false; error: string; missing: boolean }

/** Read and check the bundle in `dir`. A damaged or incomplete bundle is never offered. */
export function readBundle(dir: string): BundleResult {
  const manifestFile = join(dir, 'manifest.json')
  if (!existsSync(manifestFile))
    return { ok: false, error: 'This build of Studio has no firmware bundle.', missing: true }
  try {
    const parsed = manifestSchema.safeParse(JSON.parse(readFileSync(manifestFile, 'utf8')))
    if (!parsed.success)
      return { ok: false, error: 'The firmware bundle manifest is not valid.', missing: false }
    const data: Record<string, Uint8Array> = {}
    for (const f of parsed.data.files) {
      const file = join(dir, f.name)
      if (!existsSync(file))
        return {
          ok: false,
          error: `${f.name} is missing from the firmware bundle.`,
          missing: false
        }
      data[f.name] = new Uint8Array(readFileSync(file))
    }
    const bundle: FirmwareBundle = { manifest: parsed.data, data }
    const bad = verifyBundle(bundle)
    return bad ? { ok: false, error: bad, missing: false } : { ok: true, bundle }
  } catch (e) {
    return {
      ok: false,
      error: `The firmware bundle could not be read: ${e instanceof Error ? e.message : String(e)}`,
      missing: false
    }
  }
}

/** What the window is told about the bundle (not the bytes). */
export function bundleInfo(
  r: BundleResult
):
  | { ok: true; version: string; circuitpython: string; files: number; bytes: number }
  | { ok: false; error: string; missing: boolean } {
  if (!r.ok) return r
  const m = r.bundle.manifest
  return {
    ok: true,
    version: m.version,
    circuitpython: m.circuitpython,
    files: m.files.length,
    bytes: bundleBytes(m)
  }
}
