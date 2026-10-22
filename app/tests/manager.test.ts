import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeviceManager } from '../src/main/device/manager'
import { MockLink } from '../src/main/device/mockLink'
import type { DeviceState } from '../src/shared/api'
import { REQUIRED_FIRMWARE, firmwareStatus, hasDevTools } from '../src/shared/firmware'

// DeviceManager.attach is private: tests hand it a link directly instead of scanning serial ports.
const attach = (m: DeviceManager, link: MockLink): void =>
  (m as unknown as { attach(l: MockLink): void }).attach(link)

/** A mock pad that never answers HELLO, like firmware from before protocol 2. */
function silentPad(): { link: MockLink; hellos: () => number } {
  const link = new MockLink()
  const write = link.write.bind(link)
  let hellos = 0
  link.write = (line) => {
    if (line === 'HELLO') hellos++
    else write(line)
  }
  return { link, hellos: () => hellos }
}

describe('DeviceManager key test mode', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const tests = (link: MockLink): number => link.log.filter((l) => l === 'TEST').length

  it('sends TEST right away and then every second while on', async () => {
    const m = new DeviceManager()
    const link = new MockLink()
    attach(m, link)
    m.setTestMode(true)
    expect(tests(link)).toBe(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(tests(link)).toBe(4)
    m.stop()
  })

  it('never sends TEST in the production build', async () => {
    vi.stubGlobal('__DEV_TOOLS__', false)
    try {
      const m = new DeviceManager()
      const link = new MockLink()
      attach(m, link)
      m.setTestMode(true)
      await vi.advanceTimersByTimeAsync(5000)
      expect(tests(link)).toBe(0)
      m.stop()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('stops sending TEST when turned off', async () => {
    const m = new DeviceManager()
    const link = new MockLink()
    attach(m, link)
    m.setTestMode(true)
    m.setTestMode(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(tests(link)).toBe(1)
    m.stop()
  })

  it('turning it on twice does not double the heartbeat', async () => {
    const m = new DeviceManager()
    const link = new MockLink()
    attach(m, link)
    m.setTestMode(true)
    m.setTestMode(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(tests(link)).toBe(4) // 2 immediate + 1 per second for 2 s
    m.stop()
  })

  it('does nothing without a pad, and stop() ends it', async () => {
    const m = new DeviceManager()
    m.setTestMode(true)
    const link = new MockLink()
    attach(m, link)
    m.setTestMode(true)
    m.stop()
    const before = tests(link)
    await vi.advanceTimersByTimeAsync(5000)
    expect(tests(link)).toBe(before)
  })
})

describe('DeviceManager firmware detection', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('learns the firmware version from the HELLO answer', async () => {
    const m = new DeviceManager()
    attach(m, new MockLink('0.3.3'))
    await vi.advanceTimersByTimeAsync(50)
    expect(m.state.events).toBe(true)
    expect(m.state.firmware).toBe('0.3.3')
    expect(m.state.legacy).toBeUndefined()
    m.stop()
  })

  it('knows a development pad by the dev flag in its HELLO answer', async () => {
    const m = new DeviceManager()
    attach(m, new MockLink('0.3.3', true))
    await vi.advanceTimersByTimeAsync(50)
    expect(m.state.dev).toBe(true)
    expect(hasDevTools(m.state)).toBe(true)
    m.stop()
  })

  it('a customer pad has no dev flag', async () => {
    const m = new DeviceManager()
    attach(m, new MockLink('0.3.3', false))
    await vi.advanceTimersByTimeAsync(50)
    expect(m.state.dev).toBeUndefined()
    expect(hasDevTools(m.state)).toBe(false)
    m.stop()
  })

  it('a pad that answers HELLO with no version is older', async () => {
    const m = new DeviceManager()
    attach(m, new MockLink(null))
    await vi.advanceTimersByTimeAsync(50)
    expect(m.state.events).toBe(true)
    expect(m.state.firmware).toBeUndefined()
    expect(firmwareStatus(m.state)).toBe('older')
    m.stop()
  })

  it('repeats HELLO, and only calls a silent pad legacy after the last try', async () => {
    const m = new DeviceManager()
    const { link, hellos } = silentPad()
    attach(m, link)
    expect(firmwareStatus(m.state)).toBe('checking')
    await vi.advanceTimersByTimeAsync(2500)
    expect(m.state.legacy).toBeUndefined()
    expect(firmwareStatus(m.state)).toBe('checking')
    await vi.advanceTimersByTimeAsync(1000)
    expect(m.state.legacy).toBe(true)
    expect(firmwareStatus(m.state)).toBe('older')
    expect(hellos()).toBe(3)
    m.stop()
  })

  it('a late HELLO answer clears the legacy flag', async () => {
    const m = new DeviceManager()
    const { link } = silentPad()
    attach(m, link)
    await vi.advanceTimersByTimeAsync(4000)
    expect(m.state.legacy).toBe(true)
    link.emit(`HELLO\t2\t${REQUIRED_FIRMWARE}`)
    expect(m.state.legacy).toBeUndefined()
    expect(m.state.firmware).toBe(REQUIRED_FIRMWARE)
    m.stop()
  })

  it('an unplugged pad stops the HELLO retries and drops the firmware info', async () => {
    const m = new DeviceManager()
    const { link, hellos } = silentPad()
    const states: DeviceState[] = []
    m.on('state', (s: DeviceState) => states.push(s))
    attach(m, link)
    await vi.advanceTimersByTimeAsync(500)
    link.close()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(m.state.status).toBe('disconnected')
    expect(m.state.legacy).toBeUndefined()
    expect(states.some((s) => s.legacy)).toBe(false)
    expect(hellos()).toBe(1)
    m.stop()
  })
})
