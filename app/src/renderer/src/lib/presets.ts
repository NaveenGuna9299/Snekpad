// Ready-made profiles shown in "More profiles". Taken from the SnekPad profile list: each one is a
// full layer (12 keys + knob) plus the programs that switch to it.

import {
  DEFAULT_WAIT_MS,
  FN_KEY,
  type Action,
  type KeyConfig,
  type Template
} from '../../../shared/config'

export type Preset = Template

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
const consumer = (code: string): Action => ({ type: 'consumer', code })
// Esc, then the given keys one after the other (Jupyter command mode)
const esc = (...rest: string[]): Action => ({
  type: 'sequence',
  steps: ['ESC', ...rest].map((k, i, all) => ({
    keys: [k],
    wait: i < all.length - 1 ? DEFAULT_WAIT_MS : 0
  }))
})
const K = (label: string, color: string, action: Action): KeyConfig => ({ label, color, action })
const FN = (): KeyConfig => K('FN', DIM, { type: 'fn' })

type Spec = {
  id: string
  name: string
  note: string
  windows?: string[]
  macos?: string[]
  titles?: string[]
  keys: KeyConfig[] // the 11 keys before FN
  knob: { label: string; cw: Action; ccw: Action; press: Action; pressLabel: string }
}

const make = (s: Spec): Preset => {
  if (s.keys.length !== FN_KEY) throw new Error(`${s.id}: expected ${FN_KEY} keys`)
  return {
    id: s.id,
    name: s.name,
    note: s.note,
    profile: {
      name: s.name,
      match: { windows: s.windows ?? [], macos: s.macos ?? [], titles: s.titles ?? [] },
      keys: [...s.keys, FN()],
      encoder: {
        label: s.knob.label,
        cw: s.knob.cw,
        ccw: s.knob.ccw,
        press: s.knob.press,
        pressLabel: s.knob.pressLabel
      }
    }
  }
}

const TAB_KNOB = { label: 'KNOB:TAB', cw: hot('CTRL', 'PGDN'), ccw: hot('CTRL', 'PGUP') }
const VOL_KNOB = {
  label: 'KNOB:VOL',
  cw: consumer('VOLU'),
  ccw: consumer('VOLD'),
  press: consumer('MUTE'),
  pressLabel: 'MUTE'
}
const ROW_KNOB = {
  label: 'KNOB:ROW',
  cw: key('DOWN'),
  ccw: key('UP'),
  press: key('ENTER'),
  pressLabel: 'ENTER'
}

