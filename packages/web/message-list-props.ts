// web/message-list-props — what a column's message list is drawn from, and how
// each prop is compared: `React.memo`'s rule for `MessageList` (`sameProps`),
// kept pure.

import type {
  AskIndex,
  DigestRecord,
  EntryId,
  RevisionRecord,
  ThreadLane,
  TreeIndex,
  WriterId,
} from "@pinetrie/core"
import type {
  ColumnAct,
  ColumnView,
  CrossCanvasLink,
  Density,
  FoldMemory,
  LaneJoin,
  LiveWork,
  MessageAct,
  ProposalFacts,
  ProposalMemory,
  RowMemory,
  ScreenMemory,
  ThreadLink,
} from "@pinetrie/interface"
import type { LiveDocHandle } from "@pinetrie/schema"
import type { ReactNode } from "react"
import { type PropRule, sameProps } from "./same-props.ts"

export interface MessageListProps {
  view: ColumnView
  index: TreeIndex
  /** The column's thread's lane (`threadLane`). */
  lane: ThreadLane
  writable: boolean
  /** Where a lane starts on this path (`columnView`). */
  joins: ReadonlyMap<EntryId, LaneJoin>
  /** Where each row from another thread's canvas is (`crossCanvasLinks`). */
  crossCanvasLinks: ReadonlyMap<EntryId, CrossCanvasLink>
  /** Open a row's other thread, as a fork row's link opens (`Origin`). */
  onLink: (link: ThreadLink, at: EntryId) => void
  /** Fork dots, by the message they sit on. */
  forks: ReadonlyMap<EntryId, readonly number[]>
  /** Ids any column of this tab shows. */
  shown: ReadonlySet<string>
  /** Each running tool call's stream, by call id (`liveWork`). */
  tools: LiveWork["tools"]
  /** Each tool row's state, by call id, across unmounts. */
  rows: ScreenMemory<RowMemory>
  nameOf: ReadonlyMap<WriterId, string>
  /** Where a running call's output is read. */
  live: LiveDocHandle
  onAct: (act: MessageAct) => void
  /** Every ask (`indexAsks`), from the same moment as `index`. */
  asks: AskIndex
  /**
   * What the rail draws apart (`railLandmarks`), sorted: no fold hides them.
   * A list, compared by value, since the running tips it holds change.
   */
  landmarks: readonly EntryId[]
  /** How much of each ask is drawn. */
  density: Density
  /** The column's tip when its reader left its end (`useFollow`). */
  releasedTip: EntryId | null
  /** The prompt of the ask this column's lane runs, if it runs. */
  runningAsk: EntryId | null
  /** The turns' revisions, whose paths an ask's digest counts. */
  revisions: ReadonlyMap<EntryId, RevisionRecord>
  /** Each ask's fold, as the reader chose it. */
  folds: FoldMemory
  /** The message a "since you were here" line goes before (`leftLine`). */
  leftBefore: EntryId | null
  /** Each ask's model-written digest, by its prompt. */
  digests: ReadonlyMap<EntryId, DigestRecord>
  /** How many comments each entry's margin holds (`marginCounts`). */
  margins: ReadonlyMap<EntryId, number>
  /** The entry whose margin is open, drawn as `marginSlot` under it; null for none. */
  openMargin: EntryId | null
  /** The open margin, as its column draws it. */
  marginSlot: ReactNode
  /** Open an entry's margin. */
  onMargin: (entry: EntryId) => void
  /** The proposals on this path, by the prompt of the ask that made each (`columnProposals`). */
  proposals: ReadonlyMap<EntryId, readonly ProposalFacts[]>
  /** Each proposal's card, as its reader left it, across unmounts. */
  proposalMemory: ScreenMemory<ProposalMemory>
  /** Why nothing may be written in this column; null where you may. */
  readOnly: string | null
  /** A column act: a press on a proposal's card. */
  onColumnAct: (act: ColumnAct) => void
}

/**
 * How each prop is compared. Building the list costs about 35 µs per message in
 * React's development build, memoised or not, so the list is skipped whenever
 * its column renders for a reason that leaves it alone.
 *
 * `view` is compared by identity: `App` keeps it while `index` and the
 * columns are the same, and comparing a long thread's nodes by
 * value would spend part of what skipping saves. `lane` and `joins` are
 * rebuilt on every render of the column, so they are compared by value. The
 * rest keep their identity while unchanged: memos in `App`, the facts,
 * `useSelector`'s names, `useStable`'s handler, the live document, the
 * row and fold memories made once in `App`. A fold's choice is read by its
 * own ask (`AskWork`), so opening one does not rebuild the list.
 */
const MESSAGE_LIST_PROPS = {
  view: "identity",
  index: "identity",
  lane: "value",
  writable: "value",
  joins: "value",
  crossCanvasLinks: "value",
  onLink: "identity",
  forks: "identity",
  shown: "identity",
  tools: "identity",
  rows: "identity",
  nameOf: "identity",
  live: "identity",
  onAct: "identity",
  asks: "identity",
  landmarks: "value",
  density: "value",
  releasedTip: "value",
  runningAsk: "value",
  revisions: "value",
  folds: "identity",
  leftBefore: "value",
  digests: "value",
  margins: "value",
  openMargin: "value",
  marginSlot: "identity",
  onMargin: "identity",
  proposals: "value",
  proposalMemory: "identity",
  readOnly: "value",
  onColumnAct: "identity",
} as const satisfies { readonly [K in keyof MessageListProps]-?: PropRule }

/** Whether a column's message list would draw the same. */
export const sameMessageListProps =
  sameProps<MessageListProps>(MESSAGE_LIST_PROPS)
