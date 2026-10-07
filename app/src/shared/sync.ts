// Sync state between the editor and the pad. The "baseline" is the config the pad is known to
// have: what was last pushed, or what was last adopted from the pad's own live view.

import type { Config } from './config'

export type SyncStatus = 'no-pad' | 'sending' | 'unsent' | 'in-sync'

export const sameConfig = (a: Config | null, b: Config | null): boolean => a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b))

export function syncStatus(connected: boolean, sending: boolean, config: Config | null, baseline: Config | null): SyncStatus {
  if (sending) return 'sending'
  if (!connected) return 'no-pad'
  return sameConfig(config, baseline) ? 'in-sync' : 'unsent'
}

/**
 * Whether the pad's live view may replace what is in the editor. It may only when nothing would be
 * lost: the editor holds exactly what the pad is known to have, or there is no record of the pad yet.
 */
export const canAdoptLiveView = (config: Config, baseline: Config | null): boolean => baseline === null || sameConfig(config, baseline)
