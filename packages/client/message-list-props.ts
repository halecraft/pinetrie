// client/message-list-props — what a column's message list is drawn from, and
// how each prop is compared: `React.memo`'s rule for `MessageList`
// (`sameProps`), kept pure (S59).

import type {
  ColumnView,
  NoteId,
  NoteRecord,
  ThreadLane,
  TreeIndex,
  WriterId,
} from "@pineta/core"
import type { LaneJoin } from "./column-view.ts"
import type { LiveWork } from "./live.ts"
import type { MessageAct } from "./message-tools.ts"
import { type PropRule, sameProps } from "./same-props.ts"
import type { ScreenMemory } from "./screen-memory.ts"
import type { SessionClient } from "./session-view.ts"
import type { RowMemory } from "./tool-row.ts"

export interface MessageListProps {
  view: ColumnView
  index: TreeIndex
  /** The column's thread (`threadOf`). */
  lane: ThreadLane
  writable: boolean
  /** Where a lane starts on this path (`columnView`). */
  joins: ReadonlyMap<string, LaneJoin>
  /** Fork dots, by the message they sit on. */
  forks: ReadonlyMap<string, readonly number[]>
  /** Ids any column of this tab shows. */
  shown: ReadonlySet<string>
  /** Each running tool call's stream, by call id (`liveWork`). */
  tools: LiveWork["tools"]
  /** Each tool row's state, by call id, across unmounts. */
  rows: ScreenMemory<RowMemory>
  /** The note drawn with each message (`messageNotes`). */
  notesOf: ReadonlyMap<string, NoteRecord>
  nameOf: ReadonlyMap<WriterId, string>
  session: SessionClient
  onAct: (act: MessageAct) => void
  /** A note card here took focus: the column's bar follows it. */
  onFocusNote: (id: NoteId) => void
}

/**
 * How each prop is compared. Building the list costs about 35 µs per message
 * in React's development build, memoised or not (S59), so the list is skipped
 * whenever its column renders for a reason that leaves it alone.
 *
 * `view` is compared by identity: `App` keeps it while `index`, the columns
 * and the noted entries are the same, and comparing a long thread's nodes by
 * value would spend part of what skipping saves. `lane` and `joins` are
 * rebuilt on every render of the column, so they are compared by value. The
 * rest keep their identity while unchanged: memos in `App`, the facts,
 * `useSelector`'s names, `useStable`'s handler, a state setter, the row
 * memory made once in `App`.
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
  notesOf: "identity",
  nameOf: "identity",
  session: "identity",
  onAct: "identity",
  onFocusNote: "identity",
} as const satisfies { readonly [K in keyof MessageListProps]-?: PropRule }

/** Whether a column's message list would draw the same. */
export const sameMessageListProps =
  sameProps<MessageListProps>(MESSAGE_LIST_PROPS)
