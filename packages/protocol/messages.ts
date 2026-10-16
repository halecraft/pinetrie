// protocol/messages — the host<->client contract, as plain values. It
// imports nothing, not pi, Kyneta or Node; `line.ts` binds it to a Line.

export const CONTROL_TOPIC = "pinetrie.control"

export const SESSION_DOC_ID = "pinetrie:session"
/** Who is here, and what each person reads and types: ephemeral, never stored. */
export const PRESENCE_DOC_ID = "pinetrie:presence"
/**
 * Where every card is: written only by the host, through handoffs. Yjs,
 * under an id of its own so a store's older `json` places never meet the
 * Yjs schema under one id.
 */
export const PLACES_DOC_ID = "pinetrie:card-places"
/** What is streaming now: written only by the host, and compacted at every run's end. */
export const LIVE_DOC_ID = "pinetrie:live"

/**
 * The host's principal. Kyneta issues each peer its id (its seat), so a client
 * finds the host's seat by this name (`whenPeer`) and addresses its Line
 * there. It is not an email, so no person can claim it (`writerOfPrincipal`).
 */
export const HOST_PRINCIPAL = "pinetrie-host"

/**
 * The verbs. `line.ts` spreads this into a constrained schema literal, so this
 * array is the only place a kind is declared: adding one here reaches the
 * wire, and nothing else needs editing.
 *
 *   - `chat` is a human message. `mode` says how it joins the tree:
 *     `reply` at the end of the thread `lane` names, whose end its sender saw
 *     at `parentId`; `branch` starts the thread `lane` names, minted by the
 *     sender's column, at `parentId` (`""`: the root). See `ChatAt` in
 *     @pinetrie/core;
 *     `asksAgent` marks a Start Agent column; `cardId` names the card its text
 *     was sent from, which the host spends once it is sent, and
 *     `pinned` the versions of the thread's pinned cards its run waits for.
 *     It runs the agent only when the agent is its addressee (`address`).
 *   - `name` sets the sender's display name to `text`.
 *   - `picture` sets the sender's picture to the blob whose SHA-256 is
 *     `text`, or removes it with `""`.
 *   - `stop` ends the running turn of the thread whose lane is `lane`.
 *   - `carry-on` starts a new turn on that thread after a stop, its prompt
 *     the host's carry-on message.
 *   - `queue-hold` holds that thread's queue (`mode` `hold`) or releases
 *     it (`release`).
 *   - `unqueue-all` takes every message card queued on that thread back
 *     below the line.
 *   - `move-task` moves the task `task`'s card on the board: `text` is JSON `{ from, to, before }`, the state its
 *     sender saw it in, the state it goes to, and the task it goes before
 *     there, or null for the end. Answered `moved`, or `unmoved` as a
 *     card's move is.
 *   - `workflow` changes the board's states: `mode` names the
 *     action (`add`, `rename`, `move`, `remove`), `targetId` the state (`""`
 *     to add), `text` its name, and `parentId` the state it goes before
 *     (`""` for after every open state).
 *   - `mark` titles the task `task`, or the note column `cardId`, with
 *     `text`; `""` clears its title.
 *   - `retitle` asks a model for the root `root`'s title.
 * - `proposed` acts on that lane's proposed changes in your repo; `mode` names
 * the
 *     action: `accept`, `split`, `squash`, `describe` or `refresh`. An
 *     acceptance names its destination bookmark in `targetId`, `""` for the default,
 *     and what it was shown in `seen`.
 *   - `setup` sets up accepted work; `publish` publishes your work on it.
 *   - `reserve` asks the host to name the thread whose lane will be `lane`,
 *     a new id the sender's column made, before the lane exists.
 *   - `move` hands cards from place to place: `moves` lists
 *     each card, where its sender saw it and where it goes, each an encoded
 *     key or null: no `from` creates the card, and no `to` removes it.
 *     The list is accepted whole or refused (a keep's several cards).
 *   - `queue-card` moves one card into a queue, as `move` does, and
 *     changes that queue's hold (`mode`: `keep`, `hold-if-idle` or
 *     `release`) in the same step. A card it creates carries the
 *     command `targetId`.
 *   - `spin-off` makes a card a thread: `moves` is its one move,
 *     to gone, spun into the new root it names; `state` is the workflow
 *     state the root lands in, `""` for the first open state.
 *   - `reorder` moves the card `cardId` among its neighbours in its queue,
 *     among the pinned cards, in its note column or on its canvas: `moves`
 *     is `{ at, after, before }`, the key of where it is and the cards it
 *     goes after and before, `""` for none.
 *   - `card-width` draws the card `cardId` on the canvas of the task
 *     `task`, where its sender saw it, one column wide (`mode` `1`) or two
 *     (`2`).
 *   - `open-thread` starts the thread `lane`, a new id, in the root `root`
 *     and the task `task`, as `mode` says: `branch` at `parentId`;
 *     `new-task`, a new tab's, a new root and task its tab minted, `state`
 *     as for `spin-off`; `new-root`, a new root its tab minted in a task the
 *     session holds, its card just after `cardId` (`""` for first).
 *   - `copy-thread` copies the thread `lane` at its end `parentId` as its
 *     sender saw it: `moves` is the copy's one move, its new
 *     thread's card from nowhere onto a canvas spot or into the sender's
 *     inventory.
 *   - `paste` makes a card from a copy, or moves a cut one out of a trash
 *     by its cutter: `mode` is `text`, `reference` or `uncut`;
 *     `moves` ends with the card's move (from nowhere, or from a trash),
 *     after the discard of the card it replaces, if any; `text`
 *     is a reference's address, or a text card's origin (`""` for none),
 *     printed (`printAddress`); `seen` a reference's quote's blob; `here`
 *     the sender's task.
 *   - `undo-move` undoes (`mode` `undo`) or redoes (`redo`) the sender's
 *     newest move in the root `root`.
 *   - `set-command` sets the card `cardId`'s command to `mode`, or
 *     clears it with `""`.
 *   - `traces-seen` names the sender's traces they have seen, a JSON list
 *     of ids in `text`; the host deletes them.
 *   - `ssh-access` answers a lane's use of its owner's ssh identity: `mode`
 *     `approve`, `refuse` or `revoke`, for the thread `lane`.
 */
