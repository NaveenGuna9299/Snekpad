import { useEffect, useRef, useState } from 'react'
import type { ThemePref } from '../../../shared/theme'

type Props = {
  mock: boolean
  onMock: (on: boolean) => void
  onReset: () => void
}

/** Rarely used options, kept out of the top bar: start with Windows, restore the starter profiles, mock pad. */
export function SettingsMenu({ mock, onMock, onReset }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [startup, setStartup] = useState<{ supported: boolean; enabled: boolean }>({
    supported: false,
    enabled: false
  })
  const [theme, setTheme] = useState<ThemePref>('system')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.getStartup().then(setStartup)
    void window.api.getTheme().then(setTheme)
  }, [])

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
          <button
            onClick={() => {
              setOpen(false)
              onReset()
            }}
            className="rounded-md border border-line px-3 py-1.5 text-left text-sm hover:bg-surface2"
          >
            Restore starter profiles
          </button>
          <label className="flex items-center gap-2 border-t border-line pt-3 text-xs text-muted">
            <input type="checkbox" checked={mock} onChange={(e) => onMock(e.target.checked)} />
            Use a mock pad (for trying the app without hardware)
          </label>
        </div>
      )}
    </div>
  )
}
