// Looks for a newer release on GitHub. It only reads the public "latest release" and never downloads
// or installs anything: the user opens the release page and installs it themselves.

import { app, net, shell } from 'electron'
import { isNewer, type UpdateInfo } from '../shared/update'

const REPO = 'NaveenGuna9299/Snekpad'
const RELEASES_URL = `https://github.com/${REPO}/releases`

export async function checkForUpdate(): Promise<UpdateInfo> {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SnekPad-Studio' },
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown }
    if (typeof body.tag_name !== 'string') throw new Error('no release found')
    const latest = body.tag_name.replace(/^v/i, '')
    const url =
      typeof body.html_url === 'string' && body.html_url.startsWith(RELEASES_URL)
        ? body.html_url
        : RELEASES_URL
    const current = app.getVersion()
    return { ok: true, current, latest, newer: isNewer(latest, current), url }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function openReleases(): Promise<void> {
  return shell.openExternal(`${RELEASES_URL}/latest`)
}
