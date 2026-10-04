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
 * Where every card is (ADR-0059): written only by the host, through handoffs.
 * Yjs (ADR-0066), under a new id so a store's `json` places never meet the
 * new schema under one id.
 */
export const PLACES_DOC_ID = "pineta:card-places"
/** What is streaming now (ADR-0063): written only by the host, and compacted at every run's end. */
export const LIVE_DOC_ID = "pineta:live"

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
 *     was sent from, which the host spends once it is sent (ADR-0048), and
 *     `pinned` the versions of the thread's pinned cards its run waits for.
 *     It runs the agent only when the agent is its addressee (`address`).
 *   - `name` sets the sender's display name to `text`.
 *   - `stop` ends the running turn of the thread whose lane is `lane`.
 *   - `archive` hides the root `targetId` for everyone, or restores it
 *     (ADR-0029); `mode` names the action, `archive` or `restore`.
 *   - `mark` titles the entry `targetId` with `text` (ADR-0045); `""`
 *     clears its title.
 *   - `retitle` asks a model for the root `root`'s title (ADR-0074).
 *   - `offer` acts on that lane's offer in your repo; `mode` names the
 *     action: `take`, `split`, `squash`, `describe` or `refresh`. A take
 *     names its destination bookmark in `targetId`, `""` for the default,
 *     and what it was shown in `seen`.
 *   - `line` sets up the integration line (`mode` `setup`) or lands your
 *     work on it (`land`), ADR-0060.
 *   - `reserve` asks the host to name the thread whose lane will be `lane`,
 *     a new id the sender's column made, before the lane exists (ADR-0057).
 *   - `move` hands cards from place to place (ADR-0059): `moves` lists
 *     each card, where its sender saw it and where it goes, each an encoded
 *     key or null: no `from` creates the card, and no `to` removes it.
 *     The list is accepted whole or refused (a keep's several cards).
 *   - `undo-move` undoes (`mode` `undo`) or redoes (`redo`) the sender's
 *     newest move in the root `root` (ADR-0066).
 *   - `set-command` sets the card `cardId`'s command to `mode`, or
 *     clears it with `""` (ADR-0055).
 */
export const COMMAND_KINDS = [
  "chat",
  "name",
  "stop",
  "archive",
  "mark",
  "retitle",
  "offer",
  "reserve",
  "move",
  "set-command",
  "line",
  "undo-move",
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
  /**
   * `chat`, `mark` and `retitle`: the root it writes in (ADR-0063); for a
   * chat at the root, a new root's id the sender's tab minted. `undo-move`:
   * the root whose history it acts on. `""` otherwise.
   */
  readonly root: string
  /**
   * `chat`: `reply` or `branch`; `archive` and `offer`: the action;
   * `set-command`: the command; `undo-move`: `undo` or `redo`; `""`
   * otherwise.
   */
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
  /**
   * `archive`: the root; `mark`: the entry; `offer` `take`: the destination
   * bookmark, `""` for the default. Separate from `parentId` on purpose.
   */
  readonly targetId: string
  /** `chat`: the card its text was sent from, or `""` (ADR-0048); `move`, `set-command`: the card. */
  readonly cardId: string
  /**
   * `chat`: the card's text version as the sender had it (S96), or `""`.
   * `offer` `take`: what the take was shown (`OfferSeen`, ADR-0065), as JSON;
   * a take without it is refused.
   */
  readonly seen: string
  /**
   * `move`: a JSON list of `{ card, from, to }`, each place a key's flat
   * fields or null (`encodeMoves`); `""` otherwise.
   */
  readonly moves: string
  /**
   * `chat`: a JSON list of `{ card, seen }`, each card pinned at the
   * sender's thread end with its text version as the sender had it, which
   * the run waits for (ADR-0048, S96); `""` otherwise.
   */
  readonly pinned: string
  /**
   * `chat`: the lane id the sender's column reserved, or `""`: what a lane
   * it creates is called (ADR-0057). Apart from `lane`, which decides where
   * the message goes.
   */
  readonly reserved: string
  /**
   * `chat`: the WIP bookmark a lane it creates starts from, or `""` for the
   * line (ADR-0060).
   */
  readonly base: string
}

/**
 * What a reply says happened, named rather than inferred from which fields are
 * set. `line.ts` spreads this into a constrained literal, like COMMAND_KINDS.
 */
export const OUTCOME_KINDS = [
  "started",
  "appended",
  "busy",
  "conflict",
  "named",
  "stopped",
  "archived",
  "restored",
  "marked",
  "retitling",
  "taken",
  "offered",
  "reserved",
  "line-moved",
  "moved",
  "queued",
  "unmoved",
  "undone",
  "nothing",
  "refused",
  "failed",
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
  /**
   * `conflict`: the writer id of who took the slot; `unmoved`: who put the
   * card where it is now. "" when none is known, or for any other outcome.
   * The client names it, and can tell it is itself.
   */
  readonly by: string
  /** `unmoved`: why (a `MoveRefusal`), in `errorCode`; and where the card is now, an encoded key, or `""` when it is gone. */
  readonly place: string
  /**
   * `undone`: a JSON list of `{ card, place }`, each card the undo moved
   * and its place now, a key's flat fields or null; `""` otherwise.
   */
  readonly cards: string
  /**
   * The places document's `rev` after the command's step, when the step
   * wrote it or refused a move; 0 otherwise (ADR-0059). A client draws its
   * move until its copy reaches it.
   */
  readonly rev: number
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
  root: "",
  mode: "",
  lane: "",
  asksAgent: false,
  workKind: "",
  workDir: "",
  targetId: "",
  cardId: "",
  reserved: "",
  base: "",
  seen: "",
  moves: "",
  pinned: "",
})

export const EMPTY_REPLY: Reply = Object.freeze({
  id: "",
  outcome: "refused",
  runId: "",
  errorCode: "",
  errorMessage: "",
  entryId: "",
  by: "",
  place: "",
  cards: "",
  rev: 0,
})

export const command = (fields: Partial<Command>): Command => ({
  ...EMPTY_COMMAND,
  ...fields,
})

export const reply = (fields: Partial<Reply>): Reply => ({
  ...EMPTY_REPLY,
  ...fields,
})
