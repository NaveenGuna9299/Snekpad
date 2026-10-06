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
export const MAX_PROFILES = 4 // firmware memory limit, General included
export const LABEL_MAX = 5 // characters that fit one OLED legend cell
export const MAX_COMBO = 6 // keys pressed together in one shortcut
export const MAX_STEPS = 6 // keys / shortcuts in one sequence
export const MAX_WAIT_MS = 2000 // longest pause between two steps
export const DEFAULT_WAIT_MS = 100
export const FN_KEY = 11 // bottom-right key is always the utility (FN) layer key

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'colour must look like #RRGGBB')
const keyName = z.string().regex(/^[A-Z0-9_]{1,12}$/, 'key names are upper case, e.g. CTRL, C, F12')

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('fn') }), // reserved for FN_KEY
  z.object({ type: z.literal('layer_next') }), // legacy: old knob press. Migrated away; holding the knob now opens the profile switcher
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
      .array(z.object({ keys: z.array(keyName).min(1).max(MAX_COMBO), wait: z.number().int().min(0).max(MAX_WAIT_MS) }))
      .min(1)
      .max(MAX_STEPS),
    cmdOnMac: z.boolean().optional()
  }),
  z.object({ type: z.literal('consumer'), code: keyName })
])
export type Action = z.infer<typeof actionSchema>

export const keySchema = z.object({
  label: z.string().max(LABEL_MAX, `labels are at most ${LABEL_MAX} characters`),
  color: hexColor,
  action: actionSchema
})
export type KeyConfig = z.infer<typeof keySchema>

export const profileSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,24}$/),
  name: z.string().min(1).max(12), // fits the OLED top bar
  match: z.object({
    windows: z.array(z.string()).max(12), // process names, lower case, no .exe
    macos: z.array(z.string()).max(12), // bundle ids
    titles: z.array(z.string()).max(6) // words in the window title
  }),
  keys: z.array(keySchema).length(KEY_COUNT),
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
      oled: z.object({ width: z.literal(128), height: z.union([z.literal(32), z.literal(64)]) })
    }),
    settings: z.object({ brightness: z.number().min(0.05).max(0.5) }),
    profiles: z.array(profileSchema).min(1).max(MAX_PROFILES)
  })
  .superRefine((cfg, ctx) => {
    if (cfg.profiles[0].id !== 'general') {
      ctx.addIssue({ code: 'custom', message: 'the first profile must be General', path: ['profiles', 0] })
    }
    const ids = new Set<string>()
    cfg.profiles.forEach((p, i) => {
      if (ids.has(p.id)) ctx.addIssue({ code: 'custom', message: `duplicate profile id "${p.id}"`, path: ['profiles', i] })
      ids.add(p.id)
      if (p.keys[FN_KEY].action.type !== 'fn') {
        ctx.addIssue({ code: 'custom', message: `key ${FN_KEY} must stay the FN key`, path: ['profiles', i, 'keys', FN_KEY] })
      }
    })
  })
export type Config = z.infer<typeof configSchema>

export type ValidationResult = { ok: true; config: Config } | { ok: false; errors: string[] }

