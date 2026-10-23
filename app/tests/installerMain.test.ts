import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The installer window (installer/main.js) needs Electron, so it is checked as text here.
const source = readFileSync(join(__dirname, '..', 'installer', 'main.js'), 'utf8')
const dirSize = source.slice(source.indexOf('function dirSize'), source.indexOf('function send('))

describe('the installer window', () => {
  it('scans the install folder with original-fs, not Electron fs', () => {
    // Electron's fs opens an .asar it finds while listing a folder and keeps it open: the old Studio's
    // resources/app.asar then cannot be deleted by its uninstaller ("Failed to uninstall old application files: 2").
    expect(source).toMatch(/require\('original-fs'\)/)
    expect(dirSize.length).toBeGreaterThan(50)
    expect(dirSize).toMatch(/plainFs\.readdirSync/)
    expect(dirSize).toMatch(/plainFs\.statSync/)
    expect(dirSize.replace(/plainFs\./g, '')).not.toMatch(/\bfs\./)
  })

  it('runs the setup through the retrying runner and closes a running Studio first', () => {
    expect(source).toMatch(/require\('\.\/installRunner'\)/)
    expect(source).toMatch(/runSetup\(/)
    expect(source).toMatch(/stopStudio/)
  })

  it('has its runner in the packaged files', () => {
    const config = readFileSync(join(__dirname, '..', 'installer', 'electron-builder.yml'), 'utf8')
    expect(config).toMatch(/- installRunner\.js/)
    expect(config).toMatch(/- main\.js/)
  })
})
