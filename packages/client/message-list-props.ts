// client/message-list-props — what a column's message list is drawn from, and
// how each prop is compared: `React.memo`'s rule for `MessageList`
// (`sameProps`), kept pure (S59).

import type {
  AskIndex,
  ColumnView,
  DigestRecord,
  EntryId,
  RevisionRecord,
  StopRecord,
  ThreadLane,
  TreeIndex,
  WriterId,
} from "@pinetrie/core"
import type { LiveDocHandle } from "@pinetrie/schema"
import type { FoldMemory } from "./ask-fold.ts"
import type { Density } from "./ask-words.ts"
import type { LaneJoin } from "./column-view.ts"
import type { LiveWork } from "./live.ts"
import type { MessageAct } from "./message-tools.ts"
import { type PropRule, sameProps } from "./same-props.ts"
import type { ScreenMemory } from "./screen-memory.ts"
import type { RowMemory } from "./tool-row.ts"

export interface MessageListProps {
  view: ColumnView
  index: TreeIndex
  /** The column's thread (`threadOf`). */
  lane: ThreadLane
  writable: boolean
  /** Where a lane starts on this path (`columnView`). */
  joins: ReadonlyMap<EntryId, LaneJoin>
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
  /** Who stopped each ask, by its prompt. */
  stops: ReadonlyMap<EntryId, StopRecord>
  /** The turns' revisions, whose paths an ask's digest counts. */
  revisions: ReadonlyMap<EntryId, RevisionRecord>
  /** Each ask's fold, as the reader chose it. */
  folds: FoldMemory
  /** The message a "since you were here" line goes before (`leftLine`). */
  leftBefore: EntryId | null
  /** Each ask's model-written digest, by its prompt. */
  digests: ReadonlyMap<EntryId, DigestRecord>
}

/**
 * How each prop is compared. Building the list costs about 35 µs per message
 * in React's development build, memoised or not (S59), so the list is skipped
 * whenever its column renders for a reason that leaves it alone.
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
  stops: "value",
  revisions: "value",
  folds: "identity",
  leftBefore: "value",
  digests: "value",
} as const satisfies { readonly [K in keyof MessageListProps]-?: PropRule }

/** Whether a column's message list would draw the same. */
export const sameMessageListProps =
  sameProps<MessageListProps>(MESSAGE_LIST_PROPS)
