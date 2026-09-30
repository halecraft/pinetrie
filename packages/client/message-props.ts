// client/message-props — what a message is drawn from, and how each of its
// props is compared: `React.memo`'s rule for `Message` (`sameProps`), kept pure.

import type { BranchSummary, SpineNode, WriterId } from "@pineta/core"
import type { SessionDocHandle } from "@pineta/schema"
import type { ReactNode } from "react"
import type { LaneJoin } from "./column-view.ts"
import type { MessageAct, MessageTools } from "./message-tools.ts"
import { type PropRule, sameProps } from "./same-props.ts"

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
  onAct: "identity",
} as const satisfies { readonly [K in keyof MessageProps]-?: PropRule }

/** Whether a message would draw the same. */
export const sameMessageProps = sameProps<MessageProps>(MESSAGE_PROPS)
