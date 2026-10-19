// interface/start-button — ＋, as values: at the sidebar's foot and each
// board column's, a new canvas and nothing more; past a canvas's last column,
// a split button making a new column of any kind a canvas holds, an agent
// thread its main action. Their words are worded here once, whichever ＋
// draws them.

import type { KindOnCanvas, WorkflowState } from "@pinetrie/rules"
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

/** ＋: its main action, and the rest in its ▾, which it has only with something in it. */
export interface StartButton {
  readonly main: StartItem
  readonly more: {
    readonly items: readonly [StartItem, ...StartItem[]]
    /** The ▾'s accessible name. */
    readonly label: string
  } | null
}

/** What each kind of canvas card is made as. A `KindOnCanvas` it lacks fails to compile at `Makes[K]`. */
interface Makes {
  /** What its composer opens with: `@agent ` typed, or nothing (a chat). */
  readonly thread: { readonly opens: "agent" | "chat" }
  readonly "note-column": Record<never, never>
  readonly media: Record<never, never>
}

/** A column ＋ makes, one of a kind a canvas holds. */
export type NewColumn = {
  readonly [K in KindOnCanvas]: { readonly kind: K } & Makes[K]
}[KindOnCanvas]

type NewColumnOf<K extends KindOnCanvas> = Extract<
  NewColumn,
  { readonly kind: K }
>

/** Each kind a canvas holds, at least once, each column under its own kind. */
export type NewColumnTable = {
  readonly [K in KindOnCanvas]: readonly [NewColumnOf<K>, ...NewColumnOf<K>[]]
}

/** What ＋ past a canvas's last column offers, by kind, in the ▾'s order. */
const NEW_COLUMNS = {
  thread: [
    { kind: "thread", opens: "agent" },
    { kind: "thread", opens: "chat" },
  ],
  "note-column": [{ kind: "note-column" }],
  media: [{ kind: "media" }],
} as const satisfies NewColumnTable

/** An agent thread: the main action of ＋ past a canvas's last column, the first thread the table offers. */
const AGENT: NewColumn = NEW_COLUMNS.thread[0]

/** What `make` is called on ＋, whichever ＋ starts it. */
function startWords(make: NewColumn): Omit<StartItem, "intent"> {
  switch (make.kind) {
    case "thread":
      return make.opens === "agent"
        ? {
            key: "agent",
            label: "agent",
            name: "new agent thread",
            title:
              "a new thread with @agent typed: its first message asks the agent, and deleting it makes a chat",
          }
        : {
            key: "chat",
            label: "chat",
            name: "new chat",
            title:
              "a new chat: the agent answers only when @agent is mentioned",
          }
    case "note-column":
      return {
        key: "note-column",
        label: "note column",
        name: "new note column",
        title: "a new note column at the end of the canvas, for everyone",
      }
    case "media":
      return {
        key: "media",
        label: "media column",
        name: "new media column",
        title:
          "a new media column at the end of the canvas, for images to compare, for everyone",
      }
  }
}

const item = (make: NewColumn, intent: Intent): StartItem => ({
  ...startWords(make),
  intent,
})

/**
 * Where ＋ that makes a canvas is: the sidebar's foot, whose canvas lands at
 * the end of the first open state (null before the board has arrived), or a
 * board column, whose canvas lands at the end of its state.
 */
export type CanvasStart =
  | { readonly from: "sidebar"; readonly landsIn: WorkflowState | null }
  | { readonly from: "board"; readonly landsIn: WorkflowState }

/**
 * ＋ at the sidebar's foot or a board column's: a new canvas, with no ▾. Its
 * first thread starts with `@agent ` typed, so its first message decides
 * whether it is a chat.
 */
export function newCanvasButton(start: CanvasStart): StartButton {
  const { landsIn } = start
  return {
    main: {
      key: "canvas",
      label: "canvas",
      name: "new canvas",
      title: `a new canvas${landsIn === null ? "" : ` at the end of ${landsIn.name}`}: its first thread starts with @agent typed`,
      intent: {
        kind: "new-canvas",
        ...(start.from === "board" ? { state: start.landsIn.id } : {}),
      },
    },
    more: null,
  }
}

/** ＋ past a canvas's last column: a new column of each kind, at `at`. */
export function newColumnButton(at: CanvasPut): StartButton {
  const make = (m: NewColumn): StartItem =>
    item(m, { kind: "add-column", make: m, at })
  const [first, ...rest] = Object.values(NEW_COLUMNS)
    .flat()
    .filter((m: NewColumn) => m !== AGENT)
    .map(make)
  return {
    main: make(AGENT),
    more:
      first === undefined
        ? null
        : { items: [first, ...rest], label: "other kinds of column" },
  }
}
