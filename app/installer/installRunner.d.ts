// Types for installRunner.js, so the tests can import it.
import type { EventEmitter } from 'node:events'

export const OLD_VERSION_NOT_REMOVED: number
export const TRIES: number
export function failureText(code: number | null): string
export function runSetup(o: {
  start: () => EventEmitter
  stopStudio: () => boolean
  wait: (ms: number) => Promise<void>
  onChild?: (child: EventEmitter) => void
  tries?: number
  retryWaitMs?: number
}): Promise<{ ok: true } | { ok: false; error: string; code?: number | null }>
