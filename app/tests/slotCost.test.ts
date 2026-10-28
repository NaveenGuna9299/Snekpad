import { describe, expect, it } from 'vitest'
import { blankProfile, defaultConfig, type Action } from '../src/shared/config'
import { SLOT_BUDGET, actionCost, profileCost, slotBudget, slotFit } from '../src/shared/slotCost'

// The estimate is fitted to what a real pad did (see slotCost.ts). These tests keep it close to those measurements and
// make sure it moves the right way when a profile gets bigger.

const hot = (...keys: string[]): Action => ({ type: 'hotkey', keys })
const seq = (steps: string[][], wait = 100): Action => ({
  type: 'sequence',
  steps: steps.map((keys, i) => ({ keys, wait: i < steps.length - 1 ? wait : 0 }))
})

describe('what an action costs on the pad', () => {
  it('plain keys, media keys and nothing cost nothing', () => {
    for (const a of [
      { type: 'key', key: 'A' },
      { type: 'consumer', code: 'MUTE' },
      { type: 'none' },
      { type: 'fn' }
    ] as Action[])
      expect(actionCost(a)).toBe(0)
  })

  it('a shortcut of modifiers and one key is cheap and grows with its modifiers', () => {
    expect(actionCost(hot('F12'))).toBe(0)
    expect(actionCost(hot('CTRL', 'C'))).toBe(28)
    expect(actionCost(hot('CTRL', 'SHIFT', 'P'))).toBe(56)
  })

  it('a shortcut that needs a macro (two ordinary keys, or only modifiers) costs a lot more', () => {
    expect(actionCost(hot('A', 'B'))).toBe(60 + 58 * 4)
    expect(actionCost(hot('CTRL', 'SHIFT'))).toBe(60 + 58 * 4)
  })

  it('typed text costs its macro, its letters and the Enter', () => {
    expect(actionCost({ type: 'text', text: 'git status' })).toBe(60 + 10)
    expect(actionCost({ type: 'text', text: 'git status', enter: true })).toBe(60 + 10 + 58)
  })

  it('a sequence costs a macro step for every press, release, tap and pause between steps', () => {
    // UP then ENTER: two taps and one pause
    expect(actionCost(seq([['UP'], ['ENTER']]))).toBe(60 + 58 * 3)
    // no pause: two taps
    expect(actionCost(seq([['UP'], ['ENTER']], 0))).toBe(60 + 58 * 2)
    // two-key combos: 4 steps each
    expect(
      actionCost(
        seq([
          ['CTRL', 'K'],
          ['CTRL', 'D']
        ])
      )
    ).toBe(60 + 58 * (4 + 4 + 1))
  })

  it('a longer sequence costs more, and a pause after the last step costs nothing', () => {
    const three = seq([['A'], ['B'], ['C']])
    const six = seq([['A'], ['B'], ['C'], ['D'], ['E'], ['F']])
    expect(actionCost(six)).toBeGreaterThan(actionCost(three))
    const last = { type: 'sequence', steps: [{ keys: ['A'], wait: 900 }] } as Action
    expect(actionCost(last)).toBe(60 + 58)
  })
})

describe('the estimate against the starter profiles measured on a real pad', () => {
  // measured: they leave 384, 448 and 1200 bytes less free than a profile of plain keys
  const c = defaultConfig()
  const [, vscode, terminal] = c.profiles
  const browser = c.studioProfiles[0]

  it('is within about a third of each measurement', () => {
    const near = (got: number, measured: number): void => {
      expect(got).toBeGreaterThan(measured * 0.6)
      expect(got).toBeLessThan(measured * 1.4)
    }
    near(profileCost(browser), 384)
    near(profileCost(vscode), 448)
    near(profileCost(terminal), 1200)
  })

  it('puts the starter profiles in the right order', () => {
    expect(profileCost(terminal)).toBeGreaterThan(profileCost(vscode))
    expect(profileCost(vscode)).toBeGreaterThan(0)
  })
})

describe('the room the pad has for a Studio-only profile', () => {
  it('is the whole budget when the pad only has General', () => {
    const c = defaultConfig()
    c.profiles = [c.profiles[0]]
    expect(slotBudget(c)).toBe(SLOT_BUDGET)
  })

  it('shrinks with every other profile on the pad, to about 12.8 KB with the starter three', () => {
    // measured on firmware 0.6.0 with only General on the pad: a plain Studio-only profile leaves 18592 bytes free, so 16.6 KB
    // above the 2 KB the pad keeps back (0.5.0 left 8.3 KB: the main screen page no longer uses Labels). The starter three
    // is the General budget less what VS Code / Terminal and their lists take: derived, not measured.
    const b = slotBudget(defaultConfig())
    expect(b).toBeGreaterThan(11000)
    expect(b).toBeLessThan(14500)
  })

  it('never goes below zero', () => {
    const c = defaultConfig()
    for (let i = 0; i < 12; i++)
      c.profiles[1].keys[i].action = {
        type: 'sequence',
        steps: Array(6).fill({ keys: ['A', 'B'], wait: 100 })
      }
    expect(slotBudget(c)).toBe(0)
  })
})

describe('does it fit', () => {
  it('a small profile is ok, even next to the pad’s own three', () => {
    const c = defaultConfig()
    expect(slotFit(c.studioProfiles[0], c).level).toBe('ok')
  })

  it('a profile of many long sequences is over', () => {
    const c = defaultConfig()
    const p = blankProfile('big', 'Big')
    for (let i = 0; i < 11; i++)
      p.keys[i].action = seq(Array(6).fill(['CTRL', 'SHIFT', 'ALT', 'K']))
    expect(slotFit(p, c).level).toBe('over')
  })

  it('a profile full of typed text still fits when only General is on the pad (eleven long texts loaded fine on a real pad)', () => {
    const c = defaultConfig()
    c.profiles = [c.profiles[0]]
    const p = blankProfile('texts', 'Texts')
    for (let i = 0; i < 11; i++)
      p.keys[i].action = { type: 'text', text: 'echo ' + 'x'.repeat(60), enter: true }
    expect(slotFit(p, c).level).not.toBe('over')
  })

  it('grows from ok to tight to over as sequences are added', () => {
    const c = defaultConfig()
    c.profiles = [c.profiles[0]] // only General on the pad: the most room
    const p = blankProfile('grow', 'Grow')
    const levels: string[] = []
    for (let i = 0; i < 11; i++) {
      p.keys[i].action = seq(Array(6).fill(['CTRL', 'SHIFT', 'ALT', 'K']))
      levels.push(slotFit(p, c).level)
    }
    expect(levels[0]).toBe('ok')
    expect(new Set(levels)).toEqual(new Set(['ok', 'tight', 'over']))
    expect(levels.at(-1)).toBe('over')
  })

  it('with no room at all an empty profile is still ok and anything with a macro is over', () => {
    const c = defaultConfig()
    for (let i = 0; i < 12; i++)
      c.profiles[1].keys[i].action = {
        type: 'sequence',
        steps: Array(6).fill({ keys: ['A', 'B'], wait: 100 })
      }
    const p = blankProfile('x', 'X')
    expect(slotFit(p, c).level).toBe('ok')
    p.keys[0].action = hot('CTRL', 'C')
    expect(slotFit(p, c).level).toBe('over')
  })
})
