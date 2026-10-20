// web/toast — a note fixed above the footer until you dismiss it: what a setup
// or publish command refused or failed says, with no menu open to say it.

import { Button, IconButton } from "./button.tsx"

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
        <Button
          className="toast-action"
          look="outline"
          onClick={() => {
            action.onChoose()
            onDismiss()
          }}
        >
          {action.label}
        </Button>
      )}
      <IconButton className="toast-dismiss" label="dismiss" onClick={onDismiss}>
        ×
      </IconButton>
    </div>
  )
}
