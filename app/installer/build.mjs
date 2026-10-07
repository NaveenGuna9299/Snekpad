// Builds the themed installer: bundles the NSIS setup.exe made by `npm run build:win` as a payload
// and wraps it in the pad-themed window. Run from the app folder after `npm run build:win`.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.join(here, '..')
const { version, name } = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))

const nsis = path.join(appDir, 'dist', `${name}-${version}-setup.exe`)
const unpacked = path.join(appDir, 'dist', 'win-unpacked')
if (!fs.existsSync(nsis) || !fs.existsSync(unpacked)) {
  console.error(`Missing ${nsis} or win-unpacked. Run "npm run build:win" first.`)
  process.exit(1)
}

function dirSize(dir) {
  let total = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size
  }
  return total
}

const payload = path.join(here, 'payload')
fs.rmSync(payload, { recursive: true, force: true })
fs.mkdirSync(payload, { recursive: true })
fs.copyFileSync(nsis, path.join(payload, 'setup.exe'))
fs.writeFileSync(
  path.join(payload, 'payload.json'),
  JSON.stringify({ version, expectedBytes: dirSize(unpacked) })
)

const cli = path.join(appDir, 'node_modules', 'electron-builder', 'cli.js')
const r = spawnSync(
  process.execPath,
  [cli, '--win', 'portable', '--projectDir', here, '--config', path.join(here, 'electron-builder.yml'),
   `-c.extraMetadata.version=${version}`, `-c.electronVersion=${
     JSON.parse(fs.readFileSync(path.join(appDir, 'node_modules', 'electron', 'package.json'), 'utf8')).version
   }`],
  { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } }
)
process.exit(r.status ?? 1)
