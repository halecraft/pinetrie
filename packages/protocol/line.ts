// protocol/line — binds the message contract to a Kyneta Line.
//
// Imports Kyneta's PUBLIC schema/Line API only. No pi. No Kyneta internals.
//
// A client opens its Line with `sender()` and `claimReceiver()`, addressed to
// the host's seat, which Kyneta issues and the client finds by the host's
// principal (`whenPeer`, ADR-0037). The host accepts Lines with
// `Line.listen(exchange)` and `.onReceive`, which names the client's seat.

import { Line } from "@kyneta/exchange"
import { Schema } from "@kyneta/schema"
import { COMMAND_KINDS, CONTROL_TOPIC, OUTCOME_KINDS } from "./messages.ts"

// `kind` is a CONSTRAINED literal, so a kind outside the list is refused at
// the wire boundary. Spreading COMMAND_KINDS rather than restating it keeps
// that constraint and the type in `messages.ts` from drifting: a kind added in
// one place only would be accepted by the type and dropped by the wire.
const Command = Schema.struct({
  id: Schema.string(),
  kind: Schema.string(...COMMAND_KINDS),
  text: Schema.string(),
  /** Where the sender was reading, or "" for the root (schemas are total). */
  parentId: Schema.string(),
  /** A chat's mode, or "" for other kinds. */
  mode: Schema.string(),
  lane: Schema.string(),
  asksAgent: Schema.boolean(),
  workKind: Schema.string(),
  workDir: Schema.string(),
  targetId: Schema.string(),
})

const Reply = Schema.struct({
  id: Schema.string(),
  outcome: Schema.string(...OUTCOME_KINDS),
  runId: Schema.string(),
  errorCode: Schema.string(),
  errorMessage: Schema.string(),
  entryId: Schema.string(),
  position: Schema.number(),
  by: Schema.string(),
  noteId: Schema.string(),
  text: Schema.string(),
})

/** Asymmetric: client sends Command, host sends Reply. */
export const Control = Line.protocol({
  topic: CONTROL_TOPIC,
  client: Command,
  server: Reply,
})

export { Command, Reply }
