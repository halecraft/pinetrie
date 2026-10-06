// web/toast — a note fixed above the footer until you dismiss it: what a
// line command refused or failed says, with no menu open to say it
// (ADR-0090).

export function Toast({
  text,
  action,
  onDismiss,
}: {
  text: string
  /** A button beside the text; choosing it dismisses the toast too. */
  action: { readonly label: string; readonly onChoose: () => void } | null
  onDismiss: () => void
}) {
  return (
    <div className="toast" role="alert">
      <span className="toast-text">{text}</span>
      {action !== null && (
        <button
          className="toast-action"
          onClick={() => {
            action.onChoose()
            onDismiss()
          }}
          type="button"
        >
          {action.label}
        </button>
      )}
      <button
        aria-label="dismiss"
        className="toast-dismiss"
        onClick={onDismiss}
        type="button"
      >
        ×
      </button>
    </div>
  )
}
