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
 * The verbs. `line.ts` spreads this into a constrained schema
 * literal, so this array is the only place a kind is declared \u2014 adding one
 * here reaches the wire, and nothing else needs editing.
 *
 *   - `prompt` appends at the lane tip.
 *   - `branch` moves the lane tip to `parentId` first, so the turn forks from
 *     there (ADR-0011: the lane carries writer identity, so this moves only
 *     the sending writer's lane).
 *   - `reference` cites `targetId`, or a span of it, from `parentId`: the
 *     entry the sender is reading, or their lane tip when `""`.
 *     It writes one value and runs nothing.
 *   - `navigate` moves the lane tip to `parentId` and runs nothing. It is how
 *     you come back from an Aside: without it a branch is one-way.
 *   - `chat` is a human message at `parentId`, or at the sender's lane tip
 *     when `""`. It runs the agent only when the agent is compelled.
 *   - `name` sets the sender's display name to `text`.
 *   - `thread` sets the default at entry `parentId`: `text` is `session` (the
 *     agent answers every message) or `conversation` (nobody is compelled).
 */
export const COMMAND_KINDS = [
  "prompt",
  "branch",
  "navigate",
  "reference",
  "chat",
  "name",
  "thread",
] as const
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
  /**
   * An entry, whose meaning depends on the kind. `branch`: the entry to fork
   * from, where `""` is refused. `navigate`: the entry to move to, where `""`
   * means the root. `chat` and `reference`: the entry the sender is reading,
   * where `""` means their own tip. `thread`: the entry the default is set at,
   * where `""` is refused. Only `codec.ts` interprets this; nothing past it
   * sees `""`.
   */
  readonly parentId: string
  /** `reference`: the entry cited. Separate from `parentId` on purpose. */
  readonly targetId: string
  /** `reference`: a span's bounds, or -1 for the whole entry (the wire is total). */
  readonly spanStart: number
  readonly spanEnd: number
}

/**
 * What a reply says happened, named rather than inferred from which fields are
 * set. `line.ts` spreads this into a constrained literal, like COMMAND_KINDS.
 */
export const OUTCOME_KINDS = [
  "started",
  "navigated",
  "referenced",
  "appended",
  "named",
  "threaded",
  "refused",
] as const
export type OutcomeKind = (typeof OUTCOME_KINDS)[number]

export interface Reply {
  readonly id: string
  readonly outcome: OutcomeKind
  readonly runId: string
  readonly errorCode: string
  readonly errorMessage: string
  /** Set only when a reference was written: its id. */
  readonly referenceId: string
  /** Set only when a chat message was appended: its entry id. */
  readonly entryId: string
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
  targetId: "",
  spanStart: -1,
  spanEnd: -1,
})

export const EMPTY_REPLY: Reply = Object.freeze({
  id: "",
  outcome: "refused",
  runId: "",
  errorCode: "",
  errorMessage: "",
  referenceId: "",
  entryId: "",
})

export const command = (fields: Partial<Command>): Command => ({
  ...EMPTY_COMMAND,
  ...fields,
})

export const reply = (fields: Partial<Reply>): Reply => ({
  ...EMPTY_REPLY,
  ...fields,
})
