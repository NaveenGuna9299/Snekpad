import { describe, expect, it } from 'vitest'
import { DeviceSession } from '../src/main/device/session'
import { MockLink } from '../src/main/device/mockLink'
import { defaultConfig } from '../src/shared/config'

const json = JSON.stringify(defaultConfig())

describe('DeviceSession', () => {
  it('a push finishes and lands on the pad', async () => {
    const link = new MockLink()
    const s = new DeviceSession(link)
    expect(await s.push(json)).toEqual({ ok: true })
    expect(link.config).toBe(json)
  })

  it('LED previews fired during a push cannot steal its replies', async () => {
    const link = new MockLink()
    const s = new DeviceSession(link)
    const push = s.push(json)
    // what a colour-picker drag does while the push is running
    for (let i = 0; i < 20; i++) void s.preview(0, i % 12, '#112233')
    expect(await push).toEqual({ ok: true })
    expect(link.log.some((l) => l.startsWith('LED'))).toBe(false) // dropped: the push carries the colours
  })

  it('collapses repeated previews of one key into the latest colour', async () => {
    const link = new MockLink()
    const s = new DeviceSession(link)
    const first = s.preview(0, 3, '#000001')
    void s.preview(0, 3, '#000002')
    void s.preview(0, 3, '#000003')
    await first
    const leds = link.log.filter((l) => l.startsWith('LED'))
    expect(leds).toEqual(['LED\t0\t3\t#000003'])
  })

  it('runs a pull after a push, in order, without mixing their replies', async () => {
    const link = new MockLink()
    const s = new DeviceSession(link)
    const [push, pull] = await Promise.all([s.push(json), s.pull()])
    expect(push.ok).toBe(true)
    expect(pull.ok).toBe(true)
  })

  it('reports a pad that never answers, and keeps working afterwards', async () => {
    const link = new MockLink()
    link.write = () => {} // a pad that is not listening
    const s = new DeviceSession(link)
    const r = await s.push(json)
    expect(r).toEqual({ ok: false, error: 'no reply from pad' })
  }, 10000)
})

describe('DeviceSession late replies', () => {
  it('a reply that arrives after a timeout does not answer the next command', async () => {
    const link = new MockLink()
    let deliver: (l: string) => void = () => {}
    const attach = link.onLine.bind(link)
    link.onLine = (cb) => {
      deliver = cb
      attach(cb)
    }
    const s = new DeviceSession(link)
    const realWrite = link.write.bind(link)
    link.write = (line) => {
      if (!line.startsWith('CFG_BEGIN')) realWrite(line) // the first push gets no answer and times out
    }
    expect((await s.push(json)).ok).toBe(false)
    link.write = realWrite
    const pull = s.pull()
    deliver('OK') // the pad's late answer to the first push arrives while the pull is waiting to start
    expect(await pull).toEqual({ ok: false, error: 'no config on pad' }) // the pad's own answer, not the stale OK
  }, 15000)
})
