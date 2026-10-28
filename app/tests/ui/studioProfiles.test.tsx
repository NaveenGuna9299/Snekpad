// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import App from '../../src/renderer/src/App'
import { SLOT_FIRMWARE } from '../../src/shared/firmware'
import type { DeviceState, SnekApi } from '../../src/shared/api'
import { blankProfile, defaultConfig, type Config, type Profile } from '../../src/shared/config'
import { installApi, type StubApi } from './stubApi'

const pad = (extra: Partial<DeviceState> = {}): DeviceState => ({
  status: 'connected',
  kind: 'serial',
  label: 'SnekPad on COM3',
  events: true,
  firmware: SLOT_FIRMWARE,
  ...extra
})

const api = (o: Record<string, unknown>): Partial<SnekApi> => o as unknown as Partial<SnekApi>

/** Opens the editor (the list of profiles is on its left). */
async function editor(
  device: DeviceState = pad(),
  overrides: Partial<SnekApi> = {}
): Promise<{ stub: StubApi; side: HTMLElement }> {
  const stub = installApi(device, overrides)
  render(<App />)
  await userEvent.click(await screen.findByRole('button', { name: 'Open SnekPad settings' }))
  return { stub, side: screen.getByRole('complementary') }
}

const profileButton = (side: HTMLElement, name: string): HTMLElement =>
  within(side).getByRole('button', { name: new RegExp(`^${name}`) })

describe('the two groups of profiles', () => {
  it('lists the pad’s own profiles and the Studio-only ones apart, with their counts', async () => {
    const { side } = await editor()
    expect(within(side).getByText('On the pad')).toBeTruthy()
    expect(within(side).getByText('Studio only')).toBeTruthy()
    expect(within(side).getByText('3/3')).toBeTruthy()
    expect(within(side).getByText('1/7')).toBeTruthy()
    for (const name of ['General', 'VS Code', 'Terminal', 'Browser'])
      expect(profileButton(side, name)).toBeTruthy()
  })

  it('moves a profile to Studio only and back, and the counts follow', async () => {
    const { side } = await editor()
    await userEvent.click(profileButton(side, 'Terminal'))
    await userEvent.click(within(side).getByRole('button', { name: 'Move to Studio only' }))
    expect(within(side).getByText('2/3')).toBeTruthy()
    expect(within(side).getByText('2/7')).toBeTruthy()
    // it stays selected, now in the other group
    expect(profileButton(side, 'Terminal').getAttribute('aria-current')).toBe('true')
    await userEvent.click(within(side).getByRole('button', { name: 'Move to the pad' }))
    expect(within(side).getByText('3/3')).toBeTruthy()
  })

  it('will not move a profile onto a full pad, and says why', async () => {
    const { side } = await editor()
    await userEvent.click(profileButton(side, 'Browser'))
    const move = within(side).getByRole('button', { name: 'Move to the pad' }) as HTMLButtonElement
    expect(move.disabled).toBe(true)
    expect(within(side).getByText('The pad holds at most 3 profiles.')).toBeTruthy()
  })

  it('General cannot be moved', async () => {
    const { side } = await editor()
    const move = within(side).getByRole('button', {
      name: 'Move to Studio only'
    }) as HTMLButtonElement
    expect(move.disabled).toBe(true) // General is selected first
  })

  it('a new profile goes to Studio only when the pad is full, and to the pad when it has room', async () => {
    const { side } = await editor()
    await userEvent.click(within(side).getByRole('button', { name: 'New' }))
    expect(within(side).getByText('2/7')).toBeTruthy()
    // free a place on the pad: move VS Code away, then the next new profile fills it
    await userEvent.click(profileButton(side, 'VS Code'))
    await userEvent.click(within(side).getByRole('button', { name: 'Move to Studio only' }))
    expect(within(side).getByText('2/3')).toBeTruthy()
    await userEvent.click(within(side).getByRole('button', { name: 'New' }))
    expect(within(side).getByText('3/3')).toBeTruthy()
  })

  it('shows the pad’s refusal under the profile it concerns', async () => {
    const { side } = await editor(pad({ slotError: { id: 'browser', reason: 'too big' } }))
    expect(within(side).getByRole('alert').textContent).toContain('Too big for the pad')
  })

  it('warns when the pad cannot take Studio-only profiles yet (older firmware)', async () => {
    const { side } = await editor(pad({ firmware: '0.4.2' }))
    expect(within(side).getByRole('note').textContent).toContain('firmware cannot take them yet')
  })

  it('shows which profile the pad is running, for a pad profile and for the Studio slot', async () => {
    const { stub, side } = await editor(pad({ activeProfile: 1 }))
    expect(within(profileButton(side, 'VS Code')).getByText('On pad')).toBeTruthy()
    act(() => stub.setDevice(pad({ activeProfile: 3, slot: 'browser' })))
    await waitFor(() =>
      expect(within(profileButton(side, 'Browser')).getByText('On pad')).toBeTruthy()
    )
    expect(
      within(profileButton(side, 'VS Code').parentElement as HTMLElement).queryByText('On pad')
    ).toBeNull()
  })
})

