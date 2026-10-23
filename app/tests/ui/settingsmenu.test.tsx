// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsMenu } from '../../src/renderer/src/components/SettingsMenu'
import { MAX_SLEEP_MINUTES } from '../../src/shared/config'
import type { SyncStatus } from '../../src/shared/sync'
import { installApi } from './stubApi'

/** The menu with its own state for the sleep time, like App keeps it in the config. */
function Harness({
  initial = 2,
  onChange,
  connected = true,
  sync = 'in-sync',
  pushing = false,
  onPush = () => {}
}: {
  initial?: number
  onChange: (m: number) => void
  connected?: boolean
  sync?: SyncStatus
  pushing?: boolean
  onPush?: () => void
}): React.JSX.Element {
  const [minutes, setMinutes] = useState(initial)
  return (
    <SettingsMenu
      mock={false}
      onMock={() => {}}
      onReset={() => {}}
      connected={connected}
      sync={sync}
      pushing={pushing}
      onPush={onPush}
      sleepMinutes={minutes}
      onSleepMinutes={(m) => {
        setMinutes(m)
        onChange(m)
      }}
    />
  )
}

async function openMenu(): Promise<HTMLInputElement> {
  await userEvent.click(screen.getByRole('button', { name: /Settings/ }))
  return screen.getByLabelText('Pad sleeps after') as HTMLInputElement
}

describe('Settings: pad sleep time', () => {
  beforeEach(() => {
    installApi()
  })

  it('shows the saved value, 2 minutes by default', async () => {
    render(<Harness onChange={() => {}} />)
    expect((await openMenu()).value).toBe('2')
    expect(screen.getByText(/0 = never/)).toBeTruthy()
  })

  it('shows another saved value, including 0 (never)', async () => {
    render(<Harness initial={0} onChange={() => {}} />)
    expect((await openMenu()).value).toBe('0')
  })

  it('saves a new whole number of minutes as it is typed', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const input = await openMenu()
    await userEvent.clear(input)
    await userEvent.type(input, '15')
    expect(onChange).toHaveBeenLastCalledWith(15)
    expect(input.value).toBe('15')
  })

  it('lets the box be emptied while typing without saving anything, and snaps back when left', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const input = await openMenu()
    await userEvent.clear(input)
    expect(input.value).toBe('')
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.tab()
    expect(input.value).toBe('2')
  })

  it('does not save values outside the range or with decimals', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const input = await openMenu()
    for (const bad of ['-1', String(MAX_SLEEP_MINUTES + 1), '1.5', '999']) {
      await userEvent.clear(input)
      await userEvent.type(input, bad)
    }
    expect(onChange).not.toHaveBeenCalledWith(-1)
    expect(onChange).not.toHaveBeenCalledWith(MAX_SLEEP_MINUTES + 1)
    expect(onChange).not.toHaveBeenCalledWith(1.5)
    expect(onChange).not.toHaveBeenCalledWith(999)
    for (const [value] of onChange.mock.calls) {
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(MAX_SLEEP_MINUTES)
    }
  })

  it('accepts the limits 0 and the maximum', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const input = await openMenu()
    await userEvent.clear(input)
    await userEvent.type(input, '0')
    expect(onChange).toHaveBeenLastCalledWith(0)
    await userEvent.clear(input)
    await userEvent.type(input, String(MAX_SLEEP_MINUTES))
    expect(onChange).toHaveBeenLastCalledWith(MAX_SLEEP_MINUTES)
  })

  it('has a Push to pad button right next to it', async () => {
    const onPush = vi.fn()
    render(<Harness onChange={() => {}} sync="unsent" onPush={onPush} />)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Push to pad' }))
    expect(onPush).toHaveBeenCalledOnce()
  })

  it('cannot push without a pad, and says why', async () => {
    render(<Harness onChange={() => {}} connected={false} sync="no-pad" />)
    await openMenu()
    const button = screen.getByRole('button', { name: 'Push to pad' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe('Connect a pad first')
  })

  it('cannot push twice at once', async () => {
    render(<Harness onChange={() => {}} pushing sync="sending" />)
    await openMenu()
    expect((screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('says when the change is not on the pad yet, and when the pad is up to date', async () => {
    const { unmount } = render(<Harness onChange={() => {}} sync="unsent" />)
    await openMenu()
    expect(screen.getByText('Changes not on the pad yet')).toBeTruthy()
    unmount()
    render(<Harness onChange={() => {}} sync="in-sync" />)
    await openMenu()
    expect(screen.getByText('Pad is up to date')).toBeTruthy()
  })

  it('pushing keeps the menu open so the result can be seen', async () => {
    render(<Harness onChange={() => {}} sync="unsent" />)
    await openMenu()
    await userEvent.click(screen.getByRole('button', { name: 'Push to pad' }))
    expect(screen.getByLabelText('Pad sleeps after')).toBeTruthy()
  })
})

describe('Settings: uninstall', () => {
  it('has an uninstall button when Studio came from the Windows installer, and asks twice', async () => {
    const uninstall = vi.fn(() => Promise.resolve())
    installApi(undefined, { canUninstall: () => Promise.resolve(true), uninstall })
    render(<Harness onChange={() => {}} />)
    await openMenu()
    const first = await screen.findByRole('button', { name: /Uninstall SnekPad Studio/ })
    await userEvent.click(first)
    expect(uninstall).not.toHaveBeenCalled() // one click only asks
    await userEvent.click(screen.getByRole('button', { name: /Click again to uninstall/ }))
    expect(uninstall).toHaveBeenCalledTimes(1)
  })

  it('a click somewhere else cancels the question', async () => {
    const uninstall = vi.fn(() => Promise.resolve())
    installApi(undefined, { canUninstall: () => Promise.resolve(true), uninstall })
    render(<Harness onChange={() => {}} />)
    await openMenu()
    await userEvent.click(await screen.findByRole('button', { name: /Uninstall SnekPad Studio/ }))
    await userEvent.click(screen.getByLabelText('Pad sleeps after')) // focus moves away
    expect(screen.getByRole('button', { name: /Uninstall SnekPad Studio…/ })).toBeTruthy()
    expect(uninstall).not.toHaveBeenCalled()
  })

  it('says the pad and its profiles are not touched', async () => {
    installApi(undefined, { canUninstall: () => Promise.resolve(true) })
    render(<Harness onChange={() => {}} />)
    await openMenu()
    expect(await screen.findByText(/pad and its profiles are not touched/)).toBeTruthy()
  })

  it('has no uninstall button in a development run, the portable zip or another system', async () => {
    installApi(undefined, { canUninstall: () => Promise.resolve(false) })
    render(<Harness onChange={() => {}} />)
    await openMenu()
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole('button', { name: /Uninstall SnekPad Studio/ })).toBeNull()
  })
})
