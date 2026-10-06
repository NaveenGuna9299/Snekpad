import type { SnekApi } from '../shared/api'

declare global {
  interface Window {
    api: SnekApi
  }
}
