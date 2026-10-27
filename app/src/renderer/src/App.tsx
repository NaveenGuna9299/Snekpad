import { useCallback, useEffect, useRef, useState } from 'react'
import {
  allProfiles,
  blankProfile,
  defaultConfig,
  FN_KEY,
  MAX_ALL_PROFILES,
  MAX_LAYERS,
  MAX_PROFILES,
  MAX_STUDIO_PROFILES,
  type Action,
  type KeyConfig,
  type Profile
} from '../../shared/config'
import { useStudio } from './lib/useStudio'
import { useMusic } from './lib/useMusic'
import { PadView, type Selection } from './components/PadView'
import { Sidebar } from './components/Sidebar'
import { SlotMeter } from './components/SlotMeter'
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
import { hasSlot, updateOffer } from '../../shared/firmware'
import { isMusicEffect } from '../../shared/config'
import type { Preset } from './lib/presets'

/** The layer number an action points at, if it is a layer key (or a tap/hold key whose hold is one). */
const layerOf = (a: Action): number | undefined =>
  a.type === 'layer'
    ? a.layer
    : a.type === 'tap_hold' && a.hold?.type === 'layer'
      ? a.hold.layer
      : undefined

/** An action with its layer key taken out (the layer it pointed at is gone): a plain tap stays, a lone layer key does nothing. */
const withoutLayerKey = (a: Action): Action => {
  if (a.type === 'layer') return { type: 'none' }
  if (a.type === 'tap_hold' && a.hold?.type === 'layer') {
    if (!a.double) return a.tap
    const rest = { ...a }
    delete rest.hold
    return rest
  }
  return a
}

const blankLayer = (): Profile['layers'][number] => ({ keys: blankProfile('layer', 'layer').keys })

/** A key that points at a layer the profile does not have yet makes the layer. */
const withLayerFor = (p: Profile, action: Action | undefined): Profile =>
  action && layerOf(action) !== undefined && p.layers.length === 0
    ? { ...p, layers: [blankLayer()] }
    : p

const newProfileId = (): string => `profile${Date.now().toString(36)}`

