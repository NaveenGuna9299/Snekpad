import { describe, expect, it } from 'vitest'
import { defaultConfig } from '../src/shared/config'
import { applyLiveView, liveViewOf, liveViewSchema, ConfigReceiver, configFrames } from '../src/shared/protocol'

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

  it('leaves profiles the pad does not report untouched', () => {
    const saved = defaultConfig()
    const view = liveViewOf(saved)
    view.p = view.p.slice(0, 1)
    expect(applyLiveView(saved, view).profiles[2]).toEqual(saved.profiles[2])
  })
})
