// client/message-props — what a message is drawn from, and when two sets of
// props draw the same: `React.memo`'s rule for `Message`, kept pure.

import type { BranchSummary, SpineNode, WriterId } from "@pineta/core"
import type { SessionDocHandle } from "@pineta/schema"
import type { ReactNode } from "react"
import type { LaneJoin } from "./column-view.ts"
import type { MessageAct, MessageTools } from "./message-tools.ts"

export interface MessageProps {
  node: SpineNode
  /**
   * The stream of each of its tool calls that is running, by call id
   * (`liveWork`): its own calls' only, so a stream elsewhere redraws nothing
   * here.
   */
  streams: Readonly<Record<string, string>>
  /** Where a running call's output is read. */
  doc: SessionDocHandle
  /** Current display names, by writer. */
  nameOf: ReadonlyMap<WriterId, string>
  /** Its note's card (ADR-0025), drawn below it. */
  about: ReactNode | undefined
  /** The card of the note it was sent from, drawn below it once changed. */
  origin: ReactNode | undefined
  /** Which tools it offers (`messageTools`). */
  tools: MessageTools
  /** What the reader asked of it: a note, a branch, a new tab, a closed branch. */
  onAct: (act: MessageAct) => void
  /** A lane starts here: a divider above the message names it. */
  join: LaneJoin | undefined
  /** Tracks of open columns that fork here: a dot of each colour. */
  forkTracks: readonly number[]
  /** Branches leaving here that no column shows. */
  closedBranches: readonly BranchSummary[]
}

/**
 * How each prop is compared. `value` props are plain data rebuilt on every
 * projection (`projectSpine` makes new nodes); the rest keep their identity
 * while unchanged: `onAct` is stable (`useStable`), `nameOf` comes from
 * `useSelector` and changes only with the names, and a note card is a new
 * element each render, so a message with one redraws.
 */
const MESSAGE_PROPS = {
  node: "value",
  streams: "value",
  doc: "identity",
  tools: "value",
  join: "value",
  forkTracks: "value",
  closedBranches: "value",
  nameOf: "identity",
  about: "identity",
  origin: "identity",
  onAct: "identity",
} as const satisfies {
  readonly [K in keyof MessageProps]-?: "identity" | "value"
}

const PROPS = Object.keys(MESSAGE_PROPS) as (keyof MessageProps)[]

/** Whether a message would draw the same. */
export function sameMessageProps(a: MessageProps, b: MessageProps): boolean {
  return PROPS.every(k =>
    MESSAGE_PROPS[k] === "value" ? sameData(a[k], b[k]) : Object.is(a[k], b[k]),
  )
}

const isPlain = (x: object): boolean => {
  const proto = Object.getPrototypeOf(x)
  return proto === Object.prototype || proto === null
}

/**
 * Structural equality of plain objects, arrays and primitives. Anything else,
 * a `Map` or a function, is equal only to itself.
 */
function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object") return false
  if (a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    return a.length === b.length && a.every((x, i) => sameData(x, b[i]))
  }
  if (!isPlain(a) || !isPlain(b)) return false
  const ka = Object.keys(a)
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  return (
    ka.length === Object.keys(b).length &&
    ka.every(k => Object.hasOwn(b, k) && sameData(ra[k], rb[k]))
  )
}
