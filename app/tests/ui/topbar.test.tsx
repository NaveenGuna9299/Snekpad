// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TopBar } from '../../src/renderer/src/components/TopBar'
import type { DeviceState } from '../../src/shared/api'
import type { SyncStatus } from '../../src/shared/sync'
import './stubApi'

const noop = (): void => {}
const connected: DeviceState = { status: 'connected', kind: 'serial', label: 'SnekPad' }
const button = (name: string): HTMLButtonElement =>
  screen.getByRole('button', { name }) as HTMLButtonElement

function bar(props: Partial<Parameters<typeof TopBar>[0]> = {}): ReturnType<typeof vi.fn> {
  const onPush = vi.fn()
  render(
    <TopBar
      device={connected}
      onPush={onPush}
      pushing={false}
      sync={'unsent' as SyncStatus}
      canUndo={false}
      canRedo={false}
      onUndo={noop}
      onRedo={noop}
      onHome={noop}
      sidebarOpen
      onToggleSidebar={noop}
      {...props}
    />
  )
  return onPush
}

describe('TopBar', () => {
  it('shows the connected pad and sends on Push', async () => {
    const onPush = bar()
    expect(screen.getByText('Connected: SnekPad')).toBeTruthy()
    await userEvent.click(button('Push to pad'))
    expect(onPush).toHaveBeenCalledOnce()
  })

  it('cannot push without a pad', () => {
    bar({ device: { status: 'disconnected' } })
    expect(screen.getByText(/No pad found/)).toBeTruthy()
    expect(button('Push to pad').disabled).toBe(true)
  })

  it('cannot push twice at once', () => {
    bar({ pushing: true })
    expect(button('Sending…').disabled).toBe(true)
  })

  it('says when there are changes the pad does not have', () => {
    bar({ sync: 'unsent' })
    expect(screen.getByText('Changes not on the pad yet')).toBeTruthy()
  })

  it('says when the pad is up to date', () => {
    bar({ sync: 'in-sync' })
    expect(screen.getByText('Pad is up to date')).toBeTruthy()
  })

  it('enables Undo and Redo only when there is something to undo or redo', async () => {
    const onUndo = vi.fn()
    bar({ canUndo: true, canRedo: false, onUndo })
    expect(button('Undo').disabled).toBe(false)
    expect(button('Redo').disabled).toBe(true)
    await userEvent.click(button('Undo'))
    expect(onUndo).toHaveBeenCalledOnce()
  })
})
