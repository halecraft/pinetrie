// session — one client's connection to a host. This lists every name another
// package imports; a name only this package and its tests use is not here.

export type {
  AcceptedActing,
  AccessActing,
  ProposedChangesActing,
  Unsuccessful,
} from "./acting.ts"
export type { AttentionStore, SeenMentions } from "./attention-doc.ts"
export {
  type ActedAt,
  AT_BOARD,
  AT_INVENTORY,
  atColumn,
  type CardNotice,
  drawnPlace,
  IN_COLUMN,
  intentsOf,
  LAST_ORDER,
  type MoveAnswer,
  type MoveHow,
  type SlotMove,
} from "./card-moves.ts"
export { type ChatHow, chatAtOf } from "./chat.ts"
export {
  type ConnectOptions,
  connectSession,
  type HostRequest,
  type SessionClient,
} from "./connect.ts"
export {
  newCardId,
  newNoteColumnId,
  newReferenceCardId,
  newRootId,
  newTaskId,
  newThreadId,
} from "./ids.ts"
export {
  firstEmpty,
  heldBy,
  type Intents,
  NO_INTENTS,
  SLOT_INDICES,
  type Slots,
  settleSlots,
} from "./inventory.ts"
export type { OpenThreads } from "./open-threads.ts"
