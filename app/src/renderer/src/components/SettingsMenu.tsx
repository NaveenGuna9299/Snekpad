import { useEffect, useRef, useState } from 'react'
import { MAX_SLEEP_MINUTES } from '../../../shared/config'
import type { UpdateOffer } from '../../../shared/firmware'
import type { SyncStatus } from '../../../shared/sync'
import type { ThemePref } from '../../../shared/theme'
import type { UpdateInfo } from '../../../shared/update'

type Props = {
  mock: boolean
  onMock: (on: boolean) => void
  onReset: () => void
  /** Save everything (every profile, the Studio-only ones too, and the settings) to a file / read such a file back. */
  onBackup?: () => void
  onRestore?: () => void
  /** Idle minutes before the pad's screen and key LEDs switch off; 0 = never. Part of the pad's config. */
  sleepMinutes: number
  onSleepMinutes: (minutes: number) => void
  /** For the Push to pad button next to the sleep time. */
  connected: boolean
  sync: SyncStatus
  pushing: boolean
  onPush: () => void
  /** The firmware version inside this build of Studio (null if none), the pad's own, and what to offer. */
  bundleVersion: string | null
  padFirmware?: string
  offer: UpdateOffer
  onUpdateFirmware: () => void
}

/** Rarely used options, kept out of the top bar: start with Windows, restore the starter profiles, mock pad. */
export function SettingsMenu({
  mock,
  onMock,
  onReset,
  onBackup,
  onRestore,
  sleepMinutes,
  onSleepMinutes,
  connected,
  sync,
  pushing,
  onPush,
  bundleVersion,
  padFirmware,
  offer,
  onUpdateFirmware
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  // what is typed in the sleep box while it has focus; null shows the saved value. Only whole numbers in range are saved.
  const [sleepDraft, setSleepDraft] = useState<string | null>(null)
  const [startup, setStartup] = useState<{ supported: boolean; enabled: boolean }>({
    supported: false,
    enabled: false
  })
  const [theme, setTheme] = useState<ThemePref>('system')
  const [auto, setAuto] = useState(true)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  // true when Studio came from the Windows installer; the uninstall button asks twice, so a stray click does nothing
  const [canUninstall, setCanUninstall] = useState(false)
  const [sure, setSure] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.getStartup().then(setStartup)
    void window.api.canUninstall().then((can) => setCanUninstall(can === true))
    void window.api.getTheme().then(setTheme)
    void window.api.getAutoUpdateCheck().then((on) => {
      setAuto(on)
      if (on) void window.api.checkForUpdate().then(setUpdate)
    })
  }, [])

  const check = (): void => {
    setChecking(true)
    void window.api.checkForUpdate().then((u) => {
      setUpdate(u)
      setChecking(false)
    })
  }
  const newer = update?.ok === true && update.newer

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface2"
      >
        Settings
        {newer && (
          <span
            aria-label="Update available"
            className="ml-2 inline-block h-2 w-2 rounded-full bg-accent"
          />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-2 flex w-72 flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-2xl">
          {startup.supported && (
            <label
              className="flex items-start gap-2 text-sm"
              title="Starts hidden in the tray so profiles switch by themselves"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={startup.enabled}
                onChange={(e) =>
                  void window.api
                    .setStartup(e.target.checked)
                    .then((enabled) => setStartup({ supported: true, enabled }))
                }
              />
              <span>
                Start with Windows
                <span className="block text-xs text-muted">
                  Runs hidden in the tray so profiles switch by themselves.
                </span>
              </span>
            </label>
          )}
          <div role="radiogroup" aria-label="Theme" className="flex flex-col gap-1">
            <span className="text-xs text-muted">Theme</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['system', 'dark', 'light'] as const).map((t) => (
                <button
                  key={t}
                  role="radio"
                  aria-checked={theme === t}
                  onClick={() => {
                    setTheme(t)
                    void window.api.setTheme(t)
                  }}
                  className={`rounded-md border px-2 py-1.5 text-xs capitalize ${theme === t ? 'border-accent bg-selected font-semibold text-fg' : 'border-line text-muted hover:bg-surface2 hover:text-fg'}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
            <label htmlFor="sleep-minutes">Pad sleeps after</label>
            <div className="flex items-center gap-2">
              <input
                id="sleep-minutes"
                type="number"
                inputMode="numeric"
                min={0}
                max={MAX_SLEEP_MINUTES}
                step={1}
                value={sleepDraft ?? String(sleepMinutes)}
                onChange={(e) => {
                  setSleepDraft(e.target.value)
                  const n = Number(e.target.value)
                  if (
                    e.target.value.trim() !== '' &&
                    Number.isInteger(n) &&
                    n >= 0 &&
                    n <= MAX_SLEEP_MINUTES
                  )
                    onSleepMinutes(n)
                }}
                onBlur={() => setSleepDraft(null)}
                className="w-20 rounded-md border border-line bg-input px-2 py-1"
              />
              <span className="text-xs text-muted">minutes (0 = never)</span>
            </div>
            <span className="text-xs text-muted">
              The pad&apos;s screen and key lights dim at half this time, then switch off.
            </span>
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={onPush}
                disabled={!connected || pushing}
                title={connected ? 'Send all your changes to the pad' : 'Connect a pad first'}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-40 ${sync === 'unsent' ? 'bg-accent text-accentfg' : 'border border-line text-fg hover:bg-surface2'}`}
              >
                {pushing ? 'Sending…' : 'Push to pad'}
              </button>
              {sync === 'unsent' && (
                <span className="text-xs text-muted" role="status">
                  Changes not on the pad yet
                </span>
              )}
              {sync === 'in-sync' && (
                <span className="text-xs text-ok" role="status">
                  Pad is up to date
                </span>
              )}
            </div>
          </div>
          {bundleVersion && (
            <div className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
              <span>Pad firmware</span>
              <span className="text-xs text-muted">
                On the pad: {padFirmware ?? (connected ? 'unknown' : 'no pad')} · in this app:{' '}
                {bundleVersion}
              </span>
              {offer === 'ota' && (
                <button
                  onClick={() => {
                    setOpen(false)
                    onUpdateFirmware()
                  }}
                  className="rounded-md border border-accent bg-selected px-3 py-1.5 text-left font-semibold"
                >
                  Update pad firmware…
                </button>
              )}
              {offer === 'manual' && (
                <span className="text-xs text-muted">
                  This pad needs one flash from the computer before it can update from Studio.
                </span>
              )}
              {offer === 'none' && connected && padFirmware && (
                <span className="text-xs text-ok">The pad has the latest firmware.</span>
              )}
            </div>
          )}
          <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
            {update?.ok && update.newer ? (
              <button
                onClick={() => void window.api.openReleasePage()}
                className="rounded-md border border-accent bg-selected px-3 py-1.5 text-left font-semibold"
              >
                Version {update.latest} is available. Download
              </button>
            ) : (
              <button
                onClick={check}
                disabled={checking}
                className="rounded-md border border-line px-3 py-1.5 text-left hover:bg-surface2 disabled:opacity-60"
              >
                {checking ? 'Checking…' : 'Check for updates'}
              </button>
            )}
            {update && !newer && !checking && (
              <span className="text-xs text-muted" role="status">
                {update.ok
                  ? `You have the latest version (${update.current}).`
                  : `Could not check: ${update.error}`}
              </span>
            )}
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => {
                  setAuto(e.target.checked)
                  void window.api.setAutoUpdateCheck(e.target.checked)
                }}
              />
              Check for updates when the app opens
            </label>
          </div>
          {onBackup && onRestore && (
            <div className="flex flex-col gap-1.5 text-sm">
              <button
                onClick={() => {
                  setOpen(false)
                  onBackup()
                }}
                className="rounded-md border border-line px-3 py-1.5 text-left hover:bg-surface2"
              >
                Back up all profiles…
              </button>
              <button
                onClick={() => {
                  setOpen(false)
                  onRestore()
                }}
                className="rounded-md border border-line px-3 py-1.5 text-left hover:bg-surface2"
              >
                Restore from a backup…
              </button>
              <span className="text-xs text-muted">
                One file with every profile (the Studio-only ones too) and the settings. Studio also
                keeps its own recent copies; the restore window opens on them.
              </span>
            </div>
          )}
          <button
            onClick={() => {
              setOpen(false)
              onReset()
            }}
            className="rounded-md border border-line px-3 py-1.5 text-left text-sm hover:bg-surface2"
          >
            Restore starter profiles
          </button>
          {canUninstall && (
            <div className="flex flex-col gap-1.5 border-t border-line pt-3 text-sm">
              <button
                onClick={() => (sure ? void window.api.uninstall() : setSure(true))}
                onBlur={() => setSure(false)}
                className={`rounded-md border px-3 py-1.5 text-left hover:bg-surface2 ${sure ? 'border-danger text-danger' : 'border-line'}`}
              >
                {sure ? 'Click again to uninstall SnekPad Studio' : 'Uninstall SnekPad Studio…'}
              </button>
              <span className="text-xs text-muted">
                Removes the app from this computer. Your pad and its profiles are not touched.
              </span>
            </div>
          )}
          <label className="flex items-center gap-2 border-t border-line pt-3 text-xs text-muted">
            <input type="checkbox" checked={mock} onChange={(e) => onMock(e.target.checked)} />
            Use a mock pad (for trying the app without hardware)
          </label>
        </div>
      )}
    </div>
  )
}
