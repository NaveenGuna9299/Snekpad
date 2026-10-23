// Runs the real (NSIS) setup for the themed installer window, and runs it again when it could not remove the old version.
//
// Why: the NSIS setup first runs the old version's uninstaller. That sometimes fails (exit code 2, "Failed to uninstall
// old application files") when a program is still closing or holds the folder for a moment. The failed uninstaller has
// already removed its own entry from Windows, so running the setup once more installs over the old files and works. A
// person used to have to click OK and start the installer again by hand, sometimes twice.
//
// Kept apart from main.js (which needs Electron) so it can be tested on its own: tests/installRunner.test.ts.

/** What the NSIS setup returns when the old version's uninstaller could not remove its files. */
const OLD_VERSION_NOT_REMOVED = 2

const TRIES = 3
const RETRY_WAIT_MS = 3000
const AFTER_STOP_WAIT_MS = 1500

/** The sentence shown when setup gives up, for the exit code it ended with. */
function failureText(code) {
  if (code === OLD_VERSION_NOT_REMOVED) {
    return (
      'The old version of SnekPad Studio could not be removed. Quit it (right-click its icon next to the clock, ' +
      'then Quit), close any window that shows its folder, and run this installer again.'
    )
  }
  return `Setup exited with code ${code}.`
}

/**
 * @param {object} o
 * @param {() => import('node:events').EventEmitter} o.start  starts the setup; the result emits 'exit' (code) and 'error'
 * @param {() => boolean} o.stopStudio  closes a running Studio; true if there was one
 * @param {(ms: number) => Promise<void>} o.wait
 * @param {(child: object) => void} [o.onChild]  gets each setup process (so the window can stop it)
 * @param {number} [o.tries]
 * @param {number} [o.retryWaitMs]
 * @returns {Promise<{ ok: true } | { ok: false, error: string, code?: number }>}
 */
async function runSetup({
  start,
  stopStudio,
  wait,
  onChild,
  tries = TRIES,
  retryWaitMs = RETRY_WAIT_MS
}) {
  let code = null
  for (let attempt = 1; attempt <= tries; attempt++) {
    // a running Studio is what most often stops the old version from being removed: close it, and give Windows a
    // moment to let go of its files
    if (stopStudio()) await wait(AFTER_STOP_WAIT_MS)
    const result = await new Promise((resolve) => {
      const child = start()
      if (onChild) onChild(child)
      child.on('error', (e) => resolve({ error: e.message }))
      child.on('exit', (c) => resolve({ code: c }))
    })
    if (result.error) return { ok: false, error: result.error }
    if (result.code === 0) return { ok: true }
    code = result.code
    if (code !== OLD_VERSION_NOT_REMOVED || attempt === tries) break
    await wait(retryWaitMs)
  }
  return { ok: false, error: failureText(code), code }
}

module.exports = { runSetup, failureText, OLD_VERSION_NOT_REMOVED, TRIES }
