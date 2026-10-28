// SnekPad config: types, limits, validation, migration and the starter profiles.
// Shared by the main process (save/push) and the renderer (editing).
//
// Key names in actions (CTRL, SHIFT, ALT, GUI, C, GRV, SLSH, PGUP, F12 ...) are KMK
// key names without the "KC." prefix, so the firmware can look them up directly.

import { z } from 'zod'

export const SCHEMA_VERSION = 1
export const ROWS = 3
export const COLS = 4
export const KEY_COUNT = ROWS * COLS // key index = row * COLS + column
export const MAX_PROFILES = 3 // profiles the pad keeps itself (firmware memory limit), General included
export const MAX_STUDIO_PROFILES = 7 // more profiles that only Studio keeps: the pad gets one when its app is in focus
export const MAX_ALL_PROFILES = MAX_PROFILES + MAX_STUDIO_PROFILES
export const MAX_TITLE_WORDS = 6 // words in a profile's window-title rule
export const TITLE_WORD_MAX = 30 // characters in one of them
export const LABEL_MAX = 5 // characters that fit one OLED legend cell
export const MAX_COMBO = 6 // keys pressed together in one shortcut
export const MAX_STEPS = 6 // keys / shortcuts in one sequence
export const MAX_WAIT_MS = 2000 // longest pause between two steps
export const DEFAULT_WAIT_MS = 100
export const MAX_LAYERS = 2 // extra 12-key layers a Studio-only profile may have (SLOT_LAYERS in Programs/config_loader.py); the pad's own profiles have none
export const MIN_TAP_MS = 100 // tap / hold / double-tap timing, in ms (the same limits as the firmware)
export const MAX_TAP_MS = 1000
export const DEFAULT_TAP_MS = 250
export const FN_KEY = 11 // bottom-right key is always the utility (FN) layer key
export const DEFAULT_SLEEP_MINUTES = 2 // idle minutes before the pad's screen and key LEDs switch off
export const MAX_SLEEP_MINUTES = 60 // 0 = never sleep

// How the key LEDs behave. The names are the same as EFFECTS in Programs/config_loader.py (the firmware also knows
// 'breathing' and 'cycle', which Studio does not offer). `colors` says where an effect's colours come from:
// 'perKey' (each profile's key colours) or 'none' (the effect makes its own). Equalizer and Beat pulse react to
// the sound the computer plays: Studio listens and sends the pad the levels.
export const EFFECTS = [
  {
    id: 'static',
    label: 'Static',
    colors: 'perKey',
    text: 'Each key keeps the colour you gave it.'
  },
  {
    id: 'equalizer',
    label: 'Equalizer',
    colors: 'none',
    text: 'The four columns are bass to treble and fill up from the bottom row as the music gets louder.'
  },
  {
    id: 'beat',
    label: 'Beat pulse',
    colors: 'none',
    text: 'All the keys flash on the beat of the music, and the colour moves on with every beat.'
  },
  {
    id: 'rainbow',
    label: 'Rainbow',
    colors: 'none',
    text: 'A wave of rainbow colour sweeps across the keys.'
  },
  {
    id: 'ripple',
    label: 'Ripple',
    colors: 'none',
    text: 'Pressing a key sends a ring of a random colour spreading across the pad.'
  },
  {
    id: 'starry',
    label: 'Starry night',
    colors: 'none',
    text: 'Random keys twinkle in random colours.'
  }
] as const
export type EffectId = (typeof EFFECTS)[number]['id']
export const DEFAULT_EFFECT: EffectId = 'static'
/** Effects that follow the sound the computer plays (Studio has to be running to feed them). */
export const isMusicEffect = (id: EffectId): boolean => id === 'equalizer' || id === 'beat'
const effectIds = EFFECTS.map((e) => e.id) as [EffectId, ...EffectId[]]

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colour must look like #RRGGBB')
const keyName = z.string().regex(/^[A-Z0-9_]{1,12}$/, 'key names are upper case, e.g. CTRL, C, F12')

