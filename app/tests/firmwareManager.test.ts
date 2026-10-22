import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceManager } from '../src/main/device/manager'
import { MockLink } from '../src/main/device/mockLink'
import type { MockFirmwareOptions } from '../src/main/device/mockFirmware'
import { defaultConfig } from '../src/shared/config'
import { crcHexBytes, type FirmwareBundle } from '../src/shared/firmwareUpdate'

const bytes = (n: number, seed: number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => (i * 11 + seed) & 255)

function bundle(version = '0.4.0'): FirmwareBundle {
  const data = { 'firmware.mpy': bytes(1500, 1), 'rgb_keys.mpy': bytes(400, 2) }
  return {
    manifest: {
      format: 1,
      version,
      circuitpython: '10.3.1',
      files: Object.entries(data).map(([name, d]) => ({
        name: name as keyof typeof data,
        size: d.length,
        crc32: crcHexBytes(d)
      }))
    },
    data
  }
}

/** A manager whose pad is a mock (so it is not scanning for real ports) connected to the given link. */
function managerWith(link: MockLink): DeviceManager {
  const m = new DeviceManager()
  ;(m as unknown as { autoScan: boolean }).autoScan = false
  ;(m as unknown as { attach(l: MockLink): void }).attach(link)
  return m
}

const settle = (ms: number): Promise<void> => vi.advanceTimersByTimeAsync(ms)

