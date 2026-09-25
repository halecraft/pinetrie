// protocol/messages — the host<->client contract, as plain values.
//
// ZERO imports. Not pi, not Kyneta, not Node. This file is the contract both
// sides agree on; binding it to a transport happens in protocol/line.ts.

/** Line topic for the command channel (ADR-0007: commands over a Line). */
export const CONTROL_TOPIC = "pineta.control"

/** Document ids replicated host -> client (ADR-0007: state over documents). */
export const SESSION_DOC_ID = "pineta:session"

/**
 * Exchange id of the host. A Line is addressed to a peer id, so both sides must
 * agree on this string. The skeleton has exactly one host; discovery is a
 * thickening step, not a skeleton step.
 */
export const HOST_PEER_ID = "host"

/**
 * The verbs. `protocol/line.ts` spreads this into a constrained schema
 * literal, so this array is the only place a kind is declared \u2014 adding one
 * here reaches the wire, and nothing else needs editing.
 *
 *   - `prompt` appends at the lane tip.
 *   - `branch` moves the lane tip to `parentId` first, so the turn forks from
 *     there (ADR-0011: the lane carries writer identity, so this moves only
 *     the sending writer's lane).
 *   - `navigate` moves the lane tip to `parentId` and runs nothing. It is how
 *     you come back from an Aside: without it a branch is one-way.
 */
export const COMMAND_KINDS = ["prompt", "branch", "navigate"] as const
export type CommandKind = (typeof COMMAND_KINDS)[number]

/**
 * The wire shapes.
 *
 * ADR-0013 is enforced structurally here: neither type has a `seq` field, and
 * because they are exact interfaces rather than open records, adding one is a
 * compile error at every call site rather than something a reviewer has to
 * notice. `seq` is a replica-local arrival index; entry `id` is the durable
 * identifier.
 */
export interface Command {
  readonly id: string
  readonly kind: CommandKind
  readonly text: string
  /** `branch`: the entry to fork from. `navigate`: the entry to move to. */
  readonly parentId: string
}

export interface Reply {
  readonly id: string
  readonly accepted: boolean
  readonly runId: string
  readonly errorCode: string
  readonly errorMessage: string
}

/**
 * Kyneta schemas are total: every field must be present on every message.
 * These defaults spell out the full shape, so callers spread rather than
 * remember it.
 */
export const EMPTY_COMMAND: Command = Object.freeze({
  id: "",
  kind: "prompt",
  text: "",
  parentId: "",
})

export const EMPTY_REPLY: Reply = Object.freeze({
  id: "",
  accepted: false,
  runId: "",
  errorCode: "",
  errorMessage: "",
})

export const command = (fields: Partial<Command>): Command => ({
  ...EMPTY_COMMAND,
  ...fields,
})

export const reply = (fields: Partial<Reply>): Reply => ({
  ...EMPTY_REPLY,
  ...fields,
})