// The actions that just press something. tap_hold uses these for what a tap, a hold and a double-tap do.
const plainActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('key'), key: keyName }),
  z.object({
    type: z.literal('hotkey'),
    keys: z.array(keyName).min(1).max(MAX_COMBO), // all pressed together
    cmdOnMac: z.boolean().optional() // swap CTRL for GUI on macOS
  }),
  z.object({ type: z.literal('text'), text: z.string().max(80), enter: z.boolean().optional() }),
  // Sequence: up to 6 steps pressed one after the other. Each step is a key or a shortcut, and
  // `wait` is the pause in ms before the NEXT step (ignored on the last step).
  z.object({
    type: z.literal('sequence'),
    steps: z
      .array(
        z.object({
          keys: z.array(keyName).min(1).max(MAX_COMBO),
          wait: z.number().int().min(0).max(MAX_WAIT_MS)
        })
      )
      .min(1)
      .max(MAX_STEPS),
    cmdOnMac: z.boolean().optional()
  }),
  z.object({ type: z.literal('consumer'), code: keyName })
])

// Goes to the profile's extra layer while held ('hold') or switches to it and back ('toggle'). Layer 0 is the main keys:
// a key on an extra layer that goes back to them (the mode does not matter then).
const layerActionSchema = z.object({
  type: z.literal('layer'),
  mode: z.enum(['hold', 'toggle']),
  layer: z.number().int().min(0).max(MAX_LAYERS)
})

const tapMs = z.number().int().min(MIN_TAP_MS).max(MAX_TAP_MS)

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('fn') }), // reserved for FN_KEY
  z.object({ type: z.literal('layer_next') }), // legacy: old knob press. Migrated away; holding the knob now opens the profile switcher
  layerActionSchema,
  ...plainActionSchema.options,
  // One key, several actions: a tap does `tap`, holding does `hold` (which may be a layer key), and tapping twice
  // does `double`. At least one of hold and double is needed. `ms` is the hold time / the window for the second tap.
  z.object({
    type: z.literal('tap_hold'),
    tap: plainActionSchema,
    hold: z.union([plainActionSchema, layerActionSchema]).optional(),
    double: plainActionSchema.optional(),
    ms: tapMs.optional()
  })
])
export type Action = z.infer<typeof actionSchema>

export const keySchema = z.object({
  label: z.string().max(LABEL_MAX, `labels are at most ${LABEL_MAX} characters`),
  color: hexColor,
  action: actionSchema
})
export type KeyConfig = z.infer<typeof keySchema>

const layerSchema = z.object({ keys: z.array(keySchema).length(KEY_COUNT) })
export type LayerConfig = z.infer<typeof layerSchema>

export const profileSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,24}$/),
  name: z.string().min(1).max(12), // fits the OLED top bar
  match: z.object({
    windows: z.array(z.string()).max(12), // process names, lower case, no .exe
    macos: z.array(z.string()).max(12), // bundle ids
    titles: z.array(z.string().max(TITLE_WORD_MAX)).max(MAX_TITLE_WORDS) // words in the window title
  }),
  keys: z.array(keySchema).length(KEY_COUNT),
  // Extra layers (at most MAX_LAYERS), reached with a layer key. Only Studio-only profiles may have them: the pad's own
  // profiles are built at start-up, where the screen needs the RAM. A profile saved before they existed has none.
  layers: z.array(layerSchema).max(MAX_LAYERS).default([]),
  encoder: z.object({
    label: z.string().max(10), // top-bar hint, e.g. KNOB:VOL
    cw: actionSchema,
    ccw: actionSchema,
    // Short press (released before the hold time). Holding the knob opens the profile switcher.
    press: actionSchema,
    pressLabel: z.string().max(LABEL_MAX, `labels are at most ${LABEL_MAX} characters`).default('') // shown on the pad while the knob is held
  })
})
export type Profile = z.infer<typeof profileSchema>

// A profile saved for later use (built-in presets and the user's own share this shape).
export const templateSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(12),
  note: z.string().max(80),
  profile: profileSchema.omit({ id: true })
})
export type Template = z.infer<typeof templateSchema>