/** Step the clock until the promise has a result (not further, so the moments after it can be looked at). */
async function until<T>(p: Promise<T>): Promise<T> {
  let done = false
  let value!: T
  void p.then((v) => {
    done = true
    value = v
  })
  for (let i = 0; i < 2000 && !done; i++) await settle(10)
  expect(done).toBe(true)
  return value
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('DeviceManager firmware update', () => {
  it('says so when no pad is connected', async () => {
    const m = new DeviceManager()
    expect(await m.updateFirmware(bundle(), () => {})).toEqual({
      ok: false,
      error: 'pad not connected'
    })
    expect(await m.firmwareInfo()).toEqual({ ok: false, error: 'pad not connected' })
    m.cancelFirmwareUpdate() // nothing running: nothing happens
  })

  it('updates a pad: it restarts without it being an error, and comes back on the new firmware', async () => {
    const m = managerWith(new MockLink('0.3.4', false))
    await settle(50)
    expect(m.state.firmware).toBe('0.3.4')

    expect(await until(m.updateFirmware(bundle(), () => {}))).toEqual({ ok: true })

    await settle(60) // the pad restarts
    expect(m.state.status).toBe('disconnected')
    expect(m.state.error).toBeUndefined() // a restart for an update is not a failure

    await settle(2500) // the pad is back
    expect(m.state.status).toBe('connected')
    expect(m.state.firmware).toBe('0.4.0')
    m.stop()
  })

  it('a pad whose new firmware fails its trial comes back on the old firmware and says why', async () => {
    const m = managerWith(new MockLink('0.3.4', false, { trialFails: true }))
    await settle(50)
    const run = m.updateFirmware(bundle(), () => {})
    await settle(5000)
    expect(await run).toEqual({ ok: true })
    await settle(3000)
    expect(m.state.status).toBe('connected')
    expect(m.state.firmware).toBe('0.3.4') // the safety net put the old firmware back

    const info = m.firmwareInfo()
    await settle(100)
    const r = await info
    expect(r.ok && r.failed).toBe('new firmware did not start')
    const again = m.firmwareInfo()
    await settle(100)
    const r2 = await again
    expect(r2.ok && r2.failed).toBeNull() // reported once
    m.stop()
  })

  describe('a pad that restarts without disconnecting (what the real pad does)', () => {
    const soft: MockFirmwareOptions = { reload: 'soft' }

    it('is greeted again after the update, and then reports the new firmware', async () => {
      const link = new MockLink('0.3.4', false, soft)
      const m = managerWith(link)
      await settle(50)
      expect(m.state.firmware).toBe('0.3.4')
      const hellos = (): number => link.log.filter((l) => l === 'HELLO').length
      const before = hellos()

      expect(await until(m.updateFirmware(bundle(), () => {}))).toEqual({ ok: true })
      // the USB connection stays open, but Studio no longer knows what the pad runs
      expect(m.state.status).toBe('connected')
      expect(m.state.firmware).toBeUndefined()
      expect(m.state.events).toBeUndefined()
      expect(m.state.legacy).toBeUndefined()

      await settle(500) // the pad is still restarting: Studio waits before greeting
      expect(m.state.firmware).toBeUndefined()
      expect(link.log.filter((l) => l === 'HELLO').length).toBe(before) // nothing sent to the old firmware
      await settle(4000) // it has booted, and answers a later greeting
      expect(m.state.status).toBe('connected')
      expect(m.state.firmware).toBe('0.4.0')
      expect(m.state.events).toBe(true)
      expect(hellos()).toBeGreaterThan(before) // it kept asking until the pad answered
      m.stop()
    })

    it('does not call a slow-restarting pad old firmware', async () => {
      const m = managerWith(new MockLink('0.3.4', false, soft))
      await settle(50)
      await until(m.updateFirmware(bundle(), () => {}))
      await settle(1400) // longer than the 3 greetings an unplugged-and-replugged pad gets
      expect(m.state.legacy).toBeUndefined()
      m.stop()
    })

    it('a new firmware that fails its trial leaves the pad on the old firmware, with the reason', async () => {
      const m = managerWith(new MockLink('0.3.4', false, { reload: 'soft', trialFails: true }))
      await settle(50)
      expect(await until(m.updateFirmware(bundle(), () => {}))).toEqual({ ok: true })
      await settle(4000)
      expect(m.state.firmware).toBe('0.3.4')
      const info = m.firmwareInfo()
      await settle(100)
      const r = await info
      expect(r.ok && r.failed).toBe('new firmware did not start')
      m.stop()
    })

    it('is greeted again after a config push, so it keeps reporting its profile and keys', async () => {
      const link = new MockLink('0.3.4', false, soft)
      const m = managerWith(link)
      await settle(50)
      expect(m.state.events).toBe(true)
      const push = m.push(defaultConfig())
      await until(push)
      expect(m.state.events).toBeUndefined() // the pad restarted and has forgotten the greeting
      await settle(4000)
      expect(m.state.events).toBe(true)
      expect(m.state.firmware).toBe('0.3.4')
      m.stop()
    })

    it('a refused push does not make Studio forget the pad', async () => {
      const link = new MockLink('0.3.4', false, soft)
      const m = managerWith(link)
      await settle(50)
      const json = JSON.parse(JSON.stringify(defaultConfig()))
      const write = link.write.bind(link)
      link.write = (line) => write(line.startsWith('CFG_END') ? 'CFG_END_BROKEN' : line) // the push never completes
      const run = m.push(json)
      await settle(15000)
      expect((await run).ok).toBe(false)
      expect(m.state.events).toBe(true)
      expect(m.state.firmware).toBe('0.3.4')
      m.stop()
    })
  })

  it('the pad keeps its config across the restart', async () => {
    const link = new MockLink('0.3.4', false)
    link.config = '{"kept":true}'
    const m = managerWith(link)
    await settle(50)
    const run = m.updateFirmware(bundle(), () => {})
    await settle(5000)
    await run
    await settle(3000)
    const reborn = (m as unknown as { link: MockLink }).link
    expect(reborn).not.toBe(link)
    expect(reborn.config).toBe('{"kept":true}')
    m.stop()
  })

  it('stops sending the focused app while the update runs', async () => {
    const link = new MockLink('0.3.4', false, { knob: 'manual' })
    const m = managerWith(link)
    await settle(50)
    let waiting = false
    const run = m.updateFirmware(bundle(), (p) => {
      if (p.phase === 'waiting') waiting = true
    })
    await settle(100)
    expect(waiting).toBe(true)
    m.sendApp('Code.exe', 'main.py')
    expect(link.log.filter((l) => l.startsWith('APP'))).toEqual([])
    link.pressKnob()
    await settle(5000)
    await run
    m.stop()
  })

  it('sends the focused app again when no update is running', async () => {
    const link = new MockLink('0.3.4', false)
    const m = managerWith(link)
    await settle(50)
    m.sendApp('Code.exe', 'main.py')
    expect(link.log.filter((l) => l.startsWith('APP'))).toHaveLength(1)
    m.stop()
  })

  it('a refused update (wrong CircuitPython) leaves the connection alone', async () => {
    const opts: MockFirmwareOptions = { circuitpython: '9.2.0' }
    const link = new MockLink('0.3.4', false, opts)
    const m = managerWith(link)
    await settle(50)
    const run = m.updateFirmware(bundle(), () => {})
    await settle(3000)
    const r = await run
    expect(r.ok).toBe(false)
    expect(m.state.status).toBe('connected')
    expect(link.restartAs).toBeNull()
    m.stop()
  })
})
