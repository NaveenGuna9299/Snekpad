import { describe, expect, it } from 'vitest'
import { defaultConfig, MAX_SLEEP_MINUTES } from '../src/shared/config'
import {
  applyLiveView,
  liveViewOf,
  liveViewSchema,
  ConfigReceiver,
  configFrames
} from '../src/shared/protocol'

describe('live view (GET_CFG)', () => {
  it('survives the CFG_* framing the firmware uses', () => {
    const json = JSON.stringify(liveViewOf(defaultConfig()))
    const rx = new ConfigReceiver()
    for (const f of configFrames(json)) rx.handle(f)
    expect(liveViewSchema.safeParse(JSON.parse(rx.received)).success).toBe(true)
  })

  it('lays the pad labels and colours over the saved config but keeps actions', () => {
    const saved = defaultConfig()
    const view = liveViewOf(saved)
    view.p[0].l[0] = 'NEW'
    view.p[0].c[0] = '#112233'
    view.p[0].k = 'KNOB:X'
    const out = applyLiveView(saved, view)
    expect(out.profiles[0].keys[0].label).toBe('NEW')
    expect(out.profiles[0].keys[0].color).toBe('#112233')
    expect(out.profiles[0].encoder.label).toBe('KNOB:X')
    expect(out.profiles[0].keys[0].action).toEqual(saved.profiles[0].keys[0].action)
  })

  it('takes the pad sleep time from what the pad reports', () => {
    const saved = defaultConfig()
    expect(saved.settings.sleepMinutes).toBe(2)
    const view = liveViewOf(saved)
    view.s = 9
    expect(applyLiveView(saved, view).settings.sleepMinutes).toBe(9)
    view.s = 0 // never
    expect(applyLiveView(saved, view).settings.sleepMinutes).toBe(0)
    expect(saved.settings.sleepMinutes).toBe(2) // the saved config itself is not changed
  })

  it('reports the sleep time of the config it describes', () => {
    const c = defaultConfig()
    c.settings.sleepMinutes = 11
    expect(liveViewOf(c).s).toBe(11)
  })

  it('keeps the saved sleep time when an older pad does not report one', () => {
    const saved = defaultConfig()
    saved.settings.sleepMinutes = 4
    const view = liveViewSchema.parse(
      JSON.parse(JSON.stringify({ ...liveViewOf(saved), s: undefined }))
    )
    expect(view.s).toBeUndefined()
    expect(applyLiveView(saved, view).settings.sleepMinutes).toBe(4)
  })

  it('ignores a sleep time that makes no sense instead of rejecting the whole view', () => {
    for (const bad of [-1, MAX_SLEEP_MINUTES + 1, 1.5, '3', null]) {
      const raw = { ...JSON.parse(JSON.stringify(liveViewOf(defaultConfig()))), s: bad }
      const parsed = liveViewSchema.safeParse(raw)
      expect(parsed.success, String(bad)).toBe(true)
      if (parsed.success) expect(parsed.data.s, String(bad)).toBeUndefined()
    }
  })

  it('accepts what the firmware sends: the compact JSON with "s"', () => {
    const json = JSON.stringify({ ...liveViewOf(defaultConfig()), s: 1 })
    expect(liveViewSchema.parse(JSON.parse(json)).s).toBe(1)
  })

  it('leaves profiles the pad does not report untouched', () => {
    const saved = defaultConfig()
    const view = liveViewOf(saved)
    view.p = view.p.slice(0, 1)
    expect(applyLiveView(saved, view).profiles[2]).toEqual(saved.profiles[2])
  })
})