function App(): React.JSX.Element {
  const { config, update, history, device, pressed, sync, push, pushing, message, flash, dismiss } =
    useStudio()
  const [selectedProfile, setSelectedProfile] = useState(0)
  // which layer of the selected profile the pad view and the inspector show: 0 = the main keys, 1 = its extra layer
  const [layerSel, setLayerSel] = useState({ profile: 0, layer: 0 })
  const layerAt = layerSel.profile === selectedProfile ? layerSel.layer : 0
  // a music effect is chosen and a pad is there to receive it: listen to the computer's sound and feed the pad
  const musicChosen = !!config && isMusicEffect(config.settings.effect)
  const music = useMusic(musicChosen && device.status === 'connected')
  // closing the window then only hides it, so the music effects keep going from the tray
  // (not before the config has loaded: "no music effect" is not an answer yet, and would close a window kept for it)
  const configLoaded = config !== null
  useEffect(() => {
    if (configLoaded) window.api.setMusicActive(musicChosen)
  }, [configLoaded, musicChosen])
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

  // `selectedProfile` counts the pad's own profiles first, then the Studio-only ones
  const editProfile = useCallback(
    (fn: (p: Profile) => Profile) =>
      update((c) => {
        const own = c.profiles.length
        return selectedProfile < own
          ? { ...c, profiles: c.profiles.map((p, i) => (i === selectedProfile ? fn(p) : p)) }
          : {
              ...c,
              studioProfiles: c.studioProfiles.map((p, i) =>
                i === selectedProfile - own ? fn(p) : p
              )
            }
      }),
    [update, selectedProfile]
  )
  // the live colour preview is for the pad's own profiles: a Studio-only profile is not on the pad until its app is in focus
  const previewLed = (layer: number, key: number, color: string): void => {
    if (config && layerAt === 0 && layer < config.profiles.length)
      void window.api.previewLed(layer, key, color)
  }

  // the keys of the layer being edited, and a way to change them
  const keysOf = (p: Profile): KeyConfig[] =>
    layerAt > 0 && layerAt <= p.layers.length ? p.layers[layerAt - 1].keys : p.keys
  const mapKeys = (p: Profile, fn: (keys: KeyConfig[]) => KeyConfig[]): Profile =>
    layerAt > 0 && layerAt <= p.layers.length
      ? {
          ...p,
          layers: p.layers.map((l, i) => (i === layerAt - 1 ? { ...l, keys: fn(l.keys) } : l))
        }
      : { ...p, keys: fn(p.keys) }

  const clipboard = useRef<KeyConfig | null>(null)
  const sel = selection.kind === 'key' ? selection.index : -1
  const swapKeys = (from: number, to: number): void => {
    if (from === to || from === FN_KEY || to === FN_KEY) return
    editProfile((p) =>
      mapKeys(p, (all) => {
        const keys = [...all]
        ;[keys[from], keys[to]] = [keys[to], keys[from]]
        return keys
      })
    )
    const shown = config && allProfiles(config)[selectedProfile]
    const keys = shown && keysOf(shown)
    if (keys) {
      previewLed(selectedProfile, from, keys[to].color)
      previewLed(selectedProfile, to, keys[from].color)
    }
    setSelection({ kind: 'key', index: to })
    flash(`Swapped keys ${from + 1} and ${to + 1}.`, false, true)
  }
  const copyKey = (): void => {
    const shown = config && allProfiles(config)[selectedProfile]
    const key = shown && keysOf(shown)[sel]
    if (!key || sel === FN_KEY) return
    clipboard.current = structuredClone(key)
    flash(`Copied key ${sel + 1}.`)
  }
  const pasteKey = (): void => {
    const key = clipboard.current
    if (!key || sel < 0 || sel === FN_KEY) return
    editProfile((p) =>
      withLayerFor(
        mapKeys(p, (keys) => keys.map((k, i) => (i === sel ? structuredClone(key) : k))),
        key.action
      )
    )
    previewLed(selectedProfile, sel, key.color)
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
  const everyProfile = allProfiles(config)
  const profile = everyProfile[Math.min(selectedProfile, everyProfile.length - 1)]

  // A new profile goes on the pad while it has room (it then works without Studio), else it is a Studio-only one.
  // It can be moved to the other group afterwards.
  const putProfile = (next: Profile): void => {
    if (everyProfile.length >= MAX_ALL_PROFILES) return
    const toPad = config.profiles.length < MAX_PROFILES
    update((c) =>
      toPad
        ? { ...c, profiles: [...c.profiles, next] }
        : { ...c, studioProfiles: [...c.studioProfiles, next] }
    )
    setSelectedProfile(toPad ? config.profiles.length : everyProfile.length)
  }

  const addProfile = (source?: Profile): void => {
    const id = newProfileId()
    putProfile(
      source
        ? { ...structuredClone(source), id, name: `${source.name} 2`.slice(0, 12) }
        : blankProfile(id, `Profile ${everyProfile.length}`)
    )
  }

  const deleteProfile = (): void => {
    if (profile.id === 'general') return
    update((c) => ({
      ...c,
      profiles: c.profiles.filter((p) => p.id !== profile.id),
      studioProfiles: c.studioProfiles.filter((p) => p.id !== profile.id)
    }))
    setSelectedProfile(0)
    flash(`Deleted "${profile.name}".`, false, true)
  }

  const moveProfile = (): void => {
    if (profile.id === 'general') return
    const onPad = selectedProfile < config.profiles.length
    if (onPad && config.studioProfiles.length >= MAX_STUDIO_PROFILES) return
    if (!onPad && config.profiles.length >= MAX_PROFILES) return
    update((c) =>
      onPad
        ? {
            ...c,
            profiles: c.profiles.filter((p) => p.id !== profile.id),
            studioProfiles: [...c.studioProfiles, profile]
          }
        : {
            ...c,
            studioProfiles: c.studioProfiles.filter((p) => p.id !== profile.id),
            profiles: [...c.profiles, profile]
          }
    )
    // it is now the last of its new group
    setSelectedProfile(onPad ? everyProfile.length - 1 : config.profiles.length)
    flash(
      onPad
        ? `"${profile.name}" is now Studio only. Send to the pad to take it off the pad.`
        : `"${profile.name}" is now on the pad. Send to the pad to put it there.`,
      false,
      true
    )
  }

  const exportSelected = async (): Promise<void> => {
    const r = await window.api.exportProfile(profile)
    if (r.ok) flash(`Saved "${profile.name}" to ${r.path}.`)
    else if (!r.cancelled) flash(`Could not export: ${r.error}`, true)
  }

  const importOne = async (): Promise<void> => {
    const r = await window.api.importProfile()
    if (!r.ok) {
      if (!r.cancelled) flash(r.error, true)
      return
    }
    if (everyProfile.length >= MAX_ALL_PROFILES) {
      flash(
        `There is no room: Studio holds at most ${MAX_ALL_PROFILES} profiles. Delete one first.`,
        true
      )
      return
    }
    // a fresh id, so it never clashes with the profile it was exported from
    putProfile({ ...r.profile, id: newProfileId() })
    flash(`Imported "${r.profile.name}".`, false, true)
  }

  const backupAll = async (): Promise<void> => {
    const r = await window.api.exportBackup(config)
    if (r.ok) flash(`Backed up to ${r.path}.`)
    else if (!r.cancelled) flash(`Could not back up: ${r.error}`, true)
  }

  const restoreBackup = async (): Promise<void> => {
    const r = await window.api.importBackup()
    if (!r.ok) {
      if (!r.cancelled) flash(r.error, true)
      return
    }
    history.set(r.config) // replaces everything, and Undo brings the old config back
    setSelectedProfile(0)
    flash(
      'Restored from the backup. Send to the pad to put its own profiles on the pad.',
      false,
      true
    )
  }

  const tryOnPad = async (): Promise<void> => {
    const r = await window.api.tryProfile(profile)
    flash(
      r.ok
        ? `Showing "${profile.name}" on the pad for a few seconds.`
        : `Could not show it on the pad: ${r.error}`,
      !r.ok
    )
  }

  const addPreset = (preset: Preset): void => {
    putProfile({ ...structuredClone(preset.profile), id: newProfileId() })
    setBrowsing(false)
  }

  const replaceWithPreset = (preset: Preset): void => {
    if (profile.id === 'general') return
    editProfile((p) => ({ ...structuredClone(preset.profile), id: p.id }))
    setBrowsing(false)
  }

  const setKey = (index: number, patch: Partial<KeyConfig>): void => {
    editProfile((p) =>
      withLayerFor(
        mapKeys(p, (keys) => keys.map((k, i) => (i === index ? { ...k, ...patch } : k))),
        patch.action
      )
    )
    if (patch.color) previewLed(selectedProfile, index, patch.color)
  }

  // The profile the pad itself says it is running (only pads with protocol 2 say). The pad's number for the Studio slot is
  // the number of its own profiles; which Studio profile is on it, the main process knows (device.slot).
  const slotLayer = config.profiles.length
  const padProfile =
    device.activeProfile === undefined
      ? undefined
      : device.activeProfile === slotLayer
        ? config.studioProfiles.find((p) => p.id === device.slot)
        : config.profiles[device.activeProfile]
  // the pad's own number for the selected profile (the slot's for a Studio profile that is on it), -1 if it is not on the pad
  const selectedPadLayer = config.profiles.includes(profile)
    ? config.profiles.indexOf(profile)
    : profile.id === device.slot
      ? slotLayer
      : -1
  const activeStudio =
    device.activeProfile === slotLayer && device.slot !== undefined ? device.slot : undefined
  const setMockPad = (on: boolean): void => {
    setMock(on)
    void window.api.useMock(on)
  }
  const restoreStarterProfiles = (): void => {
    history.set(defaultConfig())
    setSelectedProfile(0)
    flash('Starter profiles restored.', false, true)
  }
  const shownProfile: Profile = { ...profile, keys: keysOf(profile) }
  const selectedKey = selection.kind === 'key' ? shownProfile.keys[selection.index] : null
  const addLayer = (): void => {
    editProfile((p) => ({ ...p, layers: [...p.layers, blankLayer()] }))
    setLayerSel({ profile: selectedProfile, layer: profile.layers.length + 1 })
  }
  const removeLayer = (): void => {
    const n = layerAt
    editProfile((p) => ({
      ...p,
      keys: p.keys.map((k) => ({ ...k, action: withoutLayerKey(k.action) })),
      layers: p.layers.filter((_, i) => i !== n - 1)
    }))
    setLayerSel({ profile: selectedProfile, layer: 0 })
    flash(`Removed layer ${n + 1}.`, false, true)
  }

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
          music={music}
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
          profileCount={everyProfile.length}
          onOpen={() => setView('editor')}
          onEffects={() => setView('effects')}
          onTestKeys={__DEV_TOOLS__ ? () => setView('test') : undefined}
          mock={mock}
          onMock={setMockPad}
          onReset={restoreStarterProfiles}
          onBackup={() => void backupAll()}
          onRestore={() => void restoreBackup()}
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
                activeOnPad={device.activeProfile === slotLayer ? undefined : device.activeProfile}
                activeStudio={activeStudio}
                slotSupported={hasSlot(device) || device.status !== 'connected'}
                slotError={device.slotError}
                profiles={config.profiles}
                studioProfiles={config.studioProfiles}
                selected={everyProfile.indexOf(profile)}
                onSelect={setSelectedProfile}
                onAdd={() => addProfile()}
                onDuplicate={() => addProfile(profile)}
                onDelete={deleteProfile}
                onMove={moveProfile}
                onRename={(name) => editProfile((p) => ({ ...p, name }))}
                onMore={() => setBrowsing(true)}
                onExport={() => void exportSelected()}
                onImport={() => void importOne()}
              />
            )}

            <main className="flex min-w-0 flex-1 flex-col items-center gap-4 overflow-y-auto p-6">
              <div role="tablist" aria-label="Layer" className="flex items-center gap-1.5">
                {[0, ...profile.layers.map((_, i) => i + 1)].map((n) => (
                  <button
                    key={n}
                    role="tab"
                    aria-selected={layerAt === n}
                    onClick={() => setLayerSel({ profile: selectedProfile, layer: n })}
                    className={`rounded-md border px-3 py-1 text-xs ${layerAt === n ? 'border-accent bg-selected font-semibold text-fg' : 'border-line text-muted hover:bg-surface2 hover:text-fg'}`}
                  >
                    {n === 0 ? 'Main keys' : `Layer ${n + 1}`}
                  </button>
                ))}
                {profile.layers.length < MAX_LAYERS && (
                  <button
                    onClick={addLayer}
                    title="Add a second set of 12 keys, reached with a layer key"
                    className="rounded-md border border-dashed border-line px-3 py-1 text-xs text-muted hover:bg-surface2 hover:text-fg"
                  >
                    + Add layer
                  </button>
                )}
                {layerAt > 0 && (
                  <button
                    onClick={removeLayer}
                    className="rounded-md px-2 py-1 text-xs text-muted hover:text-fg"
                  >
                    Remove layer
                  </button>
                )}
              </div>
              <PadView
                profile={shownProfile}
                selection={selection}
                onSelect={setSelection}
                onSwap={swapKeys}
                pressed={
                  selectedPadLayer >= 0 && device.activeProfile === selectedPadLayer
                    ? pressed
                    : undefined
                }
              />
              <p className="text-sm text-muted" aria-live="polite">
                {selectedKey
                  ? `Key ${(selection as { index: number }).index + 1}: ${describeAction(selectedKey.action)}`
                  : 'Rotary encoder'}
              </p>
              {config.studioProfiles.includes(profile) && (
                <div className="flex w-full max-w-[460px] flex-col items-start gap-3">
                  <SlotMeter profile={profile} config={config} />
                  <button
                    onClick={() => void tryOnPad()}
                    disabled={device.status !== 'connected'}
                    title={
                      device.status !== 'connected'
                        ? 'Plug the pad in to try the profile on it'
                        : 'Show this profile on the pad for a few seconds, without opening its app'
                    }
                    className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Try on pad
                  </button>
                </div>
              )}
            </main>

            <Inspector
              profile={shownProfile}
              selection={selection}
              onKey={setKey}
              onEncoder={(patch) =>
                editProfile((p) => ({ ...p, encoder: { ...p.encoder, ...patch } }))
              }
              onMatch={(windows, macos) =>
                editProfile((p) => ({ ...p, match: { ...p.match, windows, macos } }))
              }
              onTitles={(titles) => editProfile((p) => ({ ...p, match: { ...p.match, titles } }))}
              onApplyColorToAll={(color) =>
                editProfile((p) => mapKeys(p, (keys) => keys.map((k) => ({ ...k, color }))))
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
          profileCount={everyProfile.length}
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
