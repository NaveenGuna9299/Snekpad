import type { Action } from '../../../shared/config'

/** One-line description of an action for lists and tooltips. */
export function describeAction(a: Action): string {
  switch (a.type) {
    case 'none':
      return 'Does nothing'
    case 'fn':
      return 'FN (utility layer)'
    case 'layer_next':
      return 'Next profile'
    case 'key':
      return a.key
    case 'hotkey':
      return a.keys.join(' + ')
    case 'text':
      return `Types "${a.text}"${a.enter ? ' + Enter' : ''}`
    case 'sequence':
      return a.steps.map((s) => s.keys.join('+')).join(', then ')
    case 'consumer':
      return a.code
    case 'layer':
      if (a.layer === 0) return 'Back to the main keys'
      return a.mode === 'hold' ? `Hold for layer ${a.layer + 1}` : `Toggle layer ${a.layer + 1}`
    case 'tap_hold': {
      const parts = [`Tap: ${describeAction(a.tap)}`]
      if (a.hold) parts.push(`Hold: ${describeAction(a.hold)}`)
      if (a.double) parts.push(`Double: ${describeAction(a.double)}`)
      return parts.join(' · ')
    }
  }
}