describe('window-title rules', () => {
  const titlesOf = (saved: ReturnType<typeof vi.fn>): string[] | undefined => {
    const last = saved.mock.calls.at(-1)?.[0] as Config | undefined
    return last?.studioProfiles[0].match.titles
  }

  it('adds a word with the button or Enter, and saves it with the profile', async () => {
    const saveConfig = vi.fn(() => Promise.resolve({ ok: true as const }))
    const { side } = await editor(pad(), api({ saveConfig }))
    await userEvent.click(profileButton(side, 'Browser'))
    const input = screen.getByLabelText('Word in the window title') as HTMLInputElement
    await userEvent.type(input, 'YouTube')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await userEvent.type(input, 'Gmail{Enter}')
    expect(input.value).toBe('')
    expect(
      within(screen.getByRole('list', { name: 'Title words' })).getAllByRole('listitem')
    ).toHaveLength(2)
    await waitFor(() => expect(titlesOf(saveConfig)).toEqual(['YouTube', 'Gmail']), {
      timeout: 3000
    })
    // and the sidebar says what the profile switches on
    expect(within(side).getByText(/“YouTube”, “Gmail”/)).toBeTruthy()
  })

  it('ignores an empty word and a word it already has (capitals do not matter)', async () => {
    const { side } = await editor()
    await userEvent.click(profileButton(side, 'Browser'))
    const add = screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    const input = screen.getByLabelText('Word in the window title')
    await userEvent.type(input, 'figma{Enter}')
    await userEvent.type(input, 'FIGMA')
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByRole('listitem', { name: '' }).length).toBeGreaterThan(0)
  })

  it('removes a word', async () => {
    const c = defaultConfig()
    c.studioProfiles[0].match.titles = ['one', 'two']
    const { side } = await editor(pad(), api({ loadConfig: () => Promise.resolve(c) }))
    await userEvent.click(profileButton(side, 'Browser'))
    await userEvent.click(screen.getByRole('button', { name: 'Remove one' }))
    const list = screen.getByRole('list', { name: 'Title words' })
    expect(within(list).queryByText('one')).toBeNull()
    expect(within(list).getByText('two')).toBeTruthy()
  })

  it('stops at six words', async () => {
    const c = defaultConfig()
    c.studioProfiles[0].match.titles = ['a', 'b', 'c', 'd', 'e', 'f']
    const { side } = await editor(pad(), api({ loadConfig: () => Promise.resolve(c) }))
    await userEvent.click(profileButton(side, 'Browser'))
    expect((screen.getByLabelText('Word in the window title') as HTMLInputElement).disabled).toBe(
      true
    )
  })

  it('a profile that only has title words does not say "No app set"', async () => {
    const c = defaultConfig()
    const p = blankProfile('site', 'Site')
    p.match.titles = ['figma']
    c.studioProfiles.push(p)
    const { side } = await editor(pad(), api({ loadConfig: () => Promise.resolve(c) }))
    const row = profileButton(side, 'Site')
    expect(row.textContent).not.toContain('No app set')
    expect(row.textContent).toContain('“figma”')
  })

  it('General has no rules to edit', async () => {
    await editor()
    expect(screen.queryByLabelText('Word in the window title')).toBeNull()
  })
})

