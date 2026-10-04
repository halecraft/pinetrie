// client/message-table — a table in a message's text, with its bar of
// actions (ADR-0078): ⤢ opens it in the column's pane.

import { type ComponentProps, useContext } from "react"
import { type PaneSubject, samePane, tableOpenWords } from "./pane.ts"
import { MessageSource, PaneReach } from "./pane-context.ts"

/**
 * Drawn for every `<table>` in a message's markdown. Its bar shows on every
 * table, fitting or not: there is no hover on a touch screen. A reply still
 * streaming has no entry to name it by, so its ⤢ waits; the bar is there
 * already, and the reply keeps its height as it commits. Where there is no
 * message (an ask's digest) or no column, the table is drawn alone.
 */
export function MessageTable(
  props: ComponentProps<"table"> & { readonly "data-table"?: number },
) {
  const source = useContext(MessageSource)
  const reach = useContext(PaneReach)
  const nth = props["data-table"]
  if (source === null || reach === null || nth === undefined)
    return <table {...props} />
  const mine: PaneSubject | null =
    source.kind === "entry" ? { kind: "table", entry: source.entry, nth } : null
  const shown =
    mine !== null && reach.shown !== null && samePane(reach.shown, mine)
  const words = tableOpenWords(
    mine === null ? "streaming" : shown ? "shown" : "closed",
  )
  return (
    <div className="table-wrap" data-shown={shown || undefined}>
      <div className="table-bar">
        <button
          aria-label={words.label}
          aria-pressed={shown}
          className="table-open"
          disabled={mine === null}
          onClick={() => {
            if (mine !== null) reach.open(mine)
          }}
          title={words.title}
          type="button"
        >
          ⤢
        </button>
      </div>
      <table {...props} />
    </div>
  )
}
