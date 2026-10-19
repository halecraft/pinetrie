// session — one client's connection to a host. This entry lists every name
// another package imports from the session's pure modules: what pure code
// (`tsconfig.pure.json`) may reach. The connection itself, and the id
// minters, are `@pinetrie/session/connect` (`connection.ts`). A name only
// this package and its tests use is not here.

export type {
  AcceptedActing,
  AccessActing,
  ProposedChangesActing,
  ResolveActing,
  RestoreActing,
  Unsuccessful,
} from "./acting.ts"
export type { AttentionStore, SeenMentions } from "./attention-store.ts"
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
export type {
  HostRequest,
  SessionClient,
  Upload,
} from "./client.ts"
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