export const COMMAND_KINDS = [
  "chat",
  "name",
  "picture",
  "stop",
  "carry-on",
  "move-task",
  "workflow",
  "mark",
  "retitle",
  "proposed",
  "reserve",
  "move",
  "queue-card",
  "reorder",
  "card-width",
  "queue-hold",
  "unqueue-all",
  "spin-off",
  "open-thread",
  "copy-thread",
  "paste",
  "set-command",
  "setup",
  "publish",
  "undo-move",
  "traces-seen",
  "ssh-access",
] as const
export type CommandKind = (typeof COMMAND_KINDS)[number]

/**
 * Neither wire shape has a `seq` field: `seq` is a replica-local arrival
 * index, and an entry's `id` is what names it across replicas. As exact
 * interfaces, adding one is a compile error at every call site.
 */
export interface Command {
  readonly id: string
  readonly kind: CommandKind
  readonly text: string
  /**
   * An entry: where the sender was reading, or the branch point. `""` is the
   * root. `workflow`: the state a moved or added state goes before, `""` for
   * the end. Only `codec.ts` interprets this; nothing past it sees `""`.
   */
  readonly parentId: string
  /**
   * `chat`: the root it writes in; for a chat at the root, a new
   * root's id the sender's tab minted. `""` otherwise.
   */
  readonly root: string
  /**
   * `chat` and `spin-off`: the task a thread it starts goes in, for a new
   * root a new task's id the sender's tab minted; `move-task`,
   * `mark`, `retitle` and `undo-move`: the task it acts on; `card-width`:
   * the task whose canvas its sender saw the card on. `""` otherwise.
   */
  readonly task: string
  /**
   * `move` and `spin-off`: the task its sender is on, which names a
   * discard's history for a card in an inventory. `""` for none.
   */
  readonly here: string
  /**
   * `chat`: `reply` or `branch`; `proposed` and `workflow`: the action;
   * `set-command`: the command; `undo-move`: `undo` or `redo`;
   * `card-width`: `1` or `2`; `ssh-access`: the answer; `""` otherwise.
   */
  readonly mode: string
  /**
   * `chat`: its thread, which names its lane too; `stop`,
   * `carry-on`, `unqueue-all`, `queue-hold`, `reserve`, `ssh-access`: the
   * thread whose lane it acts on.
   */
  readonly lane: string
  /** `chat`: a Start Agent column, where no mention asks the agent. */
  readonly asksAgent: boolean
  /**
   * `proposed` `accept`: the destination bookmark, `""`
   * for the default; `workflow`: the state; `queue-card`: the command of
   * the card it creates, `""` for none. Separate from `parentId` on
   * purpose.
   */
  readonly targetId: string
  /**
   * `chat`: the card its text was sent from, or `""`;
   * `set-command`, `reorder`, `card-width`: the card.
   */
  readonly cardId: string
  /**
   * `chat`: the card's text version as the sender had it, which the host waits
   * for, since the text can reach it after the card's record; or `""`.
   * `proposed` `accept`: what the acceptance was shown (`ProposedChangesSeen`),
   * as JSON; an acceptance without it is refused.
   */
  readonly seen: string
  /**
   * `move`: a JSON list of `{ card, from, to }`, each place a key's flat
   * fields or null (`encodeMoves`); `reorder`: `{ at, after, before }`
   * (`encodeReorder`); `""` otherwise.
   */
  readonly moves: string
  /**
   * `chat`: a JSON list of `{ card, seen }`, each card pinned at the
   * sender's thread end with its text version as the sender had it, which
   * the run waits for; `""` otherwise.
   */
  readonly pinned: string
  /**
   * `chat`: the WIP bookmark a lane it creates starts from, or `""` for
   * accepted work.
   */
  readonly base: string
  /**
   * `chat` and `spin-off`: the workflow state a task it starts lands in,
   * or `""` for the first open state.
   */
  readonly state: string
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
  "reserved",
  "pictured",
  "stopped",
  "workflow-changed",
  "marked",
  "retitling",
  "accepted",
  "proposed",
  "seen",
  "accepted-moved",
  "moved",
  "held",
  "released",
  "queued",
  "unmoved",
  "undone",
  "nothing",
  "answered",
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
   * `conflict`: the writer id of who wrote at the slot first; `unmoved`: who put the
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
   * wrote it or refused a move; 0 otherwise. A client draws its
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
  task: "",
  here: "",
  mode: "",
  lane: "",
  asksAgent: false,
  targetId: "",
  cardId: "",
  base: "",
  seen: "",
  moves: "",
  pinned: "",
  state: "",
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
