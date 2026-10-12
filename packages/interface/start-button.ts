// interface/start-button — ＋, a split button, as values: at the sidebar's
// foot and each board column's a new tab, agent work its main action and a
// conversation in its ▾; past a canvas's last column a new column of any
// kind a canvas holds, an agent thread its main action. Their words are
// worded here once, whichever ＋ draws them.

import type { WorkflowStateId } from "@pinetrie/core"
import type { CanvasKind } from "@pinetrie/rules"
import type { Intent } from "./intent.ts"
import type { CanvasPut } from "./put-target.ts"

/** One thing ＋ starts: its main action, or an item of its ▾. */
export interface StartItem {
  readonly key: string
  readonly label: string
  /** Its accessible name where the button shows ＋ alone. */
  readonly name: string
  readonly title: string
  readonly intent: Intent
}

/** A split button: its main action, and the rest in its ▾. */
export interface StartButton {
  readonly main: StartItem
  readonly more: readonly StartItem[]
  /** The ▾'s accessible name. */
  readonly moreLabel: string
}

/** What each kind of canvas card is made as. A `CanvasKind` it lacks fails to compile at `Makes[K]`. */
interface Makes {
  readonly thread: { readonly asksAgent: boolean }
  readonly "note-column": Record<never, never>
}

/** A column ＋ makes, one of a kind a canvas holds. */
export type NewColumn = {
  readonly [K in CanvasKind]: { readonly kind: K } & Makes[K]
}[CanvasKind]

type NewColumnOf<K extends CanvasKind> = Extract<
  NewColumn,
  { readonly kind: K }
>

/** Each kind a canvas holds, at least once, each column under its own kind. */
export type NewColumnTable = {
  readonly [K in CanvasKind]: readonly [NewColumnOf<K>, ...NewColumnOf<K>[]]
}

/** What ＋ past a canvas's last column offers, by kind, in the ▾'s order. */
const NEW_COLUMNS = {
  thread: [
    { kind: "thread", asksAgent: true },
    { kind: "thread", asksAgent: false },
  ],
  "note-column": [{ kind: "note-column" }],
} as const satisfies NewColumnTable

/** Agent work: the main action of every ＋, the first thread the table offers. */
const AGENT: NewColumn = NEW_COLUMNS.thread[0]

/** What `make` is called on ＋, whichever ＋ starts it. */
function startWords(make: NewColumn): Omit<StartItem, "intent"> {
  switch (make.kind) {
    case "thread":
      return make.asksAgent
        ? {
            key: "agent",
            label: "agent",
            name: "new agent thread",
            title:
              "a new thread where the agent answers every message that names no one",
          }
        : {
            key: "conversation",
            label: "conversation",
            name: "new conversation",
            title:
              "a new conversation: the agent answers only when @agent is mentioned",
          }
    case "note-column":
      return {
        key: "note-column",
        label: "note column",
        name: "new note column",
        title: "a new note column at the end of the canvas, for everyone",
      }
  }
}

const item = (make: NewColumn, intent: Intent): StartItem => ({
  ...startWords(make),
  intent,
})

/**
 * ＋ at the sidebar's foot (`state` null) or a board column's: a new tab,
 * landing in that column's state, as agent work or a conversation.
 */
export function newTabButton(state: WorkflowStateId | null): StartButton {
  const tab = (make: NewColumnOf<"thread">): StartItem =>
    item(make, {
      kind: "newTab",
      asksAgent: make.asksAgent,
      ...(state === null ? {} : { state }),
    })
  const [main, ...more] = NEW_COLUMNS.thread
  return {
    main: tab(main),
    more: more.map(tab),
    moreLabel: "other ways to start",
  }
}

/** ＋ past a canvas's last column: a new column of each kind, at `at`. */
export function newColumnButton(at: CanvasPut): StartButton {
  const make = (m: NewColumn): StartItem =>
    item(m, { kind: "addColumn", make: m, at })
  const all: readonly NewColumn[] = Object.values(NEW_COLUMNS).flat()
  return {
    main: make(AGENT),
    more: all.filter(m => m !== AGENT).map(make),
    moreLabel: "other kinds of column",
  }
}
