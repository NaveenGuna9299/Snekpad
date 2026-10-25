import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_ALL_PROFILES,
  MAX_PROFILES,
  MAX_STUDIO_PROFILES,
  allProfiles,
  blankProfile,
  defaultConfig,
  matchProfile,
  migrateConfig,
  resolveProfileForOs,
  validateConfig,
  type Config
} from '../src/shared/config'
import { appLine, parseEvent, slotFrames } from '../src/shared/protocol'
import { hasSlot, SLOT_FIRMWARE } from '../src/shared/firmware'
import { sameConfig, syncStatus } from '../src/shared/sync'
import { DeviceManager } from '../src/main/device/manager'
import { MockLink } from '../src/main/device/mockLink'

// The profiles that only Studio keeps (up to 7), and the pad's Studio slot they are sent to (firmware 0.5.0).

const attach = (m: DeviceManager, link: MockLink): void =>
  (m as unknown as { attach(l: MockLink): void }).attach(link)

describe('the profile limits', () => {
  it('3 on the pad and 7 only in Studio, 10 in all', () => {
    expect([MAX_PROFILES, MAX_STUDIO_PROFILES, MAX_ALL_PROFILES]).toEqual([3, 7, 10])
  })

  it('the starter config has 3 pad profiles and Browser as the first Studio-only one', () => {
    const c = defaultConfig()
    expect(c.profiles.map((p) => p.id)).toEqual(['general', 'vscode', 'terminal'])
    expect(c.studioProfiles.map((p) => p.id)).toEqual(['browser'])
    expect(validateConfig(c).ok).toBe(true)
  })

  it('accepts 7 Studio-only profiles and refuses an eighth', () => {
    const c = defaultConfig()
    c.studioProfiles = Array.from({ length: 7 }, (_, i) => blankProfile(`s${i}`, `S ${i}`))
    expect(validateConfig(c).ok).toBe(true)
    c.studioProfiles.push(blankProfile('s7', 'S 7'))
    expect(validateConfig(c).ok).toBe(false)
  })

  it('refuses a fourth profile on the pad', () => {
    const c = defaultConfig()
    c.profiles.push(blankProfile('extra', 'Extra'))
    expect(validateConfig(c).ok).toBe(false)
  })

  it('a config saved before Studio-only profiles existed has none', () => {
    const old = JSON.parse(JSON.stringify(defaultConfig())) as Partial<Config>
    delete old.studioProfiles
    const v = validateConfig(old)
    expect(v.ok && v.config.studioProfiles).toEqual([])
  })

  it('ids are unique across both lists, and the FN key stays in place on Studio-only profiles', () => {
    const c = defaultConfig()
    c.studioProfiles[0].id = 'vscode'
    expect(validateConfig(c).ok).toBe(false)
    const d = defaultConfig()
    d.studioProfiles[0].keys[11].action = { type: 'none' }
    expect(validateConfig(d).ok).toBe(false)
  })

  it('allProfiles lists the pad ones first', () => {
    expect(allProfiles(defaultConfig()).map((p) => p.id)).toEqual([
      'general',
      'vscode',
      'terminal',
      'browser'
    ])
  })
})

describe('a config saved when the pad kept 4 profiles', () => {
  const four = (): unknown => {
    const c = JSON.parse(JSON.stringify(defaultConfig())) as Config
    c.profiles = [...c.profiles, ...c.studioProfiles]
    delete (c as Partial<Config>).studioProfiles
    return c
  }

  it('keeps 3 on the pad and moves the fourth to Studio only', () => {
    const v = validateConfig(migrateConfig(four()))
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.config.profiles.map((p) => p.id)).toEqual(['general', 'vscode', 'terminal'])
    expect(v.config.studioProfiles.map((p) => p.id)).toEqual(['browser'])
  })

  it('a config that already fits is left alone', () => {
    const c = JSON.parse(JSON.stringify(defaultConfig()))
    expect(migrateConfig(c)).toEqual(defaultConfig())
  })
})

