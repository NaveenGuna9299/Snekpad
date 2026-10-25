import { slotFit, type SlotFit } from '../../../shared/slotCost'
import type { Config, Profile } from '../../../shared/config'

const TEXT: Record<SlotFit['level'], string> = {
  ok: 'Fits on the pad.',
  tight: 'Close to what the pad can hold. Fewer or shorter macros would leave more room.',
  over: 'The pad will probably refuse this profile: use fewer or shorter macros.'
}

/**
 * How much of the pad's spare memory a Studio-only profile will use once it is on the pad's slot. An estimate: the pad
 * itself has the last word (it refuses a profile that would leave it under 2 KB), and says so in the sidebar.
 */
export function SlotMeter({
  profile,
  config
}: {
  profile: Profile
  config: Config
}): React.JSX.Element {
  const fit = slotFit(profile, config)
  const percent = fit.budget === 0 ? 100 : Math.min(100, Math.round((fit.used / fit.budget) * 100))
  const color = fit.level === 'ok' ? 'bg-ok' : fit.level === 'tight' ? 'bg-accent' : 'bg-danger'
  return (
    <div
      className="flex w-full max-w-[460px] flex-col gap-1 text-xs text-muted"
      title="An estimate of the pad's memory this profile uses on the pad's Studio slot (the pad's own profiles take memory too)"
    >
      <div className="flex justify-between">
        <span>Pad memory for this profile</span>
        <span>about {percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Pad memory used by this profile"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-full bg-line"
      >
        <div className={`h-full ${color}`} style={{ width: `${percent}%` }} />
      </div>
      <span role="status" className={fit.level === 'over' ? 'text-danger' : undefined}>
        {TEXT[fit.level]}
      </span>
    </div>
  )
}
