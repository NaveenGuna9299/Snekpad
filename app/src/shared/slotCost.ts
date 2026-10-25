// How much of the pad's memory a Studio-only profile will take when it is on the pad's slot, so the editor can say
// "this will not fit" before the pad does (it refuses a profile that would leave under 2 KB free: see SLOT_MIN_FREE in
// Programs/app_profiles.py).
//
// This is an ESTIMATE, fitted to what a real pad did (CircuitPython 10.3.1, firmware 0.5.0):
//   - a macro step the pad keeps (a key press, a release, a tap or a pause) is about 58 bytes, a macro itself about 60
//   - a shortcut of modifiers and one key is a single key the pad builds in one piece: about 28 bytes per modifier
//   - Browser, VS Code and Terminal leave 384, 448 and 1200 bytes less free than a profile of plain keys
//   - a plain profile on the slot leaves about 8.3 KB free when the pad's own profiles are only General, and each
//     other profile on the pad takes away its own cost plus about 800 bytes of lists and strings
// It is good to roughly a third, which is why the editor says "about" and keeps a margin before it calls a profile too big.

import type { Action, Config, Profile } from './config'

const MACRO_OBJECT = 58 // one step of a macro
const MACRO = 60 // the macro itself
const MODIFIER = 28 // one modifier wrapped around a key
const PAD_PROFILE_OVERHEAD = 800 // lists and strings of a profile the pad keeps itself

/** Bytes the slot has for a profile's keys when the pad's own profiles are only General (free RAM minus the 2 KB the pad keeps back). */
export const SLOT_BUDGET = 6350

const MODIFIERS = new Set(['CTRL', 'SHIFT', 'ALT', 'GUI'])

/** The macro steps the pad makes for keys pressed together: a single key is one tap, a combo is a press and a release each. */
const holdObjects = (keys: readonly string[]): number => (keys.length === 1 ? 1 : 2 * keys.length)

/** The memory one action takes on the pad, in bytes (estimate). */
export function actionCost(a: Action): number {
  switch (a.type) {
    case 'hotkey': {
      const others = a.keys.filter((k) => !MODIFIERS.has(k)).length
      // modifiers and exactly one other key: one composite key. Anything else is a macro of presses and releases
      if (others === 1) return (a.keys.length - 1) * MODIFIER
      return MACRO + MACRO_OBJECT * holdObjects(a.keys)
    }
    case 'text':
      return MACRO + a.text.length + (a.enter ? MACRO_OBJECT : 0)
    case 'sequence': {
      let objects = 0
      a.steps.forEach((s, i) => {
        objects += holdObjects(s.keys)
        if (i < a.steps.length - 1 && s.wait > 0) objects++ // a pause only between steps
      })
      return MACRO + MACRO_OBJECT * objects
    }
    default:
      return 0 // a plain key, a media key, nothing: the pad shares one object for each
  }
}

/** The memory a whole profile takes: its 12 keys and the knob's three actions. */
export function profileCost(p: Profile): number {
  const { cw, ccw, press } = p.encoder
  return [...p.keys.map((k) => k.action), cw, ccw, press].reduce((n, a) => n + actionCost(a), 0)
}

/** What the pad has for a Studio-only profile: the budget, less what the pad's own profiles (other than General) already use. */
export function slotBudget(config: Config): number {
  const own = config.profiles
    .filter((p) => p.id !== 'general')
    .reduce((n, p) => n + profileCost(p) + PAD_PROFILE_OVERHEAD, 0)
  return Math.max(0, SLOT_BUDGET - own)
}

export type SlotFit = {
  used: number
  budget: number
  /** ok: plenty of room. tight: close to what the pad can take. over: the pad would probably refuse it. */
  level: 'ok' | 'tight' | 'over'
}

export function slotFit(profile: Profile, config: Config): SlotFit {
  const used = profileCost(profile)
  const budget = slotBudget(config)
  // the estimate is only good to about a third: "over" starts a little before the budget is used up
  const ratio = used === 0 ? 0 : budget === 0 ? Infinity : used / budget
  return { used, budget, level: ratio >= 0.9 ? 'over' : ratio >= 0.6 ? 'tight' : 'ok' }
}
