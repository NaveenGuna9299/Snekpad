import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  OLD_VERSION_NOT_REMOVED,
  TRIES,
  failureText,
  runSetup
} from '../installer/installRunner.js'

/** A setup process that ends with the next code in the list (or fails to start with an error). */
function fakeSetup(outcomes: Array<number | Error>): {
  start: () => EventEmitter
  started: () => number
} {
  let n = 0
  return {
    start: () => {
      const outcome = outcomes[Math.min(n, outcomes.length - 1)]
      n++
      const child = new EventEmitter()
      queueMicrotask(() =>
        outcome instanceof Error ? child.emit('error', outcome) : child.emit('exit', outcome)
      )
      return child
    },
    started: () => n
  }
}

const noWait = (): Promise<void> => Promise.resolve()

describe('running the setup', () => {
  it('is done after one run when the setup succeeds', async () => {
    const s = fakeSetup([0])
    const r = await runSetup({ start: s.start, stopStudio: () => false, wait: noWait })
    expect(r).toEqual({ ok: true })
    expect(s.started()).toBe(1)
  })

  it('runs the setup again when the old version could not be removed, and succeeds', async () => {
    // exactly what happened by hand: the first run fails with 2 and removes the old entry, the next installs over it
    const s = fakeSetup([OLD_VERSION_NOT_REMOVED, 0])
    const r = await runSetup({ start: s.start, stopStudio: () => false, wait: noWait })
    expect(r).toEqual({ ok: true })
    expect(s.started()).toBe(2)
  })

  it('tries up to three times, then says what to do', async () => {
    const s = fakeSetup([OLD_VERSION_NOT_REMOVED])
    const r = await runSetup({ start: s.start, stopStudio: () => false, wait: noWait })
    expect(s.started()).toBe(TRIES)
    expect(TRIES).toBe(3)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe(OLD_VERSION_NOT_REMOVED)
      expect(r.error).toMatch(/old version of SnekPad Studio could not be removed/)
      expect(r.error).toMatch(/Quit/)
    }
  })

  it('does not run again for any other failure', async () => {
    for (const code of [1, 3, 5, -1]) {
      const s = fakeSetup([code])
      const r = await runSetup({ start: s.start, stopStudio: () => false, wait: noWait })
      expect(s.started(), String(code)).toBe(1)
      expect(r).toEqual({ ok: false, error: `Setup exited with code ${code}.`, code })
    }
  })

  it('gives up at once when the setup cannot be started', async () => {
    const s = fakeSetup([new Error('spawn failed')])
    const r = await runSetup({ start: s.start, stopStudio: () => false, wait: noWait })
    expect(r).toEqual({ ok: false, error: 'spawn failed' })
    expect(s.started()).toBe(1)
  })

  it('closes a running Studio before every run, and gives Windows a moment after', async () => {
    const order: string[] = []
    const s = fakeSetup([OLD_VERSION_NOT_REMOVED, 0])
    const stopStudio = vi.fn(() => {
      order.push('stop')
      return true
    })
    const wait = vi.fn((ms: number) => {
      order.push(`wait ${ms}`)
      return Promise.resolve()
    })
    const start = (): EventEmitter => {
      order.push('setup')
      return s.start()
    }
    await runSetup({ start, stopStudio, wait })
    expect(stopStudio).toHaveBeenCalledTimes(2)
    expect(order[0]).toBe('stop')
    expect(order[1]).toMatch(/^wait \d+$/)
    expect(order[2]).toBe('setup')
    expect(order.filter((o) => o === 'setup')).toHaveLength(2)
  })

  it('does not wait for nothing when no Studio was running', async () => {
    const wait = vi.fn(noWait)
    const s = fakeSetup([0])
    await runSetup({ start: s.start, stopStudio: () => false, wait })
    expect(wait).not.toHaveBeenCalled()
  })

  it('waits a few seconds between two runs', async () => {
    const wait = vi.fn(noWait)
    const s = fakeSetup([OLD_VERSION_NOT_REMOVED, 0])
    await runSetup({ start: s.start, stopStudio: () => false, wait, retryWaitMs: 4321 })
    expect(wait).toHaveBeenCalledWith(4321)
  })

  it('hands every setup process to the window, so it can stop it', async () => {
    const seen: unknown[] = []
    const s = fakeSetup([OLD_VERSION_NOT_REMOVED, 0])
    await runSetup({
      start: s.start,
      stopStudio: () => false,
      wait: noWait,
      onChild: (c) => seen.push(c)
    })
    expect(seen).toHaveLength(2)
    expect(seen[0]).not.toBe(seen[1])
  })

  it('has a plain sentence for each ending', () => {
    expect(failureText(OLD_VERSION_NOT_REMOVED)).toMatch(/Quit/)
    expect(failureText(7)).toBe('Setup exited with code 7.')
  })
})
