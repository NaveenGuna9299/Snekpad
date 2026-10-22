// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PadView, type Selection } from '../../src/renderer/src/components/PadView'
import { defaultConfig, KEY_COUNT } from '../../src/shared/config'
import './stubApi'

const profile = defaultConfig().profiles[0]
const none: Selection = { kind: 'key', index: -1 }
const keys = (): HTMLElement[] => screen.getAllByRole('button', { name: /^Key \d+:/ })

describe('PadView', () => {
  it('draws every key, plus the knob', () => {
    render(<PadView profile={profile} selection={none} onSelect={() => {}} />)
    expect(keys()).toHaveLength(KEY_COUNT)
    expect(screen.getByRole('button', { name: 'Rotary encoder' })).toBeTruthy()
  })

  it('selects a key on click and on Enter', async () => {
    const onSelect = vi.fn()
    render(<PadView profile={profile} selection={none} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: /^Key 3:/ }))
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'key', index: 2 })
    screen.getByRole('button', { name: /^Key 5:/ }).focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'key', index: 4 })
  })

  it('selects the knob', async () => {
    const onSelect = vi.fn()
    render(<PadView profile={profile} selection={none} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: 'Rotary encoder' }))
    expect(onSelect).toHaveBeenCalledWith({ kind: 'encoder' })
  })

  it('marks only the selected key as pressed in the accessibility tree', () => {
    render(<PadView profile={profile} selection={{ kind: 'key', index: 1 }} onSelect={() => {}} />)
    const marked = keys().filter((b) => b.getAttribute('aria-pressed') === 'true')
    expect(marked).toHaveLength(1)
    expect(marked[0].getAttribute('aria-label')).toMatch(/^Key 2:/)
  })

  it('lights up the keys the pad reports as held', () => {
    const lit = (pressed: Set<number>): number => {
      const { container, unmount } = render(
        <PadView profile={profile} selection={none} onSelect={() => {}} pressed={pressed} />
      )
      const n = container.querySelectorAll('rect[fill="#fff"]').length
      unmount()
      return n
    }
    expect(lit(new Set())).toBe(0)
    expect(lit(new Set([0, 4]))).toBe(2)
  })
})
