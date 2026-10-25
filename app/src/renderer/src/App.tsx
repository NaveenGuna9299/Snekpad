import { useCallback, useEffect, useRef, useState } from 'react'
import {
  allProfiles,
  blankProfile,
  defaultConfig,
  FN_KEY,
  MAX_ALL_PROFILES,
  MAX_PROFILES,
  MAX_STUDIO_PROFILES,
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

const newProfileId = (): string => `profile${Date.now().toString(36)}`

function App(): React.JSX.Element {
  const { config, update, history, device, pressed, sync, push, pushing, message, flash, dismiss } =
    useStudio()
  const [selectedProfile, setSelectedProfile] = useState(0)
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
    if (config && layer < config.profiles.length) void window.api.previewLed(layer, key, color)
  }

  const clipboard = useRef<KeyConfig | null>(null)
  const sel = selection.kind === 'key' ? selection.index : -1
  const swapKeys = (from: number, to: number): void => {
    if (from === to || from === FN_KEY || to === FN_KEY) return
    editProfile((p) => {
      const keys = [...p.keys]
      ;[keys[from], keys[to]] = [keys[to], keys[from]]
      return { ...p, keys }
    })
    const keys = config && allProfiles(config)[selectedProfile]?.keys
    if (keys) {
      previewLed(selectedProfile, from, keys[to].color)
      previewLed(selectedProfile, to, keys[from].color)
    }
    setSelection({ kind: 'key', index: to })
    flash(`Swapped keys ${from + 1} and ${to + 1}.`, false, true)
  }
  const copyKey = (): void => {
    const key = config && allProfiles(config)[selectedProfile]?.keys[sel]
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
    editProfile((p) => ({
      ...p,
      keys: p.keys.map((k, i) => (i === index ? { ...k, ...patch } : k))
    }))
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
              <PadView
                profile={profile}
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
              profile={profile}
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
