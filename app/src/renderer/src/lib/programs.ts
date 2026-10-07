// Known programs: the names Windows / macOS give them, and an icon where we can bundle one.
//
// Bundled logos come from Simple Icons (https://simpleicons.org, CC0 licence), compiled into the
// app, so they work offline. Some brands (VS Code, Edge, Excel, Teams ...) are not in that set;
// for those the app shows the program's own icon read from the user's computer, and a coloured
// letter tile when that isn't available. Logos remain trademarks of their owners and are used
// only to identify the program.

import {
  siBrave,
  siCursor,
  siDbeaver,
  siDiscord,
  siFigma,
  siFirefoxbrowser,
  siGit,
  siGooglechrome,
  siJupyter,
  siNotion,
  siObsstudio,
  siObsidian,
  siOpera,
  siPostman,
  siSpotify,
  siSteam,
  siSublimetext,
  siTelegram,
  siVivaldi,
  siZoom,
  type SimpleIcon
} from 'simple-icons'

export type Program = {
  id: string
  name: string
  windows: string[] // process names, lower case, no .exe
  macos: string[] // bundle ids
  icon?: SimpleIcon
  color: string // tile colour when there is no icon
}

export const PROGRAMS: Program[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    windows: ['code'],
    macos: ['com.microsoft.VSCode'],
    color: '#007ACC'
  },
  {
    id: 'cursor',
    name: 'Cursor',
    windows: ['cursor'],
    macos: [],
    icon: siCursor,
    color: '#555555'
  },
  {
    id: 'chrome',
    name: 'Chrome',
    windows: ['chrome'],
    macos: ['com.google.Chrome'],
    icon: siGooglechrome,
    color: '#4285F4'
  },
  {
    id: 'edge',
    name: 'Edge',
    windows: ['msedge'],
    macos: ['com.microsoft.edgemac'],
    color: '#0078D4'
  },
  {
    id: 'firefox',
    name: 'Firefox',
    windows: ['firefox'],
    macos: ['org.mozilla.firefox'],
    icon: siFirefoxbrowser,
    color: '#FF7139'
  },
  {
    id: 'brave',
    name: 'Brave',
    windows: ['brave'],
    macos: ['com.brave.Browser'],
    icon: siBrave,
    color: '#FB542B'
  },
  {
    id: 'opera',
    name: 'Opera',
    windows: ['opera'],
    macos: ['com.operasoftware.Opera'],
    icon: siOpera,
    color: '#FF1B2D'
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    windows: ['vivaldi'],
    macos: ['com.vivaldi.Vivaldi'],
    icon: siVivaldi,
    color: '#EF3939'
  },
  {
    id: 'wt',
    name: 'Windows Terminal',
    windows: ['windowsterminal', 'wt'],
    macos: [],
    color: '#4D4D4D'
  },
  {
    id: 'powershell',
    name: 'PowerShell',
    windows: ['powershell', 'pwsh'],
    macos: [],
    color: '#2671BE'
  },
  { id: 'cmd', name: 'Command Prompt', windows: ['cmd', 'conhost'], macos: [], color: '#3A3A3A' },
  {
    id: 'gitbash',
    name: 'Git Bash',
    windows: ['mintty', 'git-bash'],
    macos: [],
    icon: siGit,
    color: '#F05032'
  },
  {
    id: 'excel',
    name: 'Excel',
    windows: ['excel'],
    macos: ['com.microsoft.Excel'],
    color: '#217346'
  },
  {
    id: 'teams',
    name: 'Teams',
    windows: ['ms-teams', 'teams'],
    macos: ['com.microsoft.teams2'],
    color: '#6264A7'
  },
  {
    id: 'outlook',
    name: 'Outlook',
    windows: ['outlook', 'olk'],
    macos: ['com.microsoft.Outlook'],
    color: '#0078D4'
  },
  {
    id: 'slack',
    name: 'Slack',
    windows: ['slack'],
    macos: ['com.tinyspeck.slackmacgap'],
    color: '#4A154B'
  },
  {
    id: 'discord',
    name: 'Discord',
    windows: ['discord'],
    macos: ['com.hnc.Discord'],
    icon: siDiscord,
    color: '#5865F2'
  },
  {
    id: 'zoom',
    name: 'Zoom',
    windows: ['zoom'],
    macos: ['us.zoom.xos'],
    icon: siZoom,
    color: '#0B5CFF'
  },
  {
    id: 'telegram',
    name: 'Telegram',
    windows: ['telegram'],
    macos: ['ru.keepcoder.Telegram'],
    icon: siTelegram,
    color: '#26A5E4'
  },
  {
    id: 'spotify',
    name: 'Spotify',
    windows: ['spotify'],
    macos: ['com.spotify.client'],
    icon: siSpotify,
    color: '#1DB954'
  },
  {
    id: 'notion',
    name: 'Notion',
    windows: ['notion'],
    macos: ['notion.id'],
    icon: siNotion,
    color: '#777777'
  },
  {
    id: 'obsidian',
    name: 'Obsidian',
    windows: ['obsidian'],
    macos: ['md.obsidian'],
    icon: siObsidian,
    color: '#7C3AED'
  },
  {
    id: 'figma',
    name: 'Figma',
    windows: ['figma'],
    macos: ['com.figma.Desktop'],
    icon: siFigma,
    color: '#F24E1E'
  },
  {
    id: 'postman',
    name: 'Postman',
    windows: ['postman'],
    macos: ['com.postmanlabs.mac'],
    icon: siPostman,
    color: '#FF6C37'
  },
  {
    id: 'jupyter',
    name: 'Jupyter',
    windows: ['jupyter-notebook', 'jupyter-lab'],
    macos: [],
    icon: siJupyter,
    color: '#F37626'
  },
  {
    id: 'dbeaver',
    name: 'DBeaver',
    windows: ['dbeaver'],
    macos: ['org.jkiss.dbeaver.core.product'],
    icon: siDbeaver,
    color: '#382923'
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    windows: ['sublime_text'],
    macos: ['com.sublimetext.4'],
    icon: siSublimetext,
    color: '#FF9800'
  },
  {
    id: 'obs',
    name: 'OBS Studio',
    windows: ['obs64'],
    macos: ['com.obsproject.obs-studio'],
    icon: siObsstudio,
    color: '#302E31'
  },
  {
    id: 'steam',
    name: 'Steam',
    windows: ['steam'],
    macos: ['com.valvesoftware.steam'],
    icon: siSteam,
    color: '#1B2838'
  }
]

const byProc = new Map<string, Program>()
for (const p of PROGRAMS) for (const w of p.windows) byProc.set(w, p)

export const programForProc = (proc: string): Program | undefined => byProc.get(proc.toLowerCase())

/** What a profile's list of process names looks like to the user: one chip per program. */
export type Chip = { key: string; name: string; procs: string[]; program?: Program }

export function chipsFor(windows: string[]): Chip[] {
  const chips: Chip[] = []
  for (const proc of windows) {
    const program = programForProc(proc)
    const key = program ? program.id : `custom:${proc}`
    const existing = chips.find((c) => c.key === key)
    if (existing) existing.procs.push(proc)
    else chips.push({ key, name: program ? program.name : proc, procs: [proc], program })
  }
  return chips
}

/** Icons that are almost black would vanish on the dark UI, so they are drawn light instead. */
export function visibleColor(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
  return lum < 0.2 ? '#dbdee1' : `#${hex.replace('#', '')}`
}
