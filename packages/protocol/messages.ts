// protocol/messages — the host<->client contract, as plain values.
//
// ZERO imports. Not pi, not Kyneta, not Node. This file is the contract both
// sides agree on; binding it to a transport happens in protocol/line.ts.

/** Line topic for the command channel (ADR-0007: commands over a Line). */
export const CONTROL_TOPIC = "pineta.control"

/** Document ids replicated host -> client (ADR-0007: state over documents). */
export const SESSION_DOC_ID = "pineta:session"
/** Who is here, and what each person reads and types: ephemeral, never stored (ADR-0024). */
export const PRESENCE_DOC_ID = "pineta:presence"
/** Every card's record (ADR-0048): written by clients, and by the host only to spend one. */
export const CARDS_DOC_ID = "pineta:cards"

/**
 * The host's principal. Kyneta issues each peer its id (its seat), so a client
 * finds the host's seat by this name (`whenPeer`) and addresses its Line
 * there. It is not an email, so no person can claim it (`writerOfPrincipal`).
 */
export const HOST_PRINCIPAL = "pineta-host"

/**
 * The verbs. `line.ts` spreads this into a constrained schema literal, so this
 * array is the only place a kind is declared: adding one here reaches the
 * wire, and nothing else needs editing.
 *
 *   - `chat` is a human message. `parentId` is where its sender was reading,
 *     or the branch point (`""`: the root, where only a `branch` may start);
 *     `mode` says how it joins the tree (`CHAT_MODES` in @pineta/core); `lane`
 *     names the thread's lane when the sender's column is bound to one;
 *     `asksAgent` marks a Start Agent column; `cardId` names the card its text
 *     was sent from, which the host spends once it is sent (ADR-0048). It
 *     runs the agent only when the agent is its addressee (`address`).
 *   - `name` sets the sender's display name to `text`.
 *   - `stop` ends the running turn of the thread whose lane is `lane`.
 *   - `archive` hides the root `targetId` for everyone, or restores it
 *     (ADR-0029); `mode` names the action, `archive` or `restore`.
 *   - `mark` titles the entry `targetId` with `text` (ADR-0045); `""`
 *     clears its title.
 *   - `update` merges your work into the thread whose lane is `lane`
 *     (ADR-0038); the agent's resolution runs only when it conflicts
 *     (ADR-0033).
 *   - `offer` acts on that lane's offer in your repo; `mode` names the
 *     action: `take`, `split`, `squash`, `describe` or `refresh`.
 *   - `reserve` asks the host to name the thread whose lane will be `lane`,
 *     a new id the sender's column made, before the lane exists (ADR-0057).
 */
export const COMMAND_KINDS = [
  "chat",
  "name",
  "stop",
  "archive",
  "mark",
  "update",
  "offer",
  "reserve",
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
   * An entry: where the sender was reading, or the branch point. `""` is the
   * root. Only `codec.ts` interprets this; nothing past it sees `""`.
   */
  readonly parentId: string
  /** `chat`: `reply`, `queue` or `branch`; `archive` and `offer`: the action; `""` otherwise. */
  readonly mode: string
  /** `chat`: the lane the sender's column is bound to, or `""`. */
  readonly lane: string
  /** `chat`: a Start Agent column, where no mention asks the agent. */
  readonly asksAgent: boolean
  /**
   * `chat`: where a lane it creates works: `own`, `direct` (in `workDir`), or
   * `""` for the lane above's setting (ADR-0032).
   */
  readonly workKind: string
  readonly workDir: string
  /** `archive`: the root; `mark`: the entry. Separate from `parentId` on purpose. */
  readonly targetId: string
  /** `chat`: the card its text was sent from, or `""` (ADR-0048). */
  readonly cardId: string
  /**
   * `chat`: the lane id the sender's column reserved, or `""`: what a lane
   * it creates is called (ADR-0057). Apart from `lane`, which decides where
   * the message goes.
   */
  readonly reserved: string
}

/**
 * What a reply says happened, named rather than inferred from which fields are
 * set. `line.ts` spreads this into a constrained literal, like COMMAND_KINDS.
 */
export const OUTCOME_KINDS = [
  "started",
  "appended",
  "queued",
  "conflict",
  "named",
  "stopped",
  "archived",
  "restored",
  "marked",
  "taken",
  "updated",
  "offered",
  "reserved",
  "refused",
] as const
export type OutcomeKind = (typeof OUTCOME_KINDS)[number]

export interface Reply {
  readonly id: string
  readonly outcome: OutcomeKind
  readonly runId: string
  readonly errorCode: string
  readonly errorMessage: string
  /** Set only when a chat message was appended: its entry id. */
  readonly entryId: string
  /** `queued`: how many messages wait ahead of it; -1 otherwise. */
  readonly position: number
  /**
   * `conflict`: the writer id of who took the slot, or "" when none is known
   * or for any other outcome. The client names it, and can tell it is itself.
   */
  readonly by: string
  /** `updated`: the composer's prefill after a clean update; "" otherwise. */
  readonly text: string
}

/**
 * Kyneta schemas are total: every field must be present on every message.
 * These defaults spell out the full shape, so callers spread rather than
 * remember it.
 */
export const EMPTY_COMMAND: Command = Object.freeze({
  id: "",
  kind: "chat",
  text: "",
  parentId: "",
  mode: "",
  lane: "",
  asksAgent: false,
  workKind: "",
  workDir: "",
  targetId: "",
  cardId: "",
  reserved: "",
})

export const EMPTY_REPLY: Reply = Object.freeze({
  id: "",
  outcome: "refused",
  runId: "",
  errorCode: "",
  errorMessage: "",
  entryId: "",
  position: -1,
  by: "",
  text: "",
})

export const command = (fields: Partial<Command>): Command => ({
  ...EMPTY_COMMAND,
  ...fields,
})

export const reply = (fields: Partial<Reply>): Reply => ({
  ...EMPTY_REPLY,
  ...fields,
})
