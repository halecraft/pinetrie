// web/message-table — a table in a message's text, with its bar of
// actions (ADR-0078): ❝ takes a reference to it into your inventory
// (ADR-0126), and ⤢ opens it in the column's pane.

import { type ComponentProps, useContext } from "react"
import { blockOfProperty } from "./markdown.ts"
import {
  type PaneSubject,
  samePane,
  TAKE_BLOCK,
  tableOpenWords,
} from "./pane.ts"
import { MessageSource, PaneReach } from "./pane-context.ts"

/**
 * Drawn for every `<table>` in a message's markdown. Its bar shows on every
 * table, fitting or not: there is no hover on a touch screen. A reply still
 * streaming has no entry to name it by, so its ⤢ waits; the bar is there
 * already, and the reply keeps its height as it commits. Where there is no
 * message (an ask's digest) or no column, the table is drawn alone.
 */
export function MessageTable(
  props: ComponentProps<"table"> & { readonly "data-block"?: string },
) {
  const source = useContext(MessageSource)
  const reach = useContext(PaneReach)
  const block = blockOfProperty(props["data-block"])
  if (source === null || reach === null || block === null)
    return <table {...props} />
  const mine: PaneSubject | null =
    source.kind === "entry"
      ? {
          kind: "block",
          address: {
            kind: "block",
            thread: source.thread,
            entry: source.entry,
            block,
          },
        }
      : null
  const shown =
    mine !== null && reach.shown !== null && samePane(reach.shown, mine)
  const words = tableOpenWords(
    mine === null ? "streaming" : shown ? "shown" : "closed",
  )
  return (
    // Its block's number on the wrap too: Cmd+C with focus on its bar takes
    // the table (`copyFrom`, ADR-0126).
    <div
      className="table-wrap"
      data-block={props["data-block"]}
      data-shown={shown || undefined}
    >
      <div className="table-bar">
        <button
          aria-label={TAKE_BLOCK.label}
          className="take-block"
          disabled={mine === null}
          onClick={() => {
            if (mine?.kind === "block") reach.take(mine.address)
          }}
          title={TAKE_BLOCK.title}
          type="button"
        >
          {TAKE_BLOCK.glyph}
        </button>
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
