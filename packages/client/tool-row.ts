// client/tool-row — how much of a tool call's row is shown, as a pure rule.
//
// A row opens on its own only for a call whose output streams for REVEAL_MS,
// so a fast command never flashes open, and then only capped. Nothing but the
// reader closes it or shows it whole: a following column that grew for a row
// does not shrink when the call ends (S35).

/** How long a call's output streams before its row opens. */
export const REVEAL_MS = 500

/**
 * `closed`: the summary line. `capped`: opened by the work, its command and
 * output each scrolling in a capped box. `full`: opened by the reader, uncapped.
 */
export type RowSize = "closed" | "capped" | "full"

/** The reader's last choice, or null before they made one. */
export type ReaderChoice = "full" | "closed" | null

export interface RowFacts {
  /** The call's output streamed for REVEAL_MS while this row was drawn. */
  readonly revealed: boolean
  readonly reader: ReaderChoice
}

export const rowSize = (f: RowFacts): RowSize =>
  f.reader ?? (f.revealed ? "capped" : "closed")

/** A capped row is partly open already: a click shows the rest. */
export const click = (size: RowSize): "full" | "closed" =>
  size === "full" ? "closed" : "full"