export function validateConfig(input: unknown): ValidationResult {
  const r = configSchema.safeParse(input)
  if (r.success) return { ok: true, config: r.data }
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`) }
}

// Upgrade older files to the current schema. Only version 1 exists so far; early builds stored
// sequences as `macro` actions with steps like 'UP' or ['CTRL','K'] and no pause, and the knob
// press was "next profile" (now the hold-to-switch profile switcher, so the press gets a real action).
export function migrateConfig(input: unknown): unknown {
  type Raw = { type?: string; steps?: unknown[] }
  type RawProfile = { id?: string; keys?: { action?: Raw }[]; encoder?: { press?: Raw; pressLabel?: string } }
  const cfg = input as { profiles?: RawProfile[] }
  for (const p of cfg?.profiles ?? []) {
    const enc = p.encoder
    if (enc?.press?.type === 'layer_next') {
      const d = p.id ? KNOB_PRESS_DEFAULTS[p.id] : undefined
      enc.press = (d?.action ?? { type: 'none' }) as Raw
      enc.pressLabel = d?.label ?? ''
    }
  }
  for (const p of cfg?.profiles ?? [])
    for (const k of p.keys ?? []) {
      const a = k.action
      if (!a || (a.type !== 'macro' && a.type !== 'sequence') || !Array.isArray(a.steps)) continue
      a.type = 'sequence'
      a.steps = a.steps.slice(0, MAX_STEPS).map((st, i, all) => {
        if (st && typeof st === 'object' && !Array.isArray(st)) return st
        return { keys: Array.isArray(st) ? st : [st], wait: i < all.length - 1 ? DEFAULT_WAIT_MS : 0 }
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
      K('copy', BLUE, hot('CTRL', 'C')), K('paste', BLUE, hot('CTRL', 'V')),
      K('cut', BLUE, hot('CTRL', 'X')), K('undo', ORANGE, hot('CTRL', 'Z')),
      K('redo', ORANGE, hot('CTRL', 'Y')), K('all', CYAN, hot('CTRL', 'A')),
      K('save', GREEN, hot('CTRL', 'S')), K('find', CYAN, hot('CTRL', 'F')),
      K('tab+', PURPLE, hot('CTRL', 'T')), K('close', RED, hot('CTRL', 'W')),
      K('snip', YELLOW, hot('GUI', 'SHIFT', 'S')), FN()
    ],
    encoder: { label: 'KNOB:VOL', cw: consumer('VOLU'), ccw: consumer('VOLD'), press: KNOB_PRESS_DEFAULTS.general.action, pressLabel: KNOB_PRESS_DEFAULTS.general.label }
  }
}

function vscode(): Profile {
  return {
    id: 'vscode',
    name: 'VS Code',
    match: { windows: ['code', 'cursor'], macos: ['com.microsoft.VSCode'], titles: [] },
    keys: [
      K('open', CYAN, hot('CTRL', 'P')), K('cmd', CYAN, hot('CTRL', 'SHIFT', 'P')),
      K('term', PURPLE, hot('CTRL', 'GRV')), K('side', PURPLE, hot('CTRL', 'B')),
      K('cmnt', YELLOW, hot('CTRL', 'SLSH')), K('def', BLUE, key('F12')),
      K('find', BLUE, hot('CTRL', 'SHIFT', 'F')), K('debug', GREEN, key('F5')),
      K('save', GREEN, hot('CTRL', 'S')), K('undo', ORANGE, hot('CTRL', 'Z')),
      K('fmt', PINK, hot('SHIFT', 'ALT', 'F')), FN()
    ],
    encoder: { label: 'KNOB:TAB', cw: hot('CTRL', 'PGDN'), ccw: hot('CTRL', 'PGUP'), press: KNOB_PRESS_DEFAULTS.vscode.action, pressLabel: KNOB_PRESS_DEFAULTS.vscode.label }
  }
}

function terminal(): Profile {
  return {
    id: 'terminal',
    name: 'Terminal',
    match: {
      windows: ['windowsterminal', 'wt', 'powershell', 'pwsh', 'cmd', 'mintty', 'git-bash', 'conhost'],
      macos: ['com.apple.Terminal', 'com.googlecode.iterm2'],
      titles: []
    },
    keys: [
      K('^C', RED, hot('CTRL', 'C')), K('clear', YELLOW, hot('CTRL', 'L')),
      K('rerun', ORANGE, { type: 'sequence', steps: [{ keys: ['UP'], wait: DEFAULT_WAIT_MS }, { keys: ['ENTER'], wait: 0 }] }), K('hist', PURPLE, hot('CTRL', 'R')),
      K('stat', GREEN, typed('git status', true)), K('pull', GREEN, typed('git pull', true)),
      K('push', CYAN, typed('git push')), K('comm', CYAN, typed('git commit -m "')),
      K('dev', BLUE, typed('npm run dev', true)), K('test', BLUE, typed('npm test', true)),
      K('py', PINK, typed('python', true)), FN()
    ],
    encoder: { label: 'KNOB:SCRL', cw: hot('SHIFT', 'PGDN'), ccw: hot('SHIFT', 'PGUP'), press: KNOB_PRESS_DEFAULTS.terminal.action, pressLabel: KNOB_PRESS_DEFAULTS.terminal.label }
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
      K('tools', PURPLE, key('F12')), K('reld', GREEN, key('F5')),
      K('hard', GREEN, hot('CTRL', 'SHIFT', 'R')), K('insp', CYAN, hot('CTRL', 'SHIFT', 'C')),
      K('cons', CYAN, hot('CTRL', 'SHIFT', 'J')), K('tab+', BLUE, hot('CTRL', 'T')),
      K('close', RED, hot('CTRL', 'W')), K('reopn', ORANGE, hot('CTRL', 'SHIFT', 'T')),
      K('url', YELLOW, hot('CTRL', 'L')), K('back', WHITE, hot('ALT', 'LEFT')),
      K('fwd', WHITE, hot('ALT', 'RIGHT')), FN()
    ],
    encoder: { label: 'KNOB:TAB', cw: hot('CTRL', 'PGDN'), ccw: hot('CTRL', 'PGUP'), press: KNOB_PRESS_DEFAULTS.browser.action, pressLabel: KNOB_PRESS_DEFAULTS.browser.label }
  }
}

export function defaultConfig(): Config {
  return {
    schema_version: SCHEMA_VERSION,
    device: { name: 'SnekPad', owner_screen: { line1: '', line2: '', date: '' }, oled: { width: 128, height: 32 } },
    settings: { brightness: 0.4 },
    profiles: [general(), vscode(), terminal(), browser()]
  }
}

/**
 * Apply per-OS differences before a config is sent to the pad. On macOS, shortcuts marked
 * "use Cmd" get GUI (Cmd) in place of CTRL. The stored config is not changed.
 */
export function resolveForOs(config: Config, os: 'windows' | 'macos' | 'linux'): Config {
  if (os !== 'macos') return config
  const swap = (keys: string[]): string[] => keys.map((k) => (k === 'CTRL' ? 'GUI' : k))
  const fix = (a: Action): Action => {
    if (a.type === 'hotkey' && a.cmdOnMac) return { ...a, keys: swap(a.keys) }
    if (a.type === 'sequence' && a.cmdOnMac) return { ...a, steps: a.steps.map((s) => ({ ...s, keys: swap(s.keys) })) }
    return a
  }
  return {
    ...config,
    profiles: config.profiles.map((p) => ({
      ...p,
      keys: p.keys.map((k) => ({ ...k, action: fix(k.action) })),
      encoder: { ...p.encoder, cw: fix(p.encoder.cw), ccw: fix(p.encoder.ccw), press: fix(p.encoder.press) }
    }))
  }
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
    encoder: { label: 'KNOB:VOL', cw: consumer('VOLU'), ccw: consumer('VOLD'), press: { type: 'none' }, pressLabel: '' }
  }
}
