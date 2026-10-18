// session — one client's connection to a host. This lists every name another
// package imports; a name only this package and its tests use is not here.

export type {
  AcceptedActing,
  AccessActing,
  ProposedChangesActing,
  ResolveActing,
  RestoreActing,
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
  LAST_ORDER,
  type MoveAnswer,
  type MoveHow,
  type SlotMove,
  slotIntents,
} from "./card-moves.ts"
export {
  type ConnectOptions,
  connectSession,
  type HostRequest,
  type SessionClient,
} from "./connect.ts"
export {
  newCanvasId,
  newCardId,
  newNoteColumnId,
  newReferenceCardId,
  newRootId,
  newThreadId,
} from "./ids.ts"
export {
  firstEmpty,
  heldBy,
  type Intents,
  NO_INTENTS,
  type Slots,
  settleSlots,
} from "./inventory.ts"
export type { OpenThreads } from "./open-threads.ts"
export { columnMessageTarget, type SendHow } from "./send.ts"
