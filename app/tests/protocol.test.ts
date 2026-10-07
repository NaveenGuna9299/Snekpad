import { describe, expect, it } from 'vitest'
import { appLine, ConfigReceiver, configFrames, crcHex, parseReply } from '../src/shared/protocol'
import { MockLink } from '../src/main/device/mockLink'
import { defaultConfig } from '../src/shared/config'

describe('protocol', () => {
  it('builds one-line ASCII APP messages', () => {
    expect(appLine('Code.exe', 'a\tb\nc é')).toBe('APP\tCode.exe\ta b c ?')
  })

  it('parses replies', () => {
    expect(parseReply('PONG').kind).toBe('pong')
    expect(parseReply('OK').kind).toBe('ok')
    expect(parseReply('ERR\tcrc mismatch')).toEqual({ kind: 'err', reason: 'crc mismatch' })
  })

  it('round-trips a config through the receiver', () => {
    const json = JSON.stringify(defaultConfig())
    const rx = new ConfigReceiver()
    const replies = configFrames(json).map((l) => rx.handle(l))
    expect(replies[0]).toBe('OK')
    expect(replies[replies.length - 1]).toBe('OK')
    expect(rx.received).toBe(json)
  })

  it('detects corruption', () => {
    const json = JSON.stringify(defaultConfig())
    const frames = configFrames(json)
    frames[2] = frames[2].replace('a', 'b')
    const rx = new ConfigReceiver()
    const last = frames.map((l) => rx.handle(l)).pop()
    expect(last).toMatch(/^ERR/)
  })

  it('detects a missing chunk', () => {
    const frames = configFrames(JSON.stringify(defaultConfig()))
    frames.splice(2, 1)
    const rx = new ConfigReceiver()
    expect(frames.map((l) => rx.handle(l)).pop()).toBe('ERR\tlength mismatch')
  })

  it('crc is stable', () => {
    expect(crcHex('123456789')).toBe('cbf43926')
  })

  it('mock pad stores a pushed config', async () => {
    const mock = new MockLink()
    const got: string[] = []
    mock.onLine((l) => got.push(l))
    const json = JSON.stringify(defaultConfig())
    for (const l of configFrames(json)) mock.write(l)
    await new Promise((r) => setTimeout(r, 30))
    expect(mock.config).toBe(json)
    expect(got.filter((l) => l === 'OK').length).toBe(2)
  })
})

import { hostOsFrom, osLine } from '../src/shared/protocol'
import { resolveForOs } from '../src/shared/config'

describe('host OS', () => {
  it('maps platforms and builds the OS line', () => {
    expect(hostOsFrom('win32')).toBe('windows')
    expect(hostOsFrom('darwin')).toBe('macos')
    expect(hostOsFrom('linux')).toBe('linux')
    expect(osLine('macos')).toBe('OS\tmacos')
  })

  it('swaps CTRL for GUI only on macOS and only where asked', () => {
    const c = defaultConfig()
    c.profiles[0].keys[0].action = { type: 'hotkey', keys: ['CTRL', 'C'], cmdOnMac: true }
    const mac = resolveForOs(c, 'macos')
    expect(mac.profiles[0].keys[0].action).toEqual({
      type: 'hotkey',
      keys: ['GUI', 'C'],
      cmdOnMac: true
    })
    expect(mac.profiles[0].keys[1].action).toEqual(c.profiles[0].keys[1].action) // not marked, unchanged
    expect(resolveForOs(c, 'windows')).toBe(c)
    expect(c.profiles[0].keys[0].action).toEqual({
      type: 'hotkey',
      keys: ['CTRL', 'C'],
      cmdOnMac: true
    }) // original untouched
  })
})
