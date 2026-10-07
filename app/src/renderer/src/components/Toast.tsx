import type { Message } from '../lib/useStudio'

type Props = { message: Message | null; onUndo: () => void; onDismiss: () => void }

/** One short message at the bottom of the window. Destructive actions offer Undo here instead of a confirm dialog. */
export function Toast({ message, onUndo, onDismiss }: Props): React.JSX.Element | null {
  if (!message) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm shadow-xl ${message.error ? 'border-danger/50 bg-surface text-danger' : 'border-line bg-surface text-fg'}`}
      >
        <span>{message.text}</span>
        {message.undoable && (
          <button
            onClick={() => {
              onUndo()
              onDismiss()
            }}
            className="rounded-md border border-line px-2 py-0.5 text-xs font-semibold hover:bg-surface2"
          >
            Undo
          </button>
        )}
        <button onClick={onDismiss} aria-label="Dismiss" className="text-muted hover:text-fg">✕</button>
      </div>
    </div>
  )
}
