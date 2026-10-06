// Browser key events -> KMK key names (the names stored in the config).

const MODS: Record<string, string> = {
  ControlLeft: 'CTRL', ControlRight: 'CTRL',
  ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT',
  AltLeft: 'ALT', AltRight: 'ALT',
  MetaLeft: 'GUI', MetaRight: 'GUI'
}

const NAMED: Record<string, string> = {
  Enter: 'ENTER', Escape: 'ESC', Space: 'SPACE', Tab: 'TAB', Backspace: 'BSPC', Delete: 'DEL',
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  PageUp: 'PGUP', PageDown: 'PGDN', Home: 'HOME', End: 'END', Insert: 'INS',
  Backquote: 'GRV', Slash: 'SLSH', Minus: 'MINUS', Equal: 'EQL', Backslash: 'BSLS',
  BracketLeft: 'LBRC', BracketRight: 'RBRC', Semicolon: 'SCLN', Quote: 'QUOT',
  Comma: 'COMM', Period: 'DOT'
}

export const isModifierCode = (code: string): boolean => code in MODS

/** Name of the non-modifier key, or null if we don't know it. */
export function keyNameFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return 'N' + code.slice(5)
  if (/^F([1-9]|1[0-2])$/.test(code)) return code
  return NAMED[code] ?? null
}

/** KMK name for any key we can record: modifiers (CTRL, SHIFT, ALT, GUI) or a normal key. */
export function tokenFromCode(code: string): string | null {
  return MODS[code] ?? keyNameFromCode(code)
}

const MOD_ORDER = ['CTRL', 'SHIFT', 'ALT', 'GUI']

/** Modifiers first (in a fixed order), then the other keys in the order they were pressed. */
export function orderCombo(tokens: string[]): string[] {
  const mods = MOD_ORDER.filter((m) => tokens.includes(m))
  return [...mods, ...tokens.filter((t) => !MOD_ORDER.includes(t))]
}

export const CONSUMER_CODES: { code: string; label: string }[] = [
  { code: 'VOLU', label: 'Volume up' },
  { code: 'VOLD', label: 'Volume down' },
  { code: 'MUTE', label: 'Mute' },
  { code: 'MPLY', label: 'Play / pause' },
  { code: 'MNXT', label: 'Next track' },
  { code: 'MPRV', label: 'Previous track' },
  { code: 'BRIU', label: 'Brightness up' },
  { code: 'BRID', label: 'Brightness down' }
]

export const COLOR_PRESETS = [
  '#FF2020', '#FF7000', '#FFC000', '#00E060', '#00C8C8', '#2060FF',
  '#A040FF', '#FF40A0', '#C0C0C0', '#303030', '#000000'
]