export const configSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    device: z.object({
      name: z.string().max(24),
      owner_screen: z.object({
        line1: z.string().max(10),
        line2: z.string().max(10),
        date: z.string().max(10)
      }),
      oled: z.object({ width: z.literal(128), height: z.literal(32).catch(32) })
    }),
    settings: z.object({
      brightness: z.number().min(0.05).max(0.5),
      // idle minutes before the screen and key LEDs switch off (they dim at half that time); 0 = never.
      // A config saved before this setting existed gets the default.
      sleepMinutes: z.number().int().min(0).max(MAX_SLEEP_MINUTES).default(DEFAULT_SLEEP_MINUTES),
      // the key LED effect; a config saved before effects existed gets static, and so does one saved while
      // Studio still offered Breathing or Color Cycle (taken out again: the pad's brightness steps are too few
      // for a slow fade at the dimmest levels)
      effect: z.preprocess(
        (v) => (v === 'breathing' || v === 'cycle' ? DEFAULT_EFFECT : v),
        z.enum(effectIds).default(DEFAULT_EFFECT)
      )
    }),
    profiles: z.array(profileSchema).min(1).max(MAX_PROFILES),
    // Profiles that only Studio keeps (never sent in a push). A config saved before they existed has none.
    studioProfiles: z.array(profileSchema).max(MAX_STUDIO_PROFILES).default([])
  })
  .superRefine((cfg, ctx) => {
    if (cfg.profiles[0].id !== 'general') {
      ctx.addIssue({
        code: 'custom',
        message: 'the first profile must be General',
        path: ['profiles', 0]
      })
    }
    const ids = new Set<string>()
    const check = (list: 'profiles' | 'studioProfiles'): void =>
      cfg[list].forEach((p, i) => {
        if (ids.has(p.id))
          ctx.addIssue({
            code: 'custom',
            message: `duplicate profile id "${p.id}"`,
            path: [list, i]
          })
        ids.add(p.id)
        if (p.keys[FN_KEY].action.type !== 'fn') {
          ctx.addIssue({
            code: 'custom',
            message: `key ${FN_KEY} must stay the FN key`,
            path: [list, i, 'keys', FN_KEY]
          })
        }
        p.layers.forEach((l, li) => {
          if (l.keys[FN_KEY].action.type !== 'fn')
            ctx.addIssue({
              code: 'custom',
              message: `key ${FN_KEY} must stay the FN key`,
              path: [list, i, 'layers', li, 'keys', FN_KEY]
            })
        })
        for (const problem of layerProblems(p))
          ctx.addIssue({ code: 'custom', message: problem, path: [list, i] })
      })
    check('profiles')
    check('studioProfiles')
    cfg.profiles.forEach((p, i) => {
      for (const problem of padProblems(p))
        ctx.addIssue({ code: 'custom', message: problem, path: ['profiles', i] })
    })
  })
export type Config = z.infer<typeof configSchema>

/** True for what only a Studio-only profile may use: a layer key, a hold that is a layer key, or a double tap. */
export const isStudioOnlyAction = (a: Action): boolean =>
  a.type === 'layer' || (a.type === 'tap_hold' && (!!a.double || a.hold?.type === 'layer'))

/** What a profile on the pad itself may not have (layers, layer keys, double tap): empty = fine. */
export function padProblems(p: Profile): string[] {
  const out: string[] = []
  if (p.layers.length > 0) out.push(`"${p.name}": layers are for Studio-only profiles`)
  if (p.keys.some((k) => isStudioOnlyAction(k.action)))
    out.push(`"${p.name}": layer keys and double tap are for Studio-only profiles`)
  return out
}

/** An action without what only Studio-only profiles may use: a layer key does nothing, a tap/hold keeps what is left. */
export function withoutStudioOnly(a: Action): Action {
  if (a.type === 'layer') return { type: 'none' }
  if (a.type !== 'tap_hold') return a
  const rest = { ...a }
  delete rest.double
  if (rest.hold?.type === 'layer') delete rest.hold
  return rest.hold ? rest : rest.tap
}