export const PRESETS: Preset[] = [
  make({
    id: 'dev-terminal',
    name: 'Git Terminal',
    note: 'Git and npm commands',
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
      K('ps', PINK, typed('docker ps', true))
    ],
    knob: {
      label: 'KNOB:SCRL',
      cw: hot('SHIFT', 'PGDN'),
      ccw: hot('SHIFT', 'PGUP'),
      press: key('ENTER'),
      pressLabel: 'ENTER'
    }
  }),
  make({
    id: 'py-terminal',
    name: 'Py Terminal',
    note: 'Python, Jupyter, conda, pip',
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
      K('py', PINK, typed('python', true)),
      K('jlab', ORANGE, typed('jupyter lab', true)),
      K('conda', GREEN, typed('conda activate ')),
      K('pip', GREEN, typed('pip install ')),
      K('stat', CYAN, typed('git status', true)),
      K('pull', CYAN, typed('git pull', true)),
      K('push', BLUE, typed('git push'))
    ],
    knob: {
      label: 'KNOB:SCRL',
      cw: hot('SHIFT', 'PGDN'),
      ccw: hot('SHIFT', 'PGUP'),
      press: key('ENTER'),
      pressLabel: 'ENTER'
    }
  }),
  make({
    id: 'teams',
    name: 'Teams',
    note: 'Teams and Outlook',
    windows: ['ms-teams', 'teams', 'outlook', 'olk'],
    macos: ['com.microsoft.teams2', 'com.microsoft.Outlook'],
    keys: [
      K('mute', RED, hot('CTRL', 'SHIFT', 'M')),
      K('cam', GREEN, hot('CTRL', 'SHIFT', 'O')),
      K('hand', YELLOW, hot('CTRL', 'SHIFT', 'K')),
      K('share', PURPLE, hot('CTRL', 'SHIFT', 'E')),
      K('chat', BLUE, hot('CTRL', 'N2')),
      K('cal', BLUE, hot('CTRL', 'N4')),
      K('srch', CYAN, hot('CTRL', 'E')),
      K('send', GREEN, hot('CTRL', 'ENTER')),
      K('new', ORANGE, hot('CTRL', 'N')),
      K('reply', PINK, hot('CTRL', 'R')),
      K('rall', PINK, hot('CTRL', 'SHIFT', 'R'))
    ],
    knob: VOL_KNOB
  }),
  make({
    id: 'jupyter',
    name: 'Jupyter',
    note: 'Notebook cells, also works in a browser tab',
    windows: ['jupyter-notebook', 'jupyter-lab'],
    titles: ['jupyter'],
    keys: [
      K('run', GREEN, hot('SHIFT', 'ENTER')),
      K('stay', CYAN, hot('CTRL', 'ENTER')),
      K('run+', BLUE, hot('ALT', 'ENTER')),
      K('esc', YELLOW, key('ESC')),
      K('above', PURPLE, esc('A')),
      K('below', PURPLE, esc('B')),
      K('del', RED, esc('D', 'D')),
      K('md', PINK, esc('M')),
      K('code', ORANGE, esc('Y')),
      K('rstrt', RED, esc('N0', 'N0')),
      K('save', GREEN, hot('CTRL', 'S'))
    ],
    knob: {
      label: 'KNOB:CELL',
      cw: key('DOWN'),
      ccw: key('UP'),
      press: key('ENTER'),
      pressLabel: 'ENTER'
    }
  }),
  make({
    id: 'pandas',
    name: 'Pandas',
    note: 'Python data snippets. Open it from the profile switcher',
    keys: [
      K('pd', GREEN, typed('import pandas as pd')),
      K('np', GREEN, typed('import numpy as np')),
      K('plt', CYAN, typed('import matplotlib.pyplot as plt')),
      K('sns', CYAN, typed('import seaborn as sns')),
      K('head', BLUE, typed('df.head()')),
      K('info', BLUE, typed('df.info()')),
      K('desc', BLUE, typed('df.describe()')),
      K('nulls', ORANGE, typed('df.isna().sum()')),
      K('fig', PURPLE, typed('plt.figure(figsize=(10, 6))')),
      K('show', PURPLE, typed('plt.show()')),
      K('heat', PINK, typed('sns.heatmap(df.corr(), annot=True)'))
    ],
    knob: {
      label: 'KNOB:CELL',
      cw: key('DOWN'),
      ccw: key('UP'),
      press: key('ENTER'),
      pressLabel: 'ENTER'
    }
  }),
  make({
    id: 'excel',
    name: 'Excel',
    note: 'Sums, filters, formatting',
    windows: ['excel'],
    macos: ['com.microsoft.Excel'],
    keys: [
      K('sum', GREEN, hot('ALT', 'EQL')),
      K('fltr', CYAN, hot('CTRL', 'SHIFT', 'L')),
      K('fmt', PURPLE, hot('CTRL', 'N1')),
      K('insrt', BLUE, hot('CTRL', 'SHIFT', 'EQL')),
      K('del', RED, hot('CTRL', 'MINUS')),
      K('fill', ORANGE, hot('CTRL', 'D')),
      K('pste', PINK, hot('CTRL', 'ALT', 'V')),
      K('goto', YELLOW, hot('CTRL', 'G')),
      K('find', CYAN, hot('CTRL', 'F')),
      K('tbl', BLUE, hot('CTRL', 'T')),
      K('save', GREEN, hot('CTRL', 'S'))
    ],
    knob: { ...TAB_KNOB, press: hot('CTRL', 'S'), pressLabel: 'SAVE' }
  }),
  make({
    id: 'sql',
    name: 'SQL',
    note: 'Query clauses for SSMS, DBeaver, DataGrip',
    windows: ['ssms', 'dbeaver', 'datagrip', 'azuredatastudio', 'pgadmin4', 'pgadmin'],
    keys: [
      K('SEL*', GREEN, typed('SELECT * FROM ')),
      K('WHERE', CYAN, typed('WHERE ')),
      K('GROUP', CYAN, typed('GROUP BY ')),
      K('ORDER', CYAN, typed('ORDER BY ')),
      K('JOIN', BLUE, typed('LEFT JOIN ')),
      K('ON', BLUE, typed(' ON ')),
      K('COUNT', PURPLE, typed('COUNT(*)')),
      K('LIM', ORANGE, typed('LIMIT 100;')),
      K('WITH', PINK, typed('WITH cte AS (')),
      K('DIST', YELLOW, typed('DISTINCT ')),
      K('run', GREEN, key('F5'))
    ],
    knob: ROW_KNOB
  }),
  make({
    id: 'postman',
    name: 'Postman',
    note: 'Send requests, tabs, console',
    windows: ['postman'],
    macos: ['com.postmanlabs.mac'],
    keys: [
      K('send', GREEN, hot('CTRL', 'ENTER')),
      K('save', GREEN, hot('CTRL', 'S')),
      K('new', BLUE, hot('CTRL', 'N')),
      K('srch', CYAN, hot('CTRL', 'K')),
      K('tab+', PURPLE, hot('CTRL', 'T')),
      K('close', RED, hot('CTRL', 'W')),
      K('imp', ORANGE, hot('CTRL', 'O')),
      K('sv as', ORANGE, hot('CTRL', 'SHIFT', 'S')),
      K('cons', YELLOW, hot('CTRL', 'ALT', 'C')),
      K('fmt', PINK, hot('CTRL', 'B')),
      K('find', CYAN, hot('CTRL', 'F'))
    ],
    knob: {
      label: 'KNOB:TAB',
      cw: hot('CTRL', 'TAB'),
      ccw: hot('CTRL', 'SHIFT', 'TAB'),
      press: hot('CTRL', 'ENTER'),
      pressLabel: 'SEND'
    }
  }),
  make({
    id: 'figma',
    name: 'Figma',
    note: 'Tools, grouping, zoom. Also matches Figma in a browser',
    windows: ['figma'],
    macos: ['com.figma.Desktop'],
    titles: ['figma'],
    keys: [
      K('move', WHITE, key('V')),
      K('frame', CYAN, key('F')),
      K('rect', BLUE, key('R')),
      K('text', YELLOW, key('T')),
      K('group', GREEN, hot('CTRL', 'G')),
      K('ungrp', RED, hot('CTRL', 'SHIFT', 'G')),
      K('dupl', ORANGE, hot('CTRL', 'D')),
      K('comp', PURPLE, hot('CTRL', 'ALT', 'K')),
      K('auto', PINK, hot('SHIFT', 'A')),
      K('fit', CYAN, hot('SHIFT', 'N1')),
      K('sel', CYAN, hot('SHIFT', 'N2'))
    ],
    knob: {
      label: 'KNOB:ZOOM',
      cw: hot('CTRL', 'EQL'),
      ccw: hot('CTRL', 'MINUS'),
      press: hot('SHIFT', 'N1'),
      pressLabel: 'FIT'
    }
  }),
  make({
    id: 'slack',
    name: 'Slack',
    note: 'Jump, threads, mentions, channels',
    windows: ['slack'],
    macos: ['com.tinyspeck.slackmacgap'],
    keys: [
      K('jump', CYAN, hot('CTRL', 'K')),
      K('srch', CYAN, hot('CTRL', 'G')),
      K('new', BLUE, hot('CTRL', 'N')),
      K('read', GREEN, hot('SHIFT', 'ESC')),
      K('thrds', PURPLE, hot('CTRL', 'SHIFT', 'T')),
      K('ments', YELLOW, hot('CTRL', 'SHIFT', 'M')),
      K('dms', BLUE, hot('CTRL', 'SHIFT', 'K')),
      K('edit', ORANGE, key('UP')),
      K('bold', WHITE, hot('CTRL', 'B')),
      K('code', PINK, hot('CTRL', 'SHIFT', 'C')),
      K('hudl', GREEN, hot('CTRL', 'SHIFT', 'H'))
    ],
    knob: {
      label: 'KNOB:CHAN',
      cw: hot('ALT', 'DOWN'),
      ccw: hot('ALT', 'UP'),
      press: hot('SHIFT', 'ESC'),
      pressLabel: 'READ'
    }
  })
]
