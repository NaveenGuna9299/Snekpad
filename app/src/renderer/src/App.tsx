import { useCallback, useEffect, useState } from 'react'
import { blankProfile, defaultConfig, MAX_PROFILES, type Config, type KeyConfig, type Profile } from '../../shared/config'
import type { DeviceState } from '../../shared/api'
import { applyLiveView } from '../../shared/protocol'
import { useHistory } from './lib/useHistory'
import { PadView, type Selection } from './components/PadView'
import { Sidebar } from './components/Sidebar'
import { Inspector } from './components/Inspector'
import { TopBar } from './components/TopBar'
import { Home } from './components/Home'
import { TitleBar } from './components/TitleBar'
import { describeAction } from './lib/describe'
import { PresetBrowser } from './components/PresetBrowser'
import type { Preset } from './lib/presets'

function App(): React.JSX.Element {
  const history = useHistory<Config>(null)
  const config = history.value
  const [selectedProfile, setSelectedProfile] = useState(0)
  const [selection, setSelection] = useState<Selection>({ kind: 'key', index: 0 })
  const [device, setDevice] = useState<DeviceState>({ status: 'disconnected' })
  const [mock, setMock] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [view, setView] = useState<'home' | 'editor'>('home')
  const [browsing, setBrowsing] = useState(false)

  // load the saved config and follow the device state
  useEffect(() => {
    window.api.loadConfig().then(history.replace)
    window.api.deviceState().then(setDevice)
    return window.api.onDeviceState(setDevice)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // when a pad connects, show what is live on it (keys, colours, OLED text)
  const loaded = config !== null
  const connected = device.status === 'connected'
  useEffect(() => {
    if (!connected) return
    let cancelled = false
    window.api.pull().then((r) => {
      if (!cancelled && r.ok && config) history.replace(applyLiveView(config, r.view))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, loaded, device.label])

  // auto-save every edit locally
  useEffect(() => {
    if (config) void window.api.saveConfig(config)
  }, [config])

  const update = useCallback(
    (fn: (c: Config) => Config) => {
      if (config) history.set(fn(config))
    },
    [config, history]
  )

  const editProfile = useCallback(
    (fn: (p: Profile) => Profile) => update((c) => ({ ...c, profiles: c.profiles.map((p, i) => (i === selectedProfile ? fn(p) : p)) })),
    [update, selectedProfile]
  )

  if (!config) return <div className="p-6 text-muted">Loading…</div>
  const profile = config.profiles[Math.min(selectedProfile, config.profiles.length - 1)]

  const flash = (text: string, error = false): void => {
    setMessage({ text, error })
    window.setTimeout(() => setMessage(null), 5000)
  }

  const push = async (): Promise<void> => {
    setPushing(true)
    const r = await window.api.push(config)
    setPushing(false)
    flash(r.ok ? 'Sent to the pad.' : `Could not send: ${r.error}`, !r.ok)
  }

  const addProfile = (source?: Profile): void => {
    if (config.profiles.length >= MAX_PROFILES) return
    const n = config.profiles.length
    const id = `profile${Date.now().toString(36)}`
    const next = source ? { ...structuredClone(source), id, name: `${source.name} 2`.slice(0, 12) } : blankProfile(id, `Profile ${n}`)
    update((c) => ({ ...c, profiles: [...c.profiles, next] }))
    setSelectedProfile(n)
  }

  const deleteProfile = (): void => {
    if (profile.id === 'general') return
    update((c) => ({ ...c, profiles: c.profiles.filter((p) => p.id !== profile.id) }))
    setSelectedProfile(0)
  }

  const addPreset = (preset: Preset): void => {
    if (config.profiles.length >= MAX_PROFILES) return
    const n = config.profiles.length
    update((c) => ({ ...c, profiles: [...c.profiles, { ...structuredClone(preset.profile), id: `profile${Date.now().toString(36)}` }] }))
    setSelectedProfile(n)
    setBrowsing(false)
  }

  const replaceWithPreset = (preset: Preset): void => {
    if (profile.id === 'general') return
    editProfile((p) => ({ ...structuredClone(preset.profile), id: p.id }))
    setBrowsing(false)
  }

  const setKey = (index: number, patch: Partial<KeyConfig>): void => {
    editProfile((p) => ({ ...p, keys: p.keys.map((k, i) => (i === index ? { ...k, ...patch } : k)) }))
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
        device={device}
        mock={mock}
        onMock={(on) => {
          setMock(on)
          void window.api.useMock(on)
        }}
        onPush={push}
        pushing={pushing}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={history.undo}
        onRedo={history.redo}
        onReset={() => {
          if (window.confirm('Restore the four starter profiles? Your current setup can be brought back with Undo.')) {
            history.set(defaultConfig())
            setSelectedProfile(0)
          }
        }}
      />

      <div className="flex min-h-0 flex-1">
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

        <main className="flex min-w-0 flex-1 flex-col items-center gap-4 overflow-y-auto p-6">
          <PadView profile={profile} oledHeight={config.device.oled.height} selection={selection} onSelect={setSelection} />
          <p className="text-sm text-muted" aria-live="polite">
            {selectedKey ? `Key ${(selection as { index: number }).index + 1}: ${describeAction(selectedKey.action)}` : 'Rotary encoder'}
          </p>
          {message && (
            <p role="status" className={`rounded-md px-3 py-2 text-sm ${message.error ? 'bg-danger/15 text-danger' : 'bg-ok/15 text-ok'}`}>
              {message.text}
            </p>
          )}
        </main>

        <Inspector
          profile={profile}
          selection={selection}
          onKey={setKey}
          onEncoder={(patch) => editProfile((p) => ({ ...p, encoder: { ...p.encoder, ...patch } }))}
          onMatch={(windows, macos) => editProfile((p) => ({ ...p, match: { ...p.match, windows, macos } }))}
          onApplyColorToAll={(color) => editProfile((p) => ({ ...p, keys: p.keys.map((k) => ({ ...k, color })) }))}
        />
      </div>
        </>
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
