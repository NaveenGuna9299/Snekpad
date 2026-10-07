import { describe, expect, it } from 'vitest'
import { DeviceSession } from '../src/main/device/session'
import { MockLink } from '../src/main/device/mockLink'
import { defaultConfig } from '../src/shared/config'
import { PROTOCOL_VERSION, parseEvent, parseHello, type PadEvent } from '../src/shared/protocol'

describe('parseHello', () => {
  it('reads the version', () => {
    expect(parseHello('HELLO\t2')).toBe(2)
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

  it('drops malformed or out of range events', () => {
    expect(parseEvent('EVT\tlayer\t9')).toBeNull() // the pad holds at most 4 profiles
    expect(parseEvent('EVT\tkey\t12\t1')).toBeNull() // keys are 0-11
    expect(parseEvent('EVT\tkey\t3\t2')).toBeNull()
    expect(parseEvent('EVT\tkey\t-1\t1')).toBeNull()
    expect(parseEvent('EVT\tknob\t1')).toBeNull()
    expect(parseEvent('PONG')).toBeNull()
  })
})

describe('DeviceSession events', () => {
  const json = JSON.stringify(defaultConfig())

  it('learns the pad version from HELLO', async () => {
    const link = new MockLink()
    const s = new DeviceSession(link)
    const seen: number[] = []
    s.onHello((v) => seen.push(v))
    expect(s.version).toBe(1) // until the pad says otherwise
    s.hello()
    await new Promise((r) => setTimeout(r, 30))
    expect(s.version).toBe(PROTOCOL_VERSION)
    expect(seen).toEqual([PROTOCOL_VERSION])
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
    expect(got).toEqual([
      { kind: 'layer', index: 1 },
      { kind: 'key', index: 4, down: true },
      { kind: 'key', index: 4, down: false }
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
