// web/message-props — what a message is drawn from, and how each of its
// props is compared: `React.memo`'s rule for `Message` (`sameProps`), kept pure.

import type {
  BranchSummary,
  EntryId,
  SpineNode,
  StreamId,
  WriterId,
} from "@pinetrie/core"
import type {
  CrossCanvasLink,
  LaneJoin,
  MessageAct,
  MessageTools,
  PinnedMarker,
  RowMemory,
  ScreenMemory,
  ThreadLink,
} from "@pinetrie/interface"
import type { LiveDocHandle } from "@pinetrie/schema"
import { type PropRule, sameProps } from "./same-props.ts"

export interface MessageProps {
  node: SpineNode
  /**
   * The stream of each of its tool calls that is running, by call id
   * (`liveWork`): its own calls' only, so a stream elsewhere redraws nothing
   * here.
   */
  streams: Readonly<Record<string, StreamId>>
  /** Where a running call's output is read. */
  live: LiveDocHandle
  /** Each tool row's state, by call id, across unmounts. */
  rows: ScreenMemory<RowMemory>
  nameOf: ReadonlyMap<WriterId, string>
  /** Which tools it offers (`messageTools`). */
  tools: MessageTools
  /** What the reader asked of it: a branch, a new canvas, a closed branch. */
  onAct: (act: MessageAct) => void
  /** A lane starts here: a divider above the message names it. */
  join: LaneJoin | undefined
  /** Another canvas's thread it came from, and where that is. */
  crossCanvasLink: CrossCanvasLink | undefined
  /** Open `crossCanvasLink`'s thread, as a fork row's link opens. */
  onLink: (link: ThreadLink, at: EntryId) => void
  /** The pinned cards its run read, when it is a run's prompt (`pinnedMarkers`). */
  pinned: PinnedMarker | undefined
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
  live: "identity",
  rows: "identity",
  tools: "value",
  join: "value",
  crossCanvasLink: "value",
  onLink: "identity",
  pinned: "value",
  forkTracks: "value",
  closedBranches: "value",
  nameOf: "identity",
  onAct: "identity",
} as const satisfies { readonly [K in keyof MessageProps]-?: PropRule }

/** Whether a message would draw the same. */
export const sameMessageProps = sameProps<MessageProps>(MESSAGE_PROPS)