describe('the size meter', () => {
  it('shows for a Studio-only profile, not for one on the pad', async () => {
    const { side } = await editor()
    expect(screen.queryByRole('progressbar')).toBeNull() // General is selected
    await userEvent.click(profileButton(side, 'Browser'))
    const bar = screen.getByRole('progressbar', { name: 'Pad memory used by this profile' })
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(0)
    expect(screen.getByText('Fits on the pad.')).toBeTruthy()
    await userEvent.click(profileButton(side, 'Terminal'))
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('warns when a Studio-only profile is too big for the pad', async () => {
    const c = defaultConfig()
    const big: Profile = blankProfile('big', 'Big')
    for (let i = 0; i < 11; i++)
      big.keys[i].action = {
        type: 'sequence',
        steps: Array.from({ length: 6 }, (_, n) => ({
          keys: ['CTRL', 'SHIFT', 'ALT', 'K'],
          wait: n < 5 ? 100 : 0
        }))
      }
    c.studioProfiles.push(big)
    const { side } = await editor(pad(), api({ loadConfig: () => Promise.resolve(c) }))
    await userEvent.click(profileButton(side, 'Big'))
    expect(screen.getByText(/pad will probably refuse this profile/)).toBeTruthy()
  })
})

describe('Try on pad', () => {
  it('shows the selected Studio-only profile on the pad, and says so', async () => {
    const tryProfile = vi.fn(() => Promise.resolve({ ok: true as const }))
    const { side } = await editor(pad(), api({ tryProfile }))
    await userEvent.click(profileButton(side, 'Browser'))
    await userEvent.click(screen.getByRole('button', { name: 'Try on pad' }))
    expect(tryProfile).toHaveBeenCalledOnce()
    expect((tryProfile.mock.calls[0] as unknown as [Profile])[0].id).toBe('browser')
    expect(await screen.findByText(/Showing "Browser" on the pad/)).toBeTruthy()
  })

  it('says why when the pad cannot show it', async () => {
    const tryProfile = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: 'It is too big for the pad.' })
    )
    const { side } = await editor(pad(), api({ tryProfile }))
    await userEvent.click(profileButton(side, 'Browser'))
    await userEvent.click(screen.getByRole('button', { name: 'Try on pad' }))
    expect(await screen.findByText(/Could not show it on the pad: It is too big/)).toBeTruthy()
  })

  it('is there only for Studio-only profiles, and off without a pad', async () => {
    const { side } = await editor({ status: 'disconnected' })
    expect(screen.queryByRole('button', { name: 'Try on pad' })).toBeNull() // General
    await userEvent.click(profileButton(side, 'Browser'))
    expect((screen.getByRole('button', { name: 'Try on pad' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })
})

describe('export and import of a profile', () => {
  it('exports the selected profile', async () => {
    const exportProfile = vi.fn(() =>
      Promise.resolve({ ok: true as const, path: 'C:\\x\\browser.json' })
    )
    const { side } = await editor(pad(), api({ exportProfile }))
    await userEvent.click(profileButton(side, 'Browser'))
    await userEvent.click(within(side).getByRole('button', { name: 'Export…' }))
    expect((exportProfile.mock.calls[0] as unknown as [Profile])[0].name).toBe('Browser')
    expect(await screen.findByText(/Saved "Browser" to C:\\x\\browser.json/)).toBeTruthy()
  })

  it('says nothing when the file dialog is closed', async () => {
    const exportProfile = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: 'Cancelled.', cancelled: true })
    )
    const { side } = await editor(pad(), api({ exportProfile }))
    await userEvent.click(within(side).getByRole('button', { name: 'Export…' }))
    await waitFor(() => expect(exportProfile).toHaveBeenCalled())
    expect(screen.queryByText(/Cancelled|Could not export/)).toBeNull()
  })

  it('shows an export error', async () => {
    const exportProfile = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: 'Could not write the file: disk full' })
    )
    const { side } = await editor(pad(), api({ exportProfile }))
    await userEvent.click(within(side).getByRole('button', { name: 'Export…' }))
    expect(
      await screen.findByText(/Could not export: Could not write the file: disk full/)
    ).toBeTruthy()
  })

  it('imports a profile under a new id, in Studio only while the pad is full, and selects it', async () => {
    const incoming = blankProfile('browser', 'Imported') // the same id as one that exists
    const importProfile = vi.fn(() =>
      Promise.resolve({ ok: true as const, profile: incoming, file: 'x.json' })
    )
    const { side } = await editor(pad(), api({ importProfile }))
    await userEvent.click(within(side).getByRole('button', { name: 'Import…' }))
    expect(await screen.findByText(/Imported "Imported"/)).toBeTruthy()
    expect(within(side).getByText('2/7')).toBeTruthy()
    expect(profileButton(side, 'Imported').getAttribute('aria-current')).toBe('true')
    expect(profileButton(side, 'Browser')).toBeTruthy() // the existing one is untouched
  })

  it('shows why a file could not be imported', async () => {
    const importProfile = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: 'This is not a SnekPad file.' })
    )
    const { side } = await editor(pad(), api({ importProfile }))
    await userEvent.click(within(side).getByRole('button', { name: 'Import…' }))
    expect(await screen.findByText('This is not a SnekPad file.')).toBeTruthy()
  })

  it('cannot import when all ten places are taken', async () => {
    const c = defaultConfig()
    while (c.studioProfiles.length < 7)
      c.studioProfiles.push(blankProfile(`s${c.studioProfiles.length}`, 'S'))
    const { side } = await editor(pad(), api({ loadConfig: () => Promise.resolve(c) }))
    expect(
      (within(side).getByRole('button', { name: 'Import…' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
})

describe('backup and restore', () => {
  const home = async (overrides: Partial<SnekApi>): Promise<void> => {
    installApi(pad(), overrides)
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /Settings/ }))
  }

  it('backs up the whole config, the Studio-only profiles too', async () => {
    const exportBackup = vi.fn(() =>
      Promise.resolve({ ok: true as const, path: 'C:\\b\\backup.json' })
    )
    await home(api({ exportBackup }))
    await userEvent.click(screen.getByRole('button', { name: 'Back up all profiles…' }))
    const sent = (exportBackup.mock.calls[0] as unknown as [Config])[0]
    expect(sent.studioProfiles.map((p) => p.id)).toEqual(['browser'])
    expect(sent.profiles).toHaveLength(3)
    expect(await screen.findByText(/Backed up to C:\\b\\backup.json/)).toBeTruthy()
  })

  it('restores a backup over what is there, with Undo', async () => {
    const restored = defaultConfig()
    restored.studioProfiles = [blankProfile('old', 'From backup')]
    const importBackup = vi.fn(() =>
      Promise.resolve({ ok: true as const, config: restored, file: 'b.json' })
    )
    await home(api({ importBackup }))
    await userEvent.click(screen.getByRole('button', { name: 'Restore from a backup…' }))
    expect(await screen.findByText(/Restored from the backup/)).toBeTruthy()
    // the editor shows what was restored
    await userEvent.click(screen.getByRole('button', { name: 'Open SnekPad settings' }))
    const side = screen.getByRole('complementary')
    expect(profileButton(side, 'From backup')).toBeTruthy()
    expect(within(side).queryByRole('button', { name: /^Browser/ })).toBeNull()
  })

  it('leaves everything alone when the file cannot be used', async () => {
    const importBackup = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: 'This backup cannot be used: profiles: Too big'
      })
    )
    await home(api({ importBackup }))
    await userEvent.click(screen.getByRole('button', { name: 'Restore from a backup…' }))
    expect(await screen.findByText(/This backup cannot be used/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open SnekPad settings' }))
    expect(profileButton(screen.getByRole('complementary'), 'Browser')).toBeTruthy()
  })

  it('says nothing when the file dialog is closed', async () => {
    const importBackup = vi.fn(() =>
      Promise.resolve({ ok: false as const, error: 'Cancelled.', cancelled: true })
    )
    await home(api({ importBackup }))
    await userEvent.click(screen.getByRole('button', { name: 'Restore from a backup…' }))
    await waitFor(() => expect(importBackup).toHaveBeenCalled())
    expect(screen.queryByText('Cancelled.')).toBeNull()
  })
})
