import { describe, expect, it } from 'vitest'
import { DeviceSession } from '../src/main/device/session'
import { MockLink } from '../src/main/device/mockLink'
import { defaultConfig } from '../src/shared/config'
import { REQUIRED_FIRMWARE } from '../src/shared/firmware'
import {
  PROTOCOL_VERSION,
  parseEvent,
  parseHello,
  type HelloInfo,
  type PadEvent
} from '../src/shared/protocol'

describe('parseHello', () => {
  it('reads the protocol and the firmware version', () => {
    expect(parseHello('HELLO\t2\t0.3.3')).toEqual({ protocol: 2, firmware: '0.3.3', dev: false })
    expect(parseHello('HELLO\t2\t12.0.40\r')).toEqual({
      protocol: 2,
      firmware: '12.0.40',
      dev: false
    })
  })

  it('reads the dev flag of a development pad, and only that exact word', () => {
    expect(parseHello('HELLO\t2\t0.3.3\tdev')).toEqual({
      protocol: 2,
      firmware: '0.3.3',
      dev: true
    })
    expect(parseHello('HELLO\t2\t0.3.3\tdev\r')?.dev).toBe(true)
    expect(parseHello('HELLO\t2\t0.3.3\tDEV')?.dev).toBe(false)
    expect(parseHello('HELLO\t2\t0.3.3\tdevelopment')?.dev).toBe(false)
    expect(parseHello('HELLO\t2\t0.3.3\t')?.dev).toBe(false)
  })

  it('still understands a pad that sends no firmware version', () => {
    expect(parseHello('HELLO\t2')).toEqual({ protocol: 2, firmware: null, dev: false })
  })

  it('does not trust a firmware field that is not x.y.z', () => {
    expect(parseHello('HELLO\t2\tbeta')).toEqual({ protocol: 2, firmware: null, dev: false })
    expect(parseHello('HELLO\t2\t1.2')).toEqual({ protocol: 2, firmware: null, dev: false })
    expect(parseHello('HELLO\t2\t1.2.3-rc1')).toEqual({ protocol: 2, firmware: null, dev: false })
    expect(parseHello('HELLO\t2\t')).toEqual({ protocol: 2, firmware: null, dev: false })
  })

  it('ignores everything else', () => {
    expect(parseHello('HELLO')).toBeNull()
    expect(parseHello('HELLO\tx')).toBeNull()
    expect(parseHello('OK')).toBeNull()
  })
})

describe('parseEvent', () => {
  it('reads a profile change and key presses', () => {
    expect(parseEvent('EVT\tlayer\t2')).toEqual({ kind: 'layer', index: 2 })
    expect(parseEvent('EVT\tkey\t5\t1')).toEqual({ kind: 'key', index: 5, down: true })
    expect(parseEvent('EVT\tkey\t5\t0\r')).toEqual({ kind: 'key', index: 5, down: false })
  })

  it('reads the extra layer of the Studio profile that is on top', () => {
    expect(parseEvent('EVT\tsub\t0')).toEqual({ kind: 'sub', index: 0 })
    expect(parseEvent('EVT\tsub\t2\r')).toEqual({ kind: 'sub', index: 2 })
    expect(parseEvent('EVT\tsub\t3')).toBeNull() // a profile has at most 2 extra layers
    expect(parseEvent('EVT\tsub\t-1')).toBeNull()
  })

  it('reads knob turns and presses', () => {
    expect(parseEvent('EVT\tknob\tcw')).toEqual({ kind: 'knob', action: 'cw' })
    expect(parseEvent('EVT\tknob\tccw')).toEqual({ kind: 'knob', action: 'ccw' })
    expect(parseEvent('EVT\tknob\tpress\r')).toEqual({ kind: 'knob', action: 'press' })
  })

  it('drops knob events it does not know', () => {
    expect(parseEvent('EVT\tknob\tleft')).toBeNull()
    expect(parseEvent('EVT\tknob\t')).toBeNull()
    expect(parseEvent('EVT\tknob')).toBeNull()
    expect(parseEvent('EVT\tknob\tCW')).toBeNull()
  })

  it('drops malformed or out of range events', () => {
    expect(parseEvent('EVT\tlayer\t9')).toBeNull() // the pad holds at most 4 profiles
    expect(parseEvent('EVT\tkey\t12\t1')).toBeNull() // keys are 0-11
    expect(parseEvent('EVT\tkey\t3\t2')).toBeNull()
    expect(parseEvent('EVT\tkey\t-1\t1')).toBeNull()
    expect(parseEvent('EVT\tknob\t1')).toBeNull() // a knob event names an action, not a number
    expect(parseEvent('EVT\tdial\tcw')).toBeNull()
    expect(parseEvent('PONG')).toBeNull()
  })
})

describe('DeviceSession events', () => {
  const json = JSON.stringify(defaultConfig())

  it('learns the pad version from HELLO', async () => {
    const link = new MockLink()
    const s = new DeviceSession(link)
    const seen: HelloInfo[] = []
    s.onHello((info) => seen.push(info))
    expect(s.version).toBe(1) // until the pad says otherwise
    expect(s.firmware).toBeNull()
    s.hello()
    await new Promise((r) => setTimeout(r, 30))
    expect(s.version).toBe(PROTOCOL_VERSION)
    expect(s.firmware).toBe(REQUIRED_FIRMWARE)
    expect(seen).toEqual([{ protocol: PROTOCOL_VERSION, firmware: REQUIRED_FIRMWARE, dev: true }])
  })

  it('an older pad that ignores HELLO leaves the session at version 1', async () => {
    const link = new MockLink()
    const realWrite = link.write.bind(link)
    link.write = (line) => {
      if (line !== 'HELLO') realWrite(line)
    }
    const s = new DeviceSession(link)
    s.hello()
    await new Promise((r) => setTimeout(r, 30))
    expect(s.version).toBe(1)
  })

  it('delivers events as they arrive', () => {
    const link = new MockLink()
    const s = new DeviceSession(link)
    const got: PadEvent[] = []
    s.onEvent((e) => got.push(e))
    link.emit('EVT\tlayer\t1')
    link.emit('EVT\tkey\t4\t1')
    link.emit('EVT\tkey\t4\t0')
    link.emit('EVT\tknob\tcw')
    expect(got).toEqual([
      { kind: 'layer', index: 1 },
      { kind: 'key', index: 4, down: true },
      { kind: 'key', index: 4, down: false },
      { kind: 'knob', action: 'cw' }
    ])
  })

  it('an event in the middle of a push is not taken for the push reply', async () => {
    const link = new MockLink()
    const s = new DeviceSession(link)
    const got: PadEvent[] = []
    s.onEvent((e) => got.push(e))
    const push = s.push(json)
    link.emit('EVT\tkey\t0\t1') // arrives while the app waits for the pad's OK
    link.emit('EVT\tlayer\t3')
    expect(await push).toEqual({ ok: true })
    expect(got).toHaveLength(2)
  })

  it('an event in the middle of a pull does not break it', async () => {
    const link = new MockLink()
    const s = new DeviceSession(link)
    await s.push(json)
    const pull = s.pull()
    link.emit('EVT\tkey\t2\t1')
    expect((await pull).ok).toBe(true)
  })
})
