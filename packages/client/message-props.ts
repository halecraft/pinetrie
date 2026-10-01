// client/message-props — what a message is drawn from, and how each of its
// props is compared: `React.memo`'s rule for `Message` (`sameProps`), kept pure.

import type { BranchSummary, SpineNode, WriterId } from "@pineta/core"
import type { SessionDocHandle } from "@pineta/schema"
import type { LaneJoin } from "./column-view.ts"
import type { MessageAct, MessageTools } from "./message-tools.ts"
import { type PropRule, sameProps } from "./same-props.ts"
import type { ScreenMemory } from "./screen-memory.ts"
import type { RowMemory } from "./tool-row.ts"

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
  /** Each tool row's state, by call id, across unmounts. */
  rows: ScreenMemory<RowMemory>
  /** Current display names, by writer. */
  nameOf: ReadonlyMap<WriterId, string>
  /** Which tools it offers (`messageTools`). */
  tools: MessageTools
  /** What the reader asked of it: a branch, a new tab, a closed branch. */
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
 * `useSelector` and changes only with the names.
 */
const MESSAGE_PROPS = {
  node: "value",
  streams: "value",
  doc: "identity",
  rows: "identity",
  tools: "value",
  join: "value",
  forkTracks: "value",
  closedBranches: "value",
  nameOf: "identity",
  onAct: "identity",
} as const satisfies { readonly [K in keyof MessageProps]-?: PropRule }

/** Whether a message would draw the same. */
export const sameMessageProps = sameProps<MessageProps>(MESSAGE_PROPS)
