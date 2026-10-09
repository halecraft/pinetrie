// session — one client's connection to a host: the documents it syncs and
// the requests it sends, deciding nothing about what the page draws. It runs
// unchanged in a browser and in Node, and declares no React. This lists
// every name another package imports; a name only this package and its
// tests use is not exported here.

export type { AcceptedActing, OfferActing, Unsuccessful } from "./acting.ts"
export type { AttentionStore, SeenMentions } from "./attention-doc.ts"
export {
  type ActedAt,
  AT_INVENTORY,
  atColumn,
  type CardNotice,
  drawnPlace,
  IN_COLUMN,
  intentsOf,
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
export { newCardId, newRootId, newTaskId, newThreadId } from "./ids.ts"
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