describe('which profile an app gets', () => {
  const c = defaultConfig()

  it('matches the program name without .exe, ignoring case', () => {
    expect(matchProfile(c.profiles, 'Code.exe', '')).toBe(1)
    expect(matchProfile(c.profiles, 'WindowsTerminal', '')).toBe(2)
    expect(matchProfile(c.studioProfiles, 'chrome', '')).toBe(0)
  })

  it('an app nobody has a profile for gets -1, and General never matches by itself', () => {
    expect(matchProfile(c.profiles, 'notepad', 'Untitled')).toBe(-1)
    expect(matchProfile(allProfiles(c), 'notepad', 'Untitled')).toBe(-1)
  })

  it('a trailing * means "starts with", and a title word matches anywhere in the title', () => {
    const p = blankProfile('x', 'X')
    p.match = { windows: ['obs*'], macos: [], titles: ['Figma'] }
    expect(matchProfile([p], 'obs64', '')).toBe(0)
    expect(matchProfile([p], 'cobs', '')).toBe(-1)
    expect(matchProfile([p], 'msedge', 'My file - FIGMA')).toBe(0)
  })

  it('an empty title word never matches everything', () => {
    const p = blankProfile('x', 'X')
    p.match = { windows: [], macos: [], titles: [''] }
    expect(matchProfile([p], 'anything', 'any title')).toBe(-1)
  })

  describe('when several profiles fit the same window', () => {
    const browser = (): Profile => {
      const p = blankProfile('browser2', 'Browser')
      p.match = { windows: ['chrome', 'brave'], macos: [], titles: [] }
      return p
    }
    const youtube = (windows: string[]): Profile => {
      const p = blankProfile('youtube', 'Youtube')
      p.match = { windows, macos: [], titles: ['youtube'] }
      return p
    }

    it('a profile with the title word beats the profile for the program (the case that did not work)', () => {
      // Browser comes first in the list, and Youtube also names Brave
      const list = [browser(), youtube(['brave'])]
      expect(matchProfile(list, 'brave', 'Lofi hip hop - YouTube - Brave')).toBe(1)
      expect(matchProfile(list, 'brave', 'Inbox - Gmail - Brave')).toBe(0) // not a YouTube page: Browser, as before
    })

    it('a title word alone is enough, in a program only the other profile names', () => {
      const list = [browser(), youtube([])]
      expect(matchProfile(list, 'chrome', 'Song - YouTube - Google Chrome')).toBe(1)
      expect(matchProfile(list, 'chrome', 'Gmail - Google Chrome')).toBe(0)
      expect(matchProfile(list, 'firefox', 'YouTube - Firefox')).toBe(1) // any program with youtube in its title
    })

    it('a profile that matches both beats one that matches only the program, or only the title', () => {
      const both = youtube(['brave'])
      const titleOnly = youtube([])
      titleOnly.id = 'other'
      expect(matchProfile([titleOnly, both], 'brave', 'x - YouTube')).toBe(1)
      expect(matchProfile([both, titleOnly], 'brave', 'x - YouTube')).toBe(0)
    })

    it('profiles that fit equally well go to the one earlier in the list', () => {
      const a = browser()
      const b = browser()
      b.id = 'b'
      expect(matchProfile([a, b], 'chrome', 'x')).toBe(0)
      expect(matchProfile([b, a], 'chrome', 'x')).toBe(0)
    })

    it('a profile with no rules never matches, and no match is -1', () => {
      expect(matchProfile([blankProfile('x', 'X')], 'chrome', 'x')).toBe(-1)
      expect(matchProfile([], 'chrome', 'x')).toBe(-1)
    })
  })

  it('macOS bundle ids are tried too, like on the pad', () => {
    expect(matchProfile(c.studioProfiles, 'com.google.chrome', '')).toBe(0)
  })
})