/** A profile as the pad's own list may hold it: no layers, no layer keys, no double tap. */
export function forPad(p: Profile): Profile {
  return {
    ...p,
    layers: [],
    keys: p.keys.map((k) => ({ ...k, action: withoutStudioOnly(k.action) }))
  }
}

/** What is wrong with a profile's layer keys and tap_hold keys (empty = fine). */
export function layerProblems(p: Profile): string[] {
  const out: string[] = []
  const layerKeys = (a: Action): Extract<Action, { type: 'layer' }>[] =>
    a.type === 'layer' ? [a] : a.type === 'tap_hold' && a.hold?.type === 'layer' ? [a.hold] : []
  for (const k of [...p.keys, ...p.layers.flatMap((l) => l.keys)])
    for (const l of layerKeys(k.action))
      if (l.layer > p.layers.length) out.push(`"${p.name}" has a layer key but no layer ${l.layer}`)
  const { cw, ccw, press } = p.encoder
  for (const a of [cw, ccw, press])
    if (a.type === 'layer' || a.type === 'tap_hold')
      out.push(`"${p.name}": the knob cannot use a layer key or a tap/hold key`)
  for (const k of [...p.keys, ...p.layers.flatMap((l) => l.keys)])
    if (k.action.type === 'tap_hold' && !k.action.hold && !k.action.double)
      out.push(`"${p.name}": a tap/hold key needs a hold or a double-tap`)
  return [...new Set(out)]
}

export type ValidationResult = { ok: true; config: Config } | { ok: false; errors: string[] }

