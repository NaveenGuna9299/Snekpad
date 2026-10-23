import { useCallback, useEffect, useRef, useState } from 'react'
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
import { KeyTest } from './components/KeyTest'
import { Effects } from './components/Effects'
import { FirmwareNotice } from './components/FirmwareNotice'
import { FirmwareUpdateDialog } from './components/FirmwareUpdateDialog'
import { updateOffer } from '../../shared/firmware'
import type { Preset } from './lib/presets'

function App(): React.JSX.Element {
  const { config, update, history, device, pressed, sync, push, pushing, message, flash, dismiss } =
    useStudio()
  const [selectedProfile, setSelectedProfile] = useState(0)
  const [selection, setSelection] = useState<Selection>({ kind: 'key', index: 0 })
  const [mock, setMock] = useState(false)
  const [view, setView] = useState<'home' | 'editor' | 'test' | 'effects'>('home')
  // the firmware warning is hidden for one pad at a time: it comes back when the pad is plugged in again
  const [warningHidden, setWarningHidden] = useState(false)
  // the pad firmware inside this build of Studio (null if none), and the update dialog
  const [bundleVersion, setBundleVersion] = useState<string | null>(null)
  const [updatingFirmware, setUpdatingFirmware] = useState(false)
  useEffect(() => {
    void window.api.firmwareBundle().then((b) => setBundleVersion(b.ok ? b.version : null))
  }, [])
  const [wasConnected, setWasConnected] = useState(false)
  if (wasConnected !== (device.status === 'connected')) {
    setWasConnected(device.status === 'connected')
    setWarningHidden(false)
  }
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

  // the profile the pad itself says it is running (only pads with protocol 2 say)
  const padProfile =
    device.activeProfile === undefined ? undefined : config.profiles[device.activeProfile]
  const selectedProfileIndex = config.profiles.indexOf(profile)
  const setMockPad = (on: boolean): void => {
    setMock(on)
    void window.api.useMock(on)
  }
  const restoreStarterProfiles = (): void => {
    history.set(defaultConfig())
    setSelectedProfile(0)
    flash('Starter profiles restored.', false, true)
  }
  const selectedKey = selection.kind === 'key' ? profile.keys[selection.index] : null

  return (
    <div className="flex h-full flex-col">
      <TitleBar device={device} />
      {!warningHidden && (
        <FirmwareNotice
          device={device}
          bundleVersion={bundleVersion}
          onDismiss={() => setWarningHidden(true)}
          onUpdate={() => setUpdatingFirmware(true)}
        />
      )}
      {__DEV_TOOLS__ && view === 'test' ? (
        <KeyTest
          profile={padProfile ?? profile}
          device={device}
          pressed={pressed}
          onBack={() => setView('home')}
        />
      ) : view === 'effects' ? (
        <Effects
          profiles={config.profiles}
          effect={config.settings.effect}
          onEffect={(effect) => update((c) => ({ ...c, settings: { ...c.settings, effect } }))}
          onKeyColor={(pi, key, color) => {
            update((c) => ({
              ...c,
              profiles: c.profiles.map((pr, i) =>
                i === pi
                  ? { ...pr, keys: pr.keys.map((k, j) => (j === key ? { ...k, color } : k)) }
                  : pr
              )
            }))
            void window.api.previewLed(pi, key, color)
          }}
          onAllColors={(pi, color) =>
            update((c) => ({
              ...c,
              profiles: c.profiles.map((pr, i) =>
                i === pi ? { ...pr, keys: pr.keys.map((k) => ({ ...k, color })) } : pr
              )
            }))
          }
          device={device}
          sync={sync}
          pushing={pushing}
          onPush={() => void push()}
          onBack={() => setView('home')}
        />
      ) : view === 'home' ? (
        <Home
          profile={padProfile ?? profile}
          padProfileName={padProfile?.name}
          pressed={pressed}
          device={device}
          profileCount={config.profiles.length}
          onOpen={() => setView('editor')}
          onEffects={() => setView('effects')}
          onTestKeys={__DEV_TOOLS__ ? () => setView('test') : undefined}
          mock={mock}
          onMock={setMockPad}
          onReset={restoreStarterProfiles}
          sync={sync}
          pushing={pushing}
          onPush={() => void push()}
          bundleVersion={bundleVersion}
          offer={updateOffer(device, bundleVersion)}
          onUpdateFirmware={() => setUpdatingFirmware(true)}
          sleepMinutes={config.settings.sleepMinutes}
          onSleepMinutes={(minutes) =>
            update((c) => ({ ...c, settings: { ...c.settings, sleepMinutes: minutes } }))
          }
        />
      ) : (
        <>
          <TopBar
            onHome={() => setView('home')}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
            device={device}
            onPush={push}
            pushing={pushing}
            sync={sync}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={history.undo}
            onRedo={history.redo}
          />

          <div className="flex min-h-0 flex-1">
            {sidebarOpen && (
              <Sidebar
                activeOnPad={device.activeProfile}
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
                selection={selection}
                onSelect={setSelection}
                onSwap={swapKeys}
                pressed={device.activeProfile === selectedProfileIndex ? pressed : undefined}
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
      {updatingFirmware && bundleVersion && (
        <FirmwareUpdateDialog
          device={device}
          bundleVersion={bundleVersion}
          onClose={() => setUpdatingFirmware(false)}
        />
      )}
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