describe('sending a Studio-only profile', () => {
  it('Cmd shortcuts are resolved for a Mac, like the pad profiles', () => {
    const p = defaultConfig().profiles[1]
    const mac = resolveProfileForOs({ ...p, keys: p.keys.map((k) => k) }, 'macos')
    const k = mac.keys[0].action
    expect(k.type === 'hotkey' ? k.keys : []).toEqual(
      p.keys[0].action.type === 'hotkey' ? p.keys[0].action.keys : []
    )
    expect(resolveProfileForOs(p, 'windows')).toBe(p)
  })

  it('is 17 lines: begin, 12 keys, 3 knob actions, end', () => {
    const lines = slotFrames(defaultConfig().studioProfiles[0])
    expect(lines).toHaveLength(17)
    expect(lines[0]).toBe('SLOT_BEGIN\tBrowser\tKNOB:TAB')
    expect(lines[16]).toBe('SLOT_END')
    expect(lines[1]).toMatch(/^SLOT_KEY\t0\ttools\t#[0-9A-Fa-f]{6}\t\{"type":"key","key":"F12"\}$/)
    expect(lines[12]).toBe('SLOT_KEY\t11\tFN\t#303030\t{"type":"fn"}')
    expect(lines.slice(13, 16).map((l) => l.split('\t')[1])).toEqual(['12', '13', '14'])
  })

  it('a sequence goes as its key line without steps, then one SLOT_STEP per step', () => {
    const terminal = defaultConfig().profiles[2] // its "rerun" key is a two-step sequence
    const lines = slotFrames(terminal)
    const at = lines.findIndex((l) => l.startsWith('SLOT_KEY\t2\t'))
    expect(lines[at]).toMatch(/^SLOT_KEY\t2\trerun\t#[0-9A-Fa-f]{6}\t\{"type":"sequence"\}$/)
    expect(lines.slice(at + 1, at + 3)).toEqual(['SLOT_STEP\t2\tUP\t100', 'SLOT_STEP\t2\tENTER\t0'])
    expect(lines[at + 3].startsWith('SLOT_KEY\t3\t')).toBe(true)
    expect(lines).toHaveLength(17 + 2)
    expect(lines.every((l) => !l.includes('"steps"'))).toBe(true) // no step list is ever sent as JSON
  })

  it('the steps of a combo are joined with +', () => {
    const p = blankProfile('x', 'X')
    p.keys[0] = {
      label: 's',
      color: '#112233',
      action: {
        type: 'sequence',
        steps: [
          { keys: ['CTRL', 'SHIFT', 'K'], wait: 250 },
          { keys: ['ENTER'], wait: 0 }
        ]
      }
    }
    const lines = slotFrames(p)
    expect(lines).toContain('SLOT_STEP\t0\tCTRL+SHIFT+K\t250')
  })

  it('knob actions go in the order right, left, press', () => {
    const p = defaultConfig().studioProfiles[0]
    const lines = slotFrames(p)
    const action = (l: string): unknown => JSON.parse(l.split('\t')[4])
    expect(action(lines[13])).toEqual(p.encoder.cw)
    expect(action(lines[14])).toEqual(p.encoder.ccw)
    expect(action(lines[15])).toEqual(p.encoder.press)
  })

  it('every line is a single line: no raw tabs or breaks inside a field', () => {
    const p = blankProfile('x', 'Na\tme\n')
    p.keys[0] = {
      label: 'a\tb',
      color: '#112233',
      action: { type: 'text', text: 'one\ttwo\nthree' }
    }
    for (const l of slotFrames(p)) {
      expect(l).not.toMatch(/[\r\n]/)
      if (l.startsWith('SLOT_KEY')) expect(l.split('\t')).toHaveLength(5)
    }
  })

  it('the APP line carries the slot flag only when asked', () => {
    expect(appLine('chrome', 'Google')).toBe('APP\tchrome\tGoogle')
    expect(appLine('chrome', 'Google', true)).toBe('APP\tchrome\tGoogle\tS')
  })

  it('the pad reports the slot as the profile after its own', () => {
    expect(parseEvent('EVT\tlayer\t3')).toEqual({ kind: 'layer', index: 3 })
    expect(parseEvent('EVT\tlayer\t4')).toBeNull()
  })

  it('only pads from firmware 0.5.0 have the slot', () => {
    expect(SLOT_FIRMWARE).toBe('0.5.0')
    const on = (firmware?: string): boolean => hasSlot({ status: 'connected', firmware })
    expect(on('0.5.0')).toBe(true)
    expect(on('0.5.1')).toBe(true)
    expect(on('0.4.2')).toBe(false)
    expect(on(undefined)).toBe(false)
    expect(hasSlot({ status: 'disconnected', firmware: '0.5.0' })).toBe(false)
  })
})

describe('the Studio-only profiles never make the config "unsent"', () => {
  it('editing one does not change the sync status', () => {
    const base = defaultConfig()
    const edited = structuredClone(base)
    edited.studioProfiles[0].keys[0].label = 'new'
    expect(sameConfig(base, edited)).toBe(true)
    expect(syncStatus(true, false, edited, base)).toBe('in-sync')
  })

  it('editing a pad profile does', () => {
    const base = defaultConfig()
    const edited = structuredClone(base)
    edited.profiles[1].keys[0].label = 'new'
    expect(sameConfig(base, edited)).toBe(false)
    expect(syncStatus(true, false, edited, base)).toBe('unsent')
  })
})

describe('DeviceManager and the Studio slot', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const lines = (link: MockLink, prefix: string): string[] =>
    link.log.filter((l) => l.startsWith(prefix))
  const connect = async (
    firmware = SLOT_FIRMWARE,
    config = defaultConfig()
  ): Promise<{ m: DeviceManager; link: MockLink }> => {
    const m = new DeviceManager()
    const link = new MockLink(firmware, false)
    m.setConfig(config)
    attach(m, link)
    await vi.advanceTimersByTimeAsync(50) // the HELLO answer
    return { m, link }
  }
  const settle = (): Promise<void> => vi.advanceTimersByTimeAsync(400)

  it('puts the profile on the slot and then names the slot in the APP line', async () => {
    const { m, link } = await connect()
    m.sendApp('chrome', 'Google')
    await settle()
    expect(link.slot?.name).toBe('Browser')
    expect(Object.keys(link.slot?.keys ?? {})).toHaveLength(15)
    expect(lines(link, 'SLOT_')).toHaveLength(17)
    expect(link.log.at(-1)).toBe('APP\tchrome\tGoogle\tS')
    expect(m.state.slot).toBe('browser')
    m.stop()
  })

  it('a profile with a sequence reaches the pad step by step', async () => {
    const config = defaultConfig()
    const term = structuredClone(config.profiles[2])
    term.id = 'term2'
    term.name = 'Term 2'
    term.match = { windows: ['mytool'], macos: [], titles: [] }
    config.studioProfiles.push(term)
    const { m, link } = await connect(SLOT_FIRMWARE, config)
    m.sendApp('mytool', 'x')
    await settle()
    expect(link.slot?.name).toBe('Term 2')
    expect(link.slot?.keys[2]).toBe('{"type":"sequence"}\nUP\t100\nENTER\t0')
    expect(link.log.at(-1)).toBe('APP\tmytool\tx\tS')
    m.stop()
  })

  it('a YouTube tab in Brave gets the Youtube profile, not Browser, and other Brave pages still get Browser', async () => {
    const config = defaultConfig()
    const yt = blankProfile('youtube', 'Youtube')
    yt.match = { windows: ['brave'], macos: [], titles: ['youtube'] }
    config.studioProfiles.push(yt) // after Browser, which also names Brave
    const { m, link } = await connect(SLOT_FIRMWARE, config)
    m.sendApp('brave', 'Lofi hip hop - YouTube - Brave')
    await settle()
    expect(link.slot?.name).toBe('Youtube')
    expect(link.log.at(-1)).toBe('APP\tbrave\tLofi hip hop - YouTube - Brave\tS')
    m.sendApp('brave', 'Inbox - Gmail - Brave')
    await settle()
    expect(link.slot?.name).toBe('Browser')
    m.stop()
  })

  it('a Studio-only profile that fits an app better than the pad’s own profile takes it, and an equal fit stays on the pad', async () => {
    const config = defaultConfig()
    const own = blankProfile('ownbrowser', 'Own browser')
    own.match = { windows: ['brave'], macos: [], titles: [] }
    config.profiles.splice(1, 0, own) // on the pad, names Brave (the VS Code profile moves along, three in all)
    config.profiles.pop()
    const yt = blankProfile('youtube', 'Youtube')
    yt.match = { windows: [], macos: [], titles: ['youtube'] }
    config.studioProfiles = [yt]
    const { m, link } = await connect(SLOT_FIRMWARE, config)
    m.sendApp('brave', 'Gmail - Brave') // only the pad's profile fits
    await settle()
    expect(lines(link, 'SLOT_BEGIN')).toHaveLength(0)
    expect(link.log.at(-1)).toBe('APP\tbrave\tGmail - Brave')
    m.sendApp('brave', 'Lofi - YouTube - Brave') // the title word fits better than the program
    await settle()
    expect(link.slot?.name).toBe('Youtube')
    expect(link.log.at(-1)).toBe('APP\tbrave\tLofi - YouTube - Brave\tS')
    // equal fit: the pad's own profile keeps it
    const same = blankProfile('same', 'Same')
    same.match = { windows: ['brave'], macos: [], titles: [] }
    config.studioProfiles = [same]
    m.setConfig(config)
    m.sendApp('brave', 'Gmail - Brave')
    expect(link.log.at(-1)).toBe('APP\tbrave\tGmail - Brave')
    m.stop()
  })

  it('does not send it again while it is still there', async () => {
    const { m, link } = await connect()
    m.sendApp('chrome', 'Google')
    await settle()
    m.sendApp('chrome', 'Google')
    m.sendApp('chrome', 'Another tab')
    await settle()
    expect(lines(link, 'SLOT_BEGIN')).toHaveLength(1)
    expect(link.log.at(-1)).toBe('APP\tchrome\tAnother tab\tS')
    m.stop()
  })

  it('an app the pad has a profile for is left to the pad', async () => {
    const { m, link } = await connect()
    m.sendApp('code', 'main.ts')
    await settle()
    expect(lines(link, 'SLOT_')).toHaveLength(0)
    expect(link.log.at(-1)).toBe('APP\tcode\tmain.ts')
    m.stop()
  })

  it('an app nobody has a profile for is a plain APP line', async () => {
    const { m, link } = await connect()
    m.sendApp('notepad', 'Untitled')
    expect(link.log.at(-1)).toBe('APP\tnotepad\tUntitled')
    expect(lines(link, 'SLOT_')).toHaveLength(0)
    m.stop()
  })

  it('a pad before firmware 0.5.0 gets plain APP lines and no slot', async () => {
    const { m, link } = await connect('0.4.2')
    m.sendApp('chrome', 'Google')
    await settle()
    expect(lines(link, 'SLOT_')).toHaveLength(0)
    expect(link.log.at(-1)).toBe('APP\tchrome\tGoogle')
    m.stop()
  })

  it('a pad that has not said its firmware yet gets plain APP lines', async () => {
    const m = new DeviceManager()
    const link = new MockLink(SLOT_FIRMWARE, false)
    m.setConfig(defaultConfig())
    attach(m, link)
    m.sendApp('chrome', 'Google') // before the HELLO answer
    expect(link.log.at(-1)).toBe('APP\tchrome\tGoogle')
    m.stop()
  })

  it('switching between two Studio profiles sends the second', async () => {
    const config = defaultConfig()
    const obs = blankProfile('obs', 'OBS')
    obs.match = { windows: ['obs64'], macos: [], titles: [] }
    config.studioProfiles.push(obs)
    const { m, link } = await connect(SLOT_FIRMWARE, config)
    m.sendApp('chrome', 'x')
    await settle()
    m.sendApp('obs64', 'OBS')
    await settle()
    expect(lines(link, 'SLOT_BEGIN')).toEqual([
      'SLOT_BEGIN\tBrowser\tKNOB:TAB',
      'SLOT_BEGIN\tOBS\tKNOB:VOL'
    ])
    expect(link.slot?.name).toBe('OBS')
    expect(m.state.slot).toBe('obs')
    expect(link.log.at(-1)).toBe('APP\tobs64\tOBS\tS')
    m.stop()
  })

  it('a profile that was edited is sent again', async () => {
    const config = defaultConfig()
    const { m, link } = await connect(SLOT_FIRMWARE, config)
    m.sendApp('chrome', 'x')
    await settle()
    const edited = structuredClone(config)
    edited.studioProfiles[0].keys[0].label = 'new'
    m.setConfig(edited)
    m.sendApp('chrome', 'x')
    await settle()
    expect(lines(link, 'SLOT_BEGIN')).toHaveLength(2)
    expect(lines(link, 'SLOT_KEY\t0\tnew')).toHaveLength(1)
    m.stop()
  })

  it('changing only the apps of a profile does not resend it', async () => {
    const config = defaultConfig()
    const { m, link } = await connect(SLOT_FIRMWARE, config)
    m.sendApp('chrome', 'x')
    await settle()
    const edited = structuredClone(config)
    edited.studioProfiles[0].match.windows.push('arc')
    m.setConfig(edited)
    m.sendApp('arc', 'x')
    await settle()
    expect(lines(link, 'SLOT_BEGIN')).toHaveLength(1)
    expect(link.log.at(-1)).toBe('APP\tarc\tx\tS')
    m.stop()
  })

  it('a new pad connection starts with an empty slot, so the profile is sent again', async () => {
    const { m } = await connect()
    m.sendApp('chrome', 'x')
    await settle()
    const again = new MockLink(SLOT_FIRMWARE, false)
    attach(m, again)
    await vi.advanceTimersByTimeAsync(50)
    expect(m.state.slot).toBeUndefined()
    m.sendApp('chrome', 'x')
    await settle()
    expect(again.slot?.name).toBe('Browser')
    m.stop()
  })

  it('a pad that refuses the profile gets plain APP lines, and Studio waits before trying again', async () => {
    const m = new DeviceManager()
    const link = new MockLink(SLOT_FIRMWARE, false)
    const write = link.write.bind(link)
    link.write = (line) => {
      if (line.startsWith('SLOT_KEY\t5\t')) {
        link.log.push(line)
        setTimeout(() => link.emit('ERR\tbad key'), 5)
        return
      }
      write(line)
    }
    m.setConfig(defaultConfig())
    attach(m, link)
    await vi.advanceTimersByTimeAsync(50)
    m.sendApp('chrome', 'x')
    await settle()
    expect(m.state.slot).toBeUndefined()
    expect(link.log).toContain('APP\tchrome\tx') // the pad was told the app, without the slot flag
    expect(link.log.filter((l) => l.endsWith('\tS'))).toHaveLength(0)
    m.sendApp('chrome', 'x')
    await settle()
    expect(link.log.at(-1)).toBe('APP\tchrome\tx')
    expect(lines(link, 'SLOT_BEGIN')).toHaveLength(1) // not hammered
    await vi.advanceTimersByTimeAsync(11000)
    m.sendApp('chrome', 'x')
    await settle()
    expect(lines(link, 'SLOT_BEGIN')).toHaveLength(2)
    m.stop()
  })

  /** A pad whose slot refuses every profile with this answer to SLOT_END. */
  const refusing = async (answer: string): Promise<{ m: DeviceManager; link: MockLink }> => {
    const m = new DeviceManager()
    const link = new MockLink(SLOT_FIRMWARE, false)
    const write = link.write.bind(link)
    link.write = (line) => {
      if (line === 'SLOT_END') {
        link.log.push(line)
        setTimeout(() => link.emit(answer), 5)
        return
      }
      write(line)
    }
    m.setConfig(defaultConfig())
    attach(m, link)
    await vi.advanceTimersByTimeAsync(50)
    return { m, link }
  }

  it('a profile the pad finds too big is reported, and not sent again until it changes', async () => {
    const { m, link } = await refusing('ERR\tprofile too big for the pad')
    m.sendApp('chrome', 'x')
    await settle()
    expect(m.state.slotError).toEqual({ id: 'browser', reason: 'too big' })
    expect(m.state.slot).toBeUndefined()
    await vi.advanceTimersByTimeAsync(60000) // far longer than any retry pause
    m.sendApp('chrome', 'x')
    await settle()
    expect(lines(link, 'SLOT_BEGIN')).toHaveLength(1)
    expect(link.log.at(-1)).toBe('APP\tchrome\tx') // meanwhile the pad matches by itself
    // an edit gives it another try, and takes the warning away at once
    const edited = defaultConfig()
    edited.studioProfiles[0].keys[0].label = 'new'
    m.setConfig(edited)
    expect(m.state.slotError).toBeUndefined()
    m.sendApp('chrome', 'x')
    await settle()
    expect(lines(link, 'SLOT_BEGIN')).toHaveLength(2)
    m.stop()
  })

  it('an out-of-memory error from the pad counts as too big', async () => {
    const { m } = await refusing('ERR\tmemory allocation failed, allocating 140 bytes')
    m.sendApp('chrome', 'x')
    await settle()
    expect(m.state.slotError).toEqual({ id: 'browser', reason: 'too big' })
    m.stop()
  })

  it('any other refusal is shown with the pad’s own words and tried again after a pause', async () => {
    const { m, link } = await refusing('ERR\tbad key')
    m.sendApp('chrome', 'x')
    await settle()
    expect(m.state.slotError).toEqual({ id: 'browser', reason: 'bad key' })
    await vi.advanceTimersByTimeAsync(11000)
    m.sendApp('chrome', 'x')
    await settle()
    expect(lines(link, 'SLOT_BEGIN')).toHaveLength(2)
    m.stop()
  })

  it('the warning goes away when the profile is accepted', async () => {
    const { m } = await connect()
    m.sendApp('chrome', 'x')
    await settle()
    expect(m.state.slotError).toBeUndefined()
    expect(m.state.slot).toBe('browser')
    m.stop()
  })

  describe('Try on pad', () => {
    it('puts the profile on the slot and shows it, without its app being in focus', async () => {
      const { m, link } = await connect()
      const done = m.tryProfile(defaultConfig().studioProfiles[0])
      await settle()
      expect(await done).toEqual({ ok: true })
      expect(link.slot?.name).toBe('Browser')
      expect(link.log.at(-1)).toBe('APP\tsnekpad-preview\tTry on pad\tS')
      expect(m.state.slot).toBe('browser')
      m.stop()
    })

    it('holds it on the pad while the focus line keeps coming, for 15 seconds', async () => {
      const { m, link } = await connect()
      const done = m.tryProfile(defaultConfig().studioProfiles[0])
      await settle()
      await done
      m.sendApp('notepad', 'Untitled') // an app with no profile: it would normally be General
      expect(link.log.at(-1)).toBe('APP\tnotepad\tUntitled\tS')
      await vi.advanceTimersByTimeAsync(14000)
      m.sendApp('notepad', 'Untitled')
      expect(link.log.at(-1)).toBe('APP\tnotepad\tUntitled\tS')
      await vi.advanceTimersByTimeAsync(2000) // 16 s in
      m.sendApp('notepad', 'Untitled')
      expect(link.log.at(-1)).toBe('APP\tnotepad\tUntitled') // back to normal
      m.stop()
    })

    it('does not send the profile again when it is already there', async () => {
      const { m, link } = await connect()
      m.sendApp('chrome', 'x') // its own app puts it there
      await settle()
      const done = m.tryProfile(defaultConfig().studioProfiles[0])
      await settle()
      await done
      expect(lines(link, 'SLOT_BEGIN')).toHaveLength(1)
      m.stop()
    })

    it('shows an edit while it is on the pad', async () => {
      const config = defaultConfig()
      const { m, link } = await connect(SLOT_FIRMWARE, config)
      const done = m.tryProfile(config.studioProfiles[0])
      await settle()
      await done
      const edited = structuredClone(config)
      edited.studioProfiles[0].keys[0].label = 'new'
      m.setConfig(edited)
      m.sendApp('notepad', 'x') // the focus line that follows
      await settle()
      expect(lines(link, 'SLOT_KEY\t0\tnew')).toHaveLength(1)
      expect(link.slot?.keys[0]).toContain('F12')
      m.stop()
    })

    it('works for a profile that has not been saved yet', async () => {
      const { m, link } = await connect()
      const fresh = blankProfile('fresh', 'Fresh') // not in the config the manager knows
      const done = m.tryProfile(fresh)
      await settle()
      expect((await done).ok).toBe(true)
      expect(link.slot?.name).toBe('Fresh')
      m.sendApp('notepad', 'x')
      expect(link.log.at(-1)).toBe('APP\tnotepad\tx\tS')
      m.stop()
    })

    it('says why when the pad is too old, or not there, or busy updating', async () => {
      const old = await connect('0.4.2')
      expect(await old.m.tryProfile(defaultConfig().studioProfiles[0])).toEqual({
        ok: false,
        error: 'This pad needs firmware 0.5.0 or newer for Studio profiles.'
      })
      old.m.stop()
      const none = new DeviceManager()
      expect(await none.tryProfile(defaultConfig().studioProfiles[0])).toEqual({
        ok: false,
        error: 'pad not connected'
      })
    })

    it('says so when the pad finds the profile too big, and shows the warning', async () => {
      const m = new DeviceManager()
      const link = new MockLink(SLOT_FIRMWARE, false)
      const write = link.write.bind(link)
      link.write = (line) => {
        if (line === 'SLOT_END') {
          link.log.push(line)
          setTimeout(() => link.emit('ERR\tprofile too big for the pad'), 5)
          return
        }
        write(line)
      }
      m.setConfig(defaultConfig())
      attach(m, link)
      await vi.advanceTimersByTimeAsync(50)
      const done = m.tryProfile(defaultConfig().studioProfiles[0])
      await settle()
      expect(await done).toEqual({
        ok: false,
        error: 'It is too big for the pad: use fewer or shorter macros.'
      })
      expect(m.state.slotError).toEqual({ id: 'browser', reason: 'too big' })
      m.sendApp('notepad', 'x')
      expect(link.log.at(-1)).toBe('APP\tnotepad\tx') // nothing is held on the pad
      m.stop()
    })

    it('a new connection forgets it', async () => {
      const { m } = await connect()
      const done = m.tryProfile(defaultConfig().studioProfiles[0])
      await settle()
      await done
      const again = new MockLink(SLOT_FIRMWARE, false)
      attach(m, again)
      await vi.advanceTimersByTimeAsync(50)
      m.sendApp('notepad', 'x')
      expect(again.log.at(-1)).toBe('APP\tnotepad\tx')
      m.stop()
    })
  })

  it('a push sends the pad its own profiles only', async () => {
    const { m, link } = await connect()
    const done = m.push(defaultConfig())
    await vi.advanceTimersByTimeAsync(500)
    expect((await done).ok).toBe(true)
    const sent = JSON.parse(link.config) as Partial<Config>
    expect(sent.profiles).toHaveLength(3)
    expect(sent.studioProfiles).toBeUndefined()
    m.stop()
  })

  it('after a push the pad has restarted, so the slot is sent again', async () => {
    const { m, link } = await connect()
    m.sendApp('chrome', 'x')
    await settle()
    const done = m.push(defaultConfig())
    await vi.advanceTimersByTimeAsync(500)
    await done
    expect(m.state.slot).toBeUndefined()
    await vi.advanceTimersByTimeAsync(3000) // greets the restarted pad again
    m.sendApp('chrome', 'x')
    await settle()
    expect(lines(link, 'SLOT_BEGIN')).toHaveLength(2)
    m.stop()
  })
})