export function validateConfig(input: unknown): ValidationResult {
  const r = configSchema.safeParse(input)
  if (r.success) return { ok: true, config: r.data }
  return {
    ok: false,
    errors: r.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`)
  }
}

// Upgrade older files to the current schema. Only version 1 exists so far; early builds stored
// sequences as `macro` actions with steps like 'UP' or ['CTRL','K'] and no pause, and the knob
// press was "next profile" (now the hold-to-switch profile switcher, so the press gets a real action).
export function migrateConfig(input: unknown): unknown {
  type Raw = { type?: string; steps?: unknown[] }
  type RawProfile = {
    id?: string
    keys?: { action?: Raw }[]
    encoder?: { press?: Raw; pressLabel?: string }
  }
  const cfg = input as { profiles?: RawProfile[]; studioProfiles?: RawProfile[] }
  // A config saved when the pad still kept 4 profiles: the ones that no longer fit on the pad move to Studio's own list.
  if (Array.isArray(cfg?.profiles) && cfg.profiles.length > MAX_PROFILES) {
    const extra = cfg.profiles.splice(MAX_PROFILES)
    cfg.studioProfiles = [...extra, ...(cfg.studioProfiles ?? [])].slice(0, MAX_STUDIO_PROFILES)
  }
  // layers, layer keys and double tap are for Studio-only profiles: a file saved by an early build that put them on the
  // pad's own profiles loses them (a layer key does nothing, a tap/hold key keeps its tap and hold)
  for (const p of cfg?.profiles ?? []) {
    const raw = p as { layers?: unknown; keys?: { action?: Record<string, unknown> }[] }
    if (Array.isArray(raw.layers) && raw.layers.length > 0) delete raw.layers // an empty list is already fine
    for (const k of raw.keys ?? []) {
      const a = k.action
      if (!a) continue
      if (a.type === 'layer') k.action = { type: 'none' }
      else if (a.type === 'tap_hold') {
        delete a.double
        if ((a.hold as { type?: string } | undefined)?.type === 'layer') delete a.hold
        if (!a.hold) k.action = a.tap as Record<string, unknown>
      }
    }
  }
  for (const p of [...(cfg?.profiles ?? []), ...(cfg?.studioProfiles ?? [])]) {
    const enc = p.encoder
    if (enc?.press?.type === 'layer_next') {
      const d = p.id ? KNOB_PRESS_DEFAULTS[p.id] : undefined
      enc.press = (d?.action ?? { type: 'none' }) as Raw
      enc.pressLabel = d?.label ?? ''
    }
  }
  for (const p of [...(cfg?.profiles ?? []), ...(cfg?.studioProfiles ?? [])])
    for (const k of p.keys ?? []) {
      const a = k.action
      if (!a || (a.type !== 'macro' && a.type !== 'sequence') || !Array.isArray(a.steps)) continue
      a.type = 'sequence'
      a.steps = a.steps.slice(0, MAX_STEPS).map((st, i, all) => {
        if (st && typeof st === 'object' && !Array.isArray(st)) return st
        return {
          keys: Array.isArray(st) ? st : [st],
          wait: i < all.length - 1 ? DEFAULT_WAIT_MS : 0
        }
      })
    }
  return input
}

// ------------------------------------------------------------------ starter profiles
const BLUE = '#2060FF'
const ORANGE = '#FF7000'
const CYAN = '#00C8C8'
const GREEN = '#00E060'
const PURPLE = '#A040FF'
const RED = '#FF2020'
const YELLOW = '#FFC000'
const PINK = '#FF40A0'
const WHITE = '#C0C0C0'
const DIM = '#303030'

const hot = (...keys: string[]): Action => ({ type: 'hotkey', keys })
const key = (k: string): Action => ({ type: 'key', key: k })
const typed = (text: string, enter = false): Action => ({ type: 'text', text, enter })
const K = (label: string, color: string, action: Action): KeyConfig => ({ label, color, action })
const FN = (): KeyConfig => K('FN', DIM, { type: 'fn' })
const consumer = (code: string): Action => ({ type: 'consumer', code })

// Short-press action + on-screen label per starter profile (same as the firmware defaults).
const KNOB_PRESS_DEFAULTS: Record<string, { action: Action; label: string }> = {
  general: { action: consumer('MUTE'), label: 'MUTE' },
  vscode: { action: hot('CTRL', 'S'), label: 'SAVE' },
  terminal: { action: key('ENTER'), label: 'ENTER' },
  browser: { action: consumer('MPLY'), label: 'PLAY' }
}

function general(): Profile {
  return {
    id: 'general',
    name: 'General',
    match: { windows: [], macos: [], titles: [] },
    keys: [
      K('copy', BLUE, hot('CTRL', 'C')),
      K('paste', BLUE, hot('CTRL', 'V')),
      K('cut', BLUE, hot('CTRL', 'X')),
      K('undo', ORANGE, hot('CTRL', 'Z')),
      K('redo', ORANGE, hot('CTRL', 'Y')),
      K('all', CYAN, hot('CTRL', 'A')),
      K('save', GREEN, hot('CTRL', 'S')),
      K('find', CYAN, hot('CTRL', 'F')),
      K('tab+', PURPLE, hot('CTRL', 'T')),
      K('close', RED, hot('CTRL', 'W')),
      K('snip', YELLOW, hot('GUI', 'SHIFT', 'S')),
      FN()
    ],
    layers: [],
    encoder: {
      label: 'KNOB:VOL',
      cw: consumer('VOLU'),
      ccw: consumer('VOLD'),
      press: KNOB_PRESS_DEFAULTS.general.action,
      pressLabel: KNOB_PRESS_DEFAULTS.general.label
    }
  }
}

function vscode(): Profile {
  return {
    id: 'vscode',
    name: 'VS Code',
    match: { windows: ['code', 'cursor'], macos: ['com.microsoft.VSCode'], titles: [] },
    keys: [
      K('open', CYAN, hot('CTRL', 'P')),
      K('cmd', CYAN, hot('CTRL', 'SHIFT', 'P')),
      K('term', PURPLE, hot('CTRL', 'GRV')),
      K('side', PURPLE, hot('CTRL', 'B')),
      K('cmnt', YELLOW, hot('CTRL', 'SLSH')),
      K('def', BLUE, key('F12')),
      K('find', BLUE, hot('CTRL', 'SHIFT', 'F')),
      K('debug', GREEN, key('F5')),
      K('save', GREEN, hot('CTRL', 'S')),
      K('undo', ORANGE, hot('CTRL', 'Z')),
      K('fmt', PINK, hot('SHIFT', 'ALT', 'F')),
      FN()
    ],
    layers: [],
    encoder: {
      label: 'KNOB:TAB',
      cw: hot('CTRL', 'PGDN'),
      ccw: hot('CTRL', 'PGUP'),
      press: KNOB_PRESS_DEFAULTS.vscode.action,
      pressLabel: KNOB_PRESS_DEFAULTS.vscode.label
    }
  }
}

function terminal(): Profile {
  return {
    id: 'terminal',
    name: 'Terminal',
    match: {
      windows: [
        'windowsterminal',
        'wt',
        'powershell',
        'pwsh',
        'cmd',
        'mintty',
        'git-bash',
        'conhost'
      ],
      macos: ['com.apple.Terminal', 'com.googlecode.iterm2'],
      titles: []
    },
    keys: [
      K('^C', RED, hot('CTRL', 'C')),
      K('clear', YELLOW, hot('CTRL', 'L')),
      K('rerun', ORANGE, {
        type: 'sequence',
        steps: [
          { keys: ['UP'], wait: DEFAULT_WAIT_MS },
          { keys: ['ENTER'], wait: 0 }
        ]
      }),
      K('hist', PURPLE, hot('CTRL', 'R')),
      K('stat', GREEN, typed('git status', true)),
      K('pull', GREEN, typed('git pull', true)),
      K('push', CYAN, typed('git push')),
      K('comm', CYAN, typed('git commit -m "')),
      K('dev', BLUE, typed('npm run dev', true)),
      K('test', BLUE, typed('npm test', true)),
      K('py', PINK, typed('python', true)),
      FN()
    ],
    layers: [],
    encoder: {
      label: 'KNOB:SCRL',
      cw: hot('SHIFT', 'PGDN'),
      ccw: hot('SHIFT', 'PGUP'),
      press: KNOB_PRESS_DEFAULTS.terminal.action,
      pressLabel: KNOB_PRESS_DEFAULTS.terminal.label
    }
  }
}

function browser(): Profile {
  return {
    id: 'browser',
    name: 'Browser',
    match: {
      windows: ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi'],
      macos: ['com.google.Chrome', 'com.apple.Safari', 'org.mozilla.firefox'],
      titles: []
    },
    keys: [
      K('tools', PURPLE, key('F12')),
      K('reld', GREEN, key('F5')),
      K('hard', GREEN, hot('CTRL', 'SHIFT', 'R')),
      K('insp', CYAN, hot('CTRL', 'SHIFT', 'C')),
      K('cons', CYAN, hot('CTRL', 'SHIFT', 'J')),
      K('tab+', BLUE, hot('CTRL', 'T')),
      K('close', RED, hot('CTRL', 'W')),
      K('reopn', ORANGE, hot('CTRL', 'SHIFT', 'T')),
      K('url', YELLOW, hot('CTRL', 'L')),
      K('back', WHITE, hot('ALT', 'LEFT')),
      K('fwd', WHITE, hot('ALT', 'RIGHT')),
      FN()
    ],
    layers: [],
    encoder: {
      label: 'KNOB:TAB',
      cw: hot('CTRL', 'PGDN'),
      ccw: hot('CTRL', 'PGUP'),
      press: KNOB_PRESS_DEFAULTS.browser.action,
      pressLabel: KNOB_PRESS_DEFAULTS.browser.label
    }
  }
}

export function defaultConfig(): Config {
  return {
    schema_version: SCHEMA_VERSION,
    device: {
      name: 'SnekPad',
      owner_screen: { line1: '', line2: '', date: '' },
      oled: { width: 128, height: 32 }
    },
    settings: {
      brightness: 0.4,
      sleepMinutes: DEFAULT_SLEEP_MINUTES,
      effect: DEFAULT_EFFECT
    },
    profiles: [general(), vscode(), terminal()],
    studioProfiles: [browser()]
  }
}

/** Every profile Studio knows, the pad's own first, then the Studio-only ones (the order the editor lists them). */
export const allProfiles = (config: Config): Profile[] => [
  ...config.profiles,
  ...config.studioProfiles
]

/**
 * Apply per-OS differences before a config is sent to the pad. On macOS, shortcuts marked
 * "use Cmd" get GUI (Cmd) in place of CTRL. The stored config is not changed.
 */
export function resolveForOs(config: Config, os: 'windows' | 'macos' | 'linux'): Config {
  if (os !== 'macos') return config
  return {
    ...config,
    profiles: config.profiles.map((p) => resolveProfileForOs(p, os)),
    studioProfiles: config.studioProfiles.map((p) => resolveProfileForOs(p, os))
  }
}

/** The same per-OS differences for one profile (the one Studio puts on the pad's slot). */
export function resolveProfileForOs(profile: Profile, os: 'windows' | 'macos' | 'linux'): Profile {
  if (os !== 'macos') return profile
  const swap = (keys: string[]): string[] => keys.map((k) => (k === 'CTRL' ? 'GUI' : k))
  const fix = (a: Action): Action => {
    if (a.type === 'hotkey' && a.cmdOnMac) return { ...a, keys: swap(a.keys) }
    if (a.type === 'sequence' && a.cmdOnMac)
      return { ...a, steps: a.steps.map((s) => ({ ...s, keys: swap(s.keys) })) }
    if (a.type === 'tap_hold') {
      const plain = <T extends Action | undefined>(x: T): T => (x ? (fix(x) as T) : x)
      return { ...a, tap: plain(a.tap), hold: plain(a.hold), double: plain(a.double) }
    }
    return a
  }
  return {
    ...profile,
    keys: profile.keys.map((k) => ({ ...k, action: fix(k.action) })),
    layers: profile.layers.map((l) => ({
      ...l,
      keys: l.keys.map((k) => ({ ...k, action: fix(k.action) }))
    })),
    encoder: {
      ...profile.encoder,
      cw: fix(profile.encoder.cw),
      ccw: fix(profile.encoder.ccw),
      press: fix(profile.encoder.press)
    }
  }
}

/**
 * Which profile an app gets: the first whose rules match, or -1. The same rules as the pad's own matching
 * (Programs/app_profiles.py `_match`): the process name without ".exe", lower case, equal to one of the profile's
 * program names (a trailing * means "starts with"), or a profile word anywhere in the window title.
 */
export function matchProfile(profiles: readonly Profile[], proc: string, title: string): number {
  return bestMatch(profiles, proc, title).index
}

/** The best profile for an app and how well it fits: 0 = none, 1 = the program, 2 = a title word, 3 = both. */
export function bestMatch(
  profiles: readonly Profile[],
  proc: string,
  title: string
): { index: number; score: number } {
  let p = proc.toLowerCase()
  if (p.endsWith('.exe')) p = p.slice(0, -4)
  const t = title.toLowerCase()
  // When several profiles match, the most specific one wins: a title word that matches counts for more than a program that
  // matches (a "YouTube" profile beats the "Browser" profile for a YouTube tab), so one that matches both beats either
  // alone; the same score goes to the earlier profile in the list.
  let best = -1
  let bestScore = 0
  profiles.forEach((prof, i) => {
    if (prof.id === 'general') return // General has no rules: it is what every other app gets
    // like the pad: the names of both systems are tried (the other system's never match)
    const names = [...prof.match.windows, ...prof.match.macos].map((s) => s.toLowerCase())
    const program = names.some((m) => (m.endsWith('*') ? p.startsWith(m.slice(0, -1)) : p === m))
    const word = prof.match.titles.some((w) => w !== '' && t.includes(w.toLowerCase()))
    const score = (word ? 2 : 0) + (program ? 1 : 0)
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  })
  return { index: best, score: bestScore }
}

/** A blank profile for "New profile". */
export function blankProfile(id: string, name: string): Profile {
  return {
    id,
    name,
    match: { windows: [], macos: [], titles: [] },
    keys: Array.from({ length: KEY_COUNT }, (_, i) =>
      i === FN_KEY ? FN() : K('', DIM, { type: 'none' })
    ),
    layers: [],
    encoder: {
      label: 'KNOB:VOL',
      cw: consumer('VOLU'),
      ccw: consumer('VOLD'),
      press: { type: 'none' },
      pressLabel: ''
    }
  }
}
