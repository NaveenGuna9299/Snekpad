/* eslint-disable @typescript-eslint/explicit-function-return-type -- a plain JavaScript script: there is nowhere to put a return type */
// Puts the pad firmware bundle where Studio looks for it (resources/firmware), so it is packaged with the app and
// `npm run dev` can offer the update.
//
//   node scripts/copy-firmware-bundle.mjs           copy ../Programs/build/ota into resources/firmware
//   node scripts/copy-firmware-bundle.mjs --check   only check that resources/firmware holds a whole bundle
//
// The bundle is made by Programs/build_mpy.py (see Programs/README or app/README: "Firmware update").

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, '..', '..', 'Programs', 'build', 'ota')
const target = join(here, '..', 'resources', 'firmware')

function fail(message) {
  console.error(`firmware bundle: ${message}`)
  process.exit(1)
}

function describe(dir) {
  const manifestFile = join(dir, 'manifest.json')
  if (!existsSync(manifestFile)) fail(`${manifestFile} is missing`)
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  for (const f of manifest.files ?? [])
    if (!existsSync(join(dir, f.name))) fail(`${f.name} is missing from ${dir}`)
  return `firmware ${manifest.version} for CircuitPython ${manifest.circuitpython}, ${manifest.files.length} files`
}

if (process.argv.includes('--check')) {
  console.log(`firmware bundle in resources/firmware: ${describe(target)}`)
} else {
  if (!existsSync(join(source, 'manifest.json')))
    fail(
      'there is no bundle to copy. Build it first: python build_mpy.py --mpy-cross <path to mpy-cross> (in Programs)'
    )
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  cpSync(source, target, { recursive: true })
  console.log(`copied the firmware bundle to resources/firmware: ${describe(target)}`)
}
