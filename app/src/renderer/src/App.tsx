import { useCallback, useRef, useState } from 'react'
import {
  blankProfile,
  defaultConfig,
  FN_KEY,
  MAX_PROFILES,
  type KeyConfig,
  type Profile
} from '../../shared/config'
import { useStudio } from './lib/useStudio'
import { PadView, type Selection } from './components/PadView'
import { Sidebar } from './components/Sidebar'
import { Inspector } from './components/Inspector'
import { TopBar } from './components/TopBar'
import { Home } from './components/Home'
import { TitleBar } from './components/TitleBar'
import { Toast } from './components/Toast'
import { useShortcuts } from './lib/useShortcuts'
import { neighbor } from './lib/grid'
import { describeAction } from './lib/describe'
import { PresetBrowser } from './components/PresetBrowser'
import type { Preset } from './lib/presets'

function App(): React.JSX.Element {
  const { config, update, history, device, sync, push, pushing, message, flash, dismiss } =
    useStudio()
  const [selectedProfile, setSelectedProfile] = useState(0)
  const [selection, setSelection] = useState<Selection>({ kind: 'key', index: 0 })
  const [mock, setMock] = useState(false)
  const [view, setView] = useState<'home' | 'editor'>('home')
  const [browsing, setBrowsing] = useState(false)

  const editProfile = useCallback(
    (fn: (p: Profile) => Profile) =>
      update((c) => ({
        ...c,
        profiles: c.profiles.map((p, i) => (i === selectedProfile ? fn(p) : p))
      })),
    [update, selectedProfile]
  )

  const clipboard = useRef<KeyConfig | null>(null)
  const sel = selection.kind === 'key' ? selection.index : -1
  const swapKeys = (from: number, to: number): void => {
    if (from === to || from === FN_KEY || to === FN_KEY) return
    editProfile((p) => {
      const keys = [...p.keys]
      ;[keys[from], keys[to]] = [keys[to], keys[from]]
      return { ...p, keys }
    })
    const keys = config?.profiles[selectedProfile]?.keys
    if (keys) {
      void window.api.previewLed(selectedProfile, from, keys[to].color)
      void window.api.previewLed(selectedProfile, to, keys[from].color)
    }
    setSelection({ kind: 'key', index: to })
    flash(`Swapped keys ${from + 1} and ${to + 1}.`, false, true)
  }
  const copyKey = (): void => {
    const key = config?.profiles[selectedProfile]?.keys[sel]
    if (!key || sel === FN_KEY) return
    clipboard.current = structuredClone(key)
    flash(`Copied key ${sel + 1}.`)
  }
  const pasteKey = (): void => {
    const key = clipboard.current
    if (!key || sel < 0 || sel === FN_KEY) return
    editProfile((p) => ({
      ...p,
      keys: p.keys.map((k, i) => (i === sel ? structuredClone(key) : k))
    }))
    void window.api.previewLed(selectedProfile, sel, key.color)
    flash(`Pasted onto key ${sel + 1}.`, false, true)
  }

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem('sidebar') !== 'closed'
    } catch {
      return true
    }
  })
  const toggleSidebar = (): void => {
    setSidebarOpen(!sidebarOpen)
    try {
      localStorage.setItem('sidebar', sidebarOpen ? 'closed' : 'open')
    } catch {
      /* the choice just is not remembered */
    }
  }

  const editing = view === 'editor' && !browsing
  useShortcuts(
    {
      undo: history.undo,
      redo: history.redo,
      push: () => void push(),
      copy: copyKey,
      paste: pasteKey,
      move: (dCol, dRow) =>
        setSelection((s) => {
          const next = s.kind === 'key' ? neighbor(s.index, dCol, dRow) : null
          return next === null ? s : { kind: 'key', index: next }
        }),
      swap: (dCol, dRow) => {
        const to = sel >= 0 ? neighbor(sel, dCol, dRow) : null
        if (to !== null) swapKeys(sel, to)
      }
    },
    editing
  )

  if (!config) return <div className="p-6 text-muted">Loading…</div>
  const profile = config.profiles[Math.min(selectedProfile, config.profiles.length - 1)]

  const addProfile = (source?: Profile): void => {
    if (config.profiles.length >= MAX_PROFILES) return
    const n = config.profiles.length
    const id = `profile${Date.now().toString(36)}`
    const next = source
      ? { ...structuredClone(source), id, name: `${source.name} 2`.slice(0, 12) }
      : blankProfile(id, `Profile ${n}`)
    update((c) => ({ ...c, profiles: [...c.profiles, next] }))
    setSelectedProfile(n)
  }

  const deleteProfile = (): void => {
    if (profile.id === 'general') return
    update((c) => ({ ...c, profiles: c.profiles.filter((p) => p.id !== profile.id) }))
    setSelectedProfile(0)
    flash(`Deleted "${profile.name}".`, false, true)
  }

  const addPreset = (preset: Preset): void => {
    if (config.profiles.length >= MAX_PROFILES) return
    const n = config.profiles.length
    update((c) => ({
      ...c,
      profiles: [
        ...c.profiles,
        { ...structuredClone(preset.profile), id: `profile${Date.now().toString(36)}` }
      ]
    }))
    setSelectedProfile(n)
    setBrowsing(false)
  }

  const replaceWithPreset = (preset: Preset): void => {
    if (profile.id === 'general') return
    editProfile((p) => ({ ...structuredClone(preset.profile), id: p.id }))
    setBrowsing(false)
  }

  const setKey = (index: number, patch: Partial<KeyConfig>): void => {
    editProfile((p) => ({
      ...p,
      keys: p.keys.map((k, i) => (i === index ? { ...k, ...patch } : k))
    }))
    if (patch.color) void window.api.previewLed(selectedProfile, index, patch.color)
  }

  const selectedKey = selection.kind === 'key' ? profile.keys[selection.index] : null

  return (
    <div className="flex h-full flex-col">
      <TitleBar device={device} />
      {view === 'home' ? (
        <Home
          profile={profile}
          oledHeight={config.device.oled.height}
          device={device}
          profileCount={config.profiles.length}
          onOpen={() => setView('editor')}
        />
      ) : (
        <>
          <TopBar
            onHome={() => setView('home')}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
            device={device}
            mock={mock}
            onMock={(on) => {
              setMock(on)
              void window.api.useMock(on)
            }}
            onPush={push}
            pushing={pushing}
            sync={sync}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={history.undo}
            onRedo={history.redo}
            onReset={() => {
              history.set(defaultConfig())
              setSelectedProfile(0)
              flash('Starter profiles restored.', false, true)
            }}
          />

          <div className="flex min-h-0 flex-1">
            {sidebarOpen && (
              <Sidebar
                profiles={config.profiles}
                selected={config.profiles.indexOf(profile)}
                onSelect={setSelectedProfile}
                onAdd={() => addProfile()}
                onDuplicate={() => addProfile(profile)}
                onDelete={deleteProfile}
                onRename={(name) => editProfile((p) => ({ ...p, name }))}
                onMore={() => setBrowsing(true)}
              />
            )}

            <main className="flex min-w-0 flex-1 flex-col items-center gap-4 overflow-y-auto p-6">
              <PadView
                profile={profile}
                oledHeight={config.device.oled.height}
                selection={selection}
                onSelect={setSelection}
                onSwap={swapKeys}
              />
              <p className="text-sm text-muted" aria-live="polite">
                {selectedKey
                  ? `Key ${(selection as { index: number }).index + 1}: ${describeAction(selectedKey.action)}`
                  : 'Rotary encoder'}
              </p>
            </main>

            <Inspector
              profile={profile}
              selection={selection}
              onKey={setKey}
              onEncoder={(patch) =>
                editProfile((p) => ({ ...p, encoder: { ...p.encoder, ...patch } }))
              }
              onMatch={(windows, macos) =>
                editProfile((p) => ({ ...p, match: { ...p.match, windows, macos } }))
              }
              onApplyColorToAll={(color) =>
                editProfile((p) => ({ ...p, keys: p.keys.map((k) => ({ ...k, color })) }))
              }
            />
          </div>
        </>
      )}
      <Toast message={message} onUndo={history.undo} onDismiss={dismiss} />
      {browsing && (
        <PresetBrowser
          current={profile}
          profileCount={config.profiles.length}
          currentName={profile.name}
          canReplace={profile.id !== 'general'}
          onAdd={addPreset}
          onReplace={replaceWithPreset}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  )
}

export default App
