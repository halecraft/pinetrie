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

/**
 * Exchange id of the host. A Line is addressed to a peer id, so both sides must
 * agree on this string. The skeleton has exactly one host; discovery is a
 * thickening step, not a skeleton step.
 */
export const HOST_PEER_ID = "host"

/**
 * The verbs. `line.ts` spreads this into a constrained schema literal, so this
 * array is the only place a kind is declared: adding one here reaches the
 * wire, and nothing else needs editing.
 *
 *   - `chat` is a human message. `parentId` is where its sender was reading,
 *     or the branch point (`""`: the root, where only a `branch` may start);
 *     `mode` says how it joins the tree (`CHAT_MODES` in @pineta/core); `lane`
 *     names the thread's lane when the sender's column is bound to one;
 *     `asksAgent` marks a Start Agent column. It runs the agent only when the
 *     agent is its addressee (`address`).
 *   - `reference` cites `targetId`, or a span of it, from `parentId`, the entry
 *     its author is reading. It writes one value and runs nothing.
 *   - `name` sets the sender's display name to `text`.
 *   - `stop` ends the running turn of the thread whose lane is `lane`.
 *   - `note` acts on a note (ADR-0025); `mode` names the action. `open` opens
 *     the entry `parentId` for editing. `draft` starts or joins the draft of
 *     the thread a reply from `parentId` (and `lane`) would continue, with
 *     `text` as what its sender had typed. `send`, `done` and `reopen` act on
 *     the note `targetId`.
 *   - `archive` hides the root `targetId` for everyone, or restores it
 *     (ADR-0029); `mode` names the action, `archive` or `restore`.
 *   - `land` merges your work into the thread whose lane is `lane`, and runs
 *     the agent's resolution (ADR-0033); `take` puts your working copy on that
 *     lane's resolved landing.
 */
export const COMMAND_KINDS = [
  "chat",
  "reference",
  "name",
  "stop",
  "note",
  "archive",
  "land",
  "take",
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
  /** `chat`: `reply`, `queue` or `branch`; `note`: the action; `""` otherwise. */
  readonly mode: string
  /** `chat` and a `note` draft: the lane the sender's column is bound to, or `""`. */
  readonly lane: string
  /** `chat`: a Start Agent column, where no mention asks the agent. */
  readonly asksAgent: boolean
  /**
   * `chat`: where a lane it creates works: `own`, `direct` (in `workDir`), or
   * `""` for the lane above's setting (ADR-0032).
   */
  readonly workKind: string
  readonly workDir: string
  /** `reference`: the entry cited; `note`: the note acted on. Separate from `parentId` on purpose. */
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
  "referenced",
  "appended",
  "queued",
  "conflict",
  "named",
  "stopped",
  "noted",
  "archived",
  "restored",
  "taken",
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
  /** `queued`: how many messages wait ahead of it; -1 otherwise. */
  readonly position: number
  /** `conflict`: the display name of the writer who took the slot; "" otherwise. */
  readonly by: string
  /** `noted`: the note's id; "" otherwise. */
  readonly noteId: string
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
  position: -1,
  by: "",
  noteId: "",
})

export const command = (fields: Partial<Command>): Command => ({
  ...EMPTY_COMMAND,
  ...fields,
})

export const reply = (fields: Partial<Reply>): Reply => ({
  ...EMPTY_REPLY,
  ...fields,
})
