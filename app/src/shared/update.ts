// Update check result, shared by the main process and the renderer.

export type UpdateInfo =
  | { ok: true; current: string; latest: string; newer: boolean; url: string }
  | { ok: false; error: string }

const parts = (v: string): number[] =>
  v
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((n) => parseInt(n, 10) || 0)

/** True when `latest` is a higher x.y.z than `current` (a leading "v" and any suffix are ignored). */
export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest)
  const b = parts(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return false
}
