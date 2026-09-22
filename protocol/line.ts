// protocol/line — binds the message contract to a Kyneta Line.
//
// Imports Kyneta's PUBLIC schema/Line API only. No pi. No Kyneta internals.
//
// Line API note: the surface was renamed — `open()` -> `sender()`,
// `listen()` -> `claimReceiver()` on the client side, plus `manager()`.
// `Line.listen(exchange)` (server side, with `.onReceive`) is unchanged.

import { Line } from "@kyneta/exchange"
import { Schema } from "@kyneta/schema"
import { CONTROL_TOPIC } from "./messages.ts"

const Command = Schema.struct({
  id: Schema.string(),
  kind: Schema.string(...["prompt"]),
  text: Schema.string(),
})

const Reply = Schema.struct({
  id: Schema.string(),
  accepted: Schema.boolean(),
  runId: Schema.string(),
  errorCode: Schema.string(),
  errorMessage: Schema.string(),
})

/** Asymmetric: client sends Command, host sends Reply. */
export const Control = Line.protocol({
  topic: CONTROL_TOPIC,
  client: Command,
  server: Reply,
})

export { Command, Reply }
