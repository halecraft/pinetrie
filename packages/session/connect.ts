// session/connect — connect to a host and expose what the page and the e2e
// suites read and send.

import {
  createUndoStack,
  Exchange,
  sync,
  type Undone,
  type UndoStack,
  whenPeer,
  whenSettled,
} from "@kyneta/exchange"
import { type CommitOptions, subscribe } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"
import {
  type AcceptedAction,
  type AccessAnswer,
  type CanvasId,
  type CardCommand,
  type CardId,
  type CardPlace,
  type CardRecord,
  type ConflictChoice,
  type EntryId,
  type Intent,
  isTextCard,
  isTextCardId,
  type MessageAt,
  type MoveDirection,
  type MoveTarget,
  type Paste,
  type ProposedChangesAction,
  placeKey,
  type QueueHoldChange,
  type QueueMove,
  type Reorder,
  type Replacing,
  type RestorePreview,
  type RootId,
  type TextCard,
  type TextCardId,
  type ThreadId,
  TRASH_PLACE,
  type TypedMove,
  type WriterId,
  writerOfPrincipal,
} from "@pinetrie/core"
import type { Outcome } from "@pinetrie/protocol/codec"
import { Control } from "@pinetrie/protocol/line"
import {
  HOST_PRINCIPAL,
  LIVE_DOC_ID,
  PLACES_DOC_ID,
  SESSION_DOC_ID,
} from "@pinetrie/protocol/messages"
import { personDocId, writersPolicy } from "@pinetrie/protocol/writers"
import {
  readArchived,
  readPlaces,
  readPlacesRev,
  readProposedByLane,
  readRoots,
} from "@pinetrie/reads"
import { pastedCard, proposedChangesSeen } from "@pinetrie/rules"
import {
  cardDocId,
  cardIdOfDoc,
  LiveDoc,
  type LiveDocHandle,
  PlacesDoc,
  type PlacesDocHandle,
  PRESENCE_DECAY,
  type PresenceDecay,
  type PresenceDocHandle,
  type RootDocHandle,
  SessionDoc,
  type SessionDocHandle,
  type TextDocHandle,
  textVersion,
} from "@pinetrie/schema"
import { type ActingState, NO_ACTING, sendActing } from "./acting.ts"
import {
  type AttentionStore,
  attentionStore,
  startingSince,
} from "./attention-doc.ts"
import {
  type ActedAt,
  AT_INVENTORY,
  type CardNotice,
  cardOfPending,
  drawnPlace,
  type LocalEvent,
  type LocalState,
  localStep,
  type MoveAnswer,
  type MoveHow,
  type MovesState,
  moveAnswer,
  NO_MOVES,
  OFF_PAGE,
  type Pending,
  pendingMove,
  queuedDraft,
  type SlotMove,
  slotIntents,
  slotOnAccept,
  stampSeen,
} from "./card-moves.ts"
import { cardTexts } from "./card-texts.ts"
import { hostLine } from "./host-line.ts"
import { heldBy, type Slots, swapWrites } from "./inventory.ts"
import { inventorySlots } from "./inventory-slots.ts"
import { type OpenThreads, openThreads } from "./open-threads.ts"
import { presenceSeat } from "./presence-seat.ts"
import { NO_ROOT, rootDocs } from "./root-docs.ts"
import { planSendRequest, type SendHow, startsRoot } from "./send.ts"
import { type Readable, readable, select, snapshotStore } from "./store.ts"

/**
 * The `WebSocket` constructor to use. The browser supplies the global; Node
 * supplies its own. Typed as the shape Kyneta's transport asks for rather than
 * `any`, so a wrong value is caught here instead of at connect time.
 */
type WebSocketCtor = ConstructorParameters<
  typeof WebsocketClientTransport
>[0]["WebSocket"]

export interface ConnectOptions {
  readonly url: string
  /**
   * An invite key, for a Node client of a host off loopback. A browser needs
   * none: the invite link's redirect set a cookie its requests carry.
   */
  readonly key?: string
  /** How long presence lasts without a refresh; a suite shortens it. */
  readonly presenceDecay?: PresenceDecay
  readonly WebSocket: WebSocketCtor
  /**
   * Who this client is: a person's email, the principal its Exchange names.
   * Kyneta issues the seat.
   */
  readonly principal: string
}

export interface SessionClient {
  /** The email this client connected as. */
  readonly principal: string
  /** Who this client is to the host: derived from the principal, as the host does. */
  readonly writer: WriterId
  /**
   * The live Exchange and doc, exposed so a React tree can render from the
   * SAME connection this client already owns (via ExchangeProvider) rather
   * than opening a second one, and so Node callers read the same document.
   */
  readonly exchange: Exchange
  /** The session's records, the directory of roots among them. */
  readonly session: SessionDocHandle
  /** What is streaming now: which lanes run, and their streams. */
  readonly live: LiveDocHandle
  /**
   * The roots' documents this client holds: those it was asked to
   * hold (`holdRoots`), and a root it has just started, until then.
   */
  readonly roots: Readable<ReadonlyMap<RootId, RootDocHandle>>
  /**
   * Hold exactly `roots`' documents, and a root this client just started:
   * opened if new, and every other let go (`destroy`), which leaves the
   * host's copy.
   */
  holdRoots(roots: ReadonlySet<RootId>): void
  /** The root a held document has `entry` in, or undefined. */
  rootOf(entry: EntryId): RootId | undefined
  /**
   * Who is here. Write it only through `setReading`,
   * `clearReading` and `setTyping`, which write under this seat's key.
   */
  readonly presence: PresenceDocHandle
  /**
   * Every card's record: the host's, with this tab's moves the
   * copy does not yet hold drawn over them (`withPending`). The places
   * document itself is never exposed, and a write to it throws
   * (`writersPolicy`). Move a card only through `createCard` and `moveCard`,
   * and write its text through its editor.
   */
  readonly cards: Readable<readonly CardRecord[]>
  /**
   * Once this client's copy of the places has settled: what a canvas holds
   * is there, so the roots of the sidebar's canvases can be held.
   */
  placesSettled(): Promise<void>
  /**
   * This tab's undo stack, narrowed to one card: undo and redo take only the
   * steps that wrote its text, its creation among them. The stack
   * itself is not exposed: its own `undo()` takes the tab's last step,
   * wherever that is. It is in memory, so it lasts until the tab reloads or
   * closes. Each undo and redo says what it did (`Undone`).
   */
  undoFor(id: TextCardId): CardUndo
  /**
   * This window's column `columnKey` shows the thread ending at `end`, on
   * the canvas `canvas` (null: not yet known).
   */
  setReading(columnKey: string, end: string, canvas: string | null): void
  /** The column closed: its entry is deleted, not left to decay. */
  clearReading(columnKey: string): void
  /**
   * This window is typing at `end`, in `card` when it is one already (the
   * host pops no card someone types in). Silence decays it.
   */
  setTyping(end: string, card: CardId | null): void
  /**
   * A human message. `at` is where the sender is reading, or the branch point
   * (only a `branch` starts at the root). It runs the agent only if the agent
   * is its addressee (`address`).
   */
  send(text: string, at: MessageAt, how?: SendHow): Promise<Outcome>
  /**
   * Ask the host for anything this tab does not track and that needs no
   * root found: a name, a stop, a reservation, an archive or a restore, a
   * card's command. Each kind is documented on core's
   * `Intent`.
   */
  request(intent: HostRequest): Promise<Outcome>
  /**
   * A card's text: the same document for every caller. Call it only for a
   * card whose record is live: once the host has spent the card, this client
   * destroys its copy (`hostLetGo`, `spentCards`), and a call then would make
   * a new, empty one.
   */
  cardText(id: TextCardId): TextDocHandle
  /**
   * Create a card holding `text`: its text in one undo step, so undoing past
   * the first keystroke empties it, and a request that the host place it,
   * then one for its command when it has one. Into your
   * inventory, `how.slot` is the slot it takes.
   */
  createCard(card: NewCard, text: string, how?: MoveHow): Promise<MoveAnswer>
  /**
   * Paste: a text card's `text` written first, as a creation's
   * is, then one request that trashes the card it replaces and
   * makes the pasted card where `to` is, or moves a cut card out of your
   * trash there. Drawn there, and the replaced card gone, until the host
   * answers. Into your inventory, `how.slot` is the slot it takes.
   */
  paste(
    pasted: {
      readonly paste: Paste
      readonly to: MoveTarget
      readonly replacing: Replacing | null
      readonly here: CanvasId | null
      /** A pasted text card's text; "" for any other paste. */
      readonly text: string
    },
    how?: MoveHow,
  ): Promise<MoveAnswer>
  /**
   * Ask the host to move a card, as the page planned it: a take
   * into the inventory, a put, an unqueue, or a trash (to gone); a queue is
   * `queueCard`. Into your inventory with `how.slot`, the slot is written once the host
   * accepts, before the answer is recorded, so the repair never sees the
   * card held without its slot. `queuedBy`, for an unqueue, is who queued
   * the card: if the host popped it first, the refusal says it was sent, as
   * theirs. `here`, the canvas this tab is on, names the history of a
   * trash from your inventory. Resolves with the host's answer.
   */
  moveCard(
    move: TypedMove,
    how?: MoveHow,
    queuedBy?: WriterId | null,
    here?: CanvasId | null,
  ): Promise<MoveAnswer>
  /**
   * Ask the host to queue a card: `move` into a queue, sent with
   * its text's version as this client has it then, and what it does to
   * that queue's hold, which the host decides with the move in one step.
   * A move with no `from` makes the card in the queue, empty, carrying
   * `command`: it never passes through another place. Drawn queued at once;
   * resolves with the host's answer.
   */
  queueCard(
    move: QueueMove,
    hold: QueueHoldChange,
    how?: MoveHow,
    command?: CardCommand | null,
  ): Promise<MoveAnswer>
  /**
   * Ask the host to move a queued or pinned card among its neighbours, as
   * the page saw them, drawn there at once. Resolves with
   * the host's answer; a refusal is kept where you acted.
   */
  reorderCard(reorder: Reorder, how?: MoveHow): Promise<MoveAnswer>
  /**
   * Hand several cards at once, as one move the host accepts or refuses
   * whole (a keep), each with the slot it takes; `here`, as
   * `moveCard`'s.
   */
  moveCards(
    moves: readonly [SlotMove, ...SlotMove[]],
    actedAt: ActedAt,
    here?: CanvasId | null,
  ): Promise<MoveAnswer>
  /**
   * Undo or redo your newest move in `canvas`, or outside any canvas for none:
   * the host's history of your moves there, from any of your tabs.
   */
  undoMoves(canvas: CanvasId | null, direction: MoveDirection): Promise<Outcome>
  /**
   * Swap two slots of your inventory, in one write, as one step of this
   * tab's swaps; no host is asked.
   */
  swapSlots(a: number, b: number): void
  /**
   * Undo or redo this tab's newest swap, whole or refused: refused, said at
   * the inventory, when the slots it wrote have changed since.
   */
  undoSwap(direction: MoveDirection): Promise<void>
  /** Keep a refusal: one made before anything was sent, or an undo's. */
  refuse(refusal: CardNotice): void
  /** You acted at `at` with no move of a card: the notices there go (a move on the board). */
  acted(at: ActedAt): void
  /** This tab's moves: in flight and refused (`card-moves.ts`). */
  readonly moves: Readable<MovesState>
  /**
   * Your inventory's slots as your document holds them, repaired from the
   * host's record on every change (`repairStep`). Written only by your own
   * tabs: the repair, the answer to a take into the inventory, and
   * `swapSlots`.
   */
  readonly slots: Readable<Slots>
  /**
   * What you have dealt with, on every device of yours: how far
   * you have read each thread, what you marked "not needed", the mentions
   * you have seen.
   */
  readonly attention: AttentionStore
  /**
   * The sidebar: the roots you have open, in your order, on every device of
   * yours. A root moved to the archive leaves it, but the one
   * the page reports it shows (`here`).
   */
  readonly openThreads: OpenThreads
  /**
   * An action on a lane's proposed changes in your repo; an acceptance names
   * its destination bookmark, null for the default, and the proposed changes as
   * this tab's record shows it (`proposedChangesSeen`). Tracked in `acting`.
   */
  proposed(
    lane: ThreadId,
    action: ProposedChangesAction,
    to?: string | null,
  ): Promise<Outcome>
  /** Set up accepted work, or publish it. Tracked in `acting`. */
  actOnAccepted(action: AcceptedAction): Promise<Outcome>
  /**
   * A folder project's kept state written back into its folder, as its
   * preview drew it: `of` the state, `from` accepted work's newest the
   * preview was drawn from, sent as what was shown. Tracked in `acting`.
   */
  restore(preview: RestorePreview): Promise<Outcome>
  /** `lane`'s conflict at `path` closed with `choose`'s version. Tracked in `acting`. */
  resolve(
    lane: ThreadId,
    path: string,
    choose: ConflictChoice,
  ): Promise<Outcome>
  /** Your answer to `lane`'s use of your ssh identity. Tracked in `acting`. */
  access(lane: ThreadId, answer: AccessAnswer): Promise<Outcome>
  /** Your proposed changes, setup and publish commands out now, or refused or failed (`acting.ts`). */
  readonly acting: Readable<ActingState>
  /** Let go of every part, then shut the exchange down; rejects only when that fails. */
  close(): Promise<void>
}

/**
 * What the host is asked for that is neither tracked nor needs a root found: a
 * chat, a move and a reorder are tracked in `moves`, an undo of moves waits for
 * this tab's copy of the places, and an action on proposed changes and set up
 * or publish are tracked in `acting`.
 */
export type HostRequest = Exclude<
  Intent,
  {
    kind:
      | "send"
      | "move"
      | "reorder"
      | "undo-move"
      | "proposed"
      | "setup"
      | "publish"
  }
>

/** A card to create: the session makes you its owner and placer. */
export type NewCard = Pick<TextCard, "id" | "place" | "content">

/**
 * One card's undo, as its box binds it (`@kyneta/react`'s `attach`), saying
 * what each undo and redo did.
 */
export type CardUndo = Pick<UndoStack, "typing"> & {
  undo(options?: CommitOptions): Promise<Undone>
  redo(options?: CommitOptions): Promise<Undone>
}

export async function connectSession(
  options: ConnectOptions,
): Promise<SessionClient> {
  const { principal } = options
  const me = writerOfPrincipal(principal)
  if (me === undefined)
    throw new Error(
      `connectSession: the principal must be an email, not ${principal}`,
    )

  const transport = new WebsocketClientTransport({
    url:
      options.key === undefined
        ? options.url
        : `${options.url}?key=${encodeURIComponent(options.key)}`,
    WebSocket: options.WebSocket,
    reconnect: { enabled: false },
  })
  const exchange = new Exchange({ principal, transports: [transport] })
  // Who may write what is declared on every peer: this client's own write to
  // the places, or to someone else's inventory, throws before it is made.
  exchange.register(writersPolicy)
  await transport.waitForStatus("ready", { timeoutMs: 10_000 })
  // Kyneta issues the host's seat, so it is found by its principal.
  const host = await within(
    10_000,
    whenPeer(exchange, p => p.principal === HOST_PRINCIPAL),
    "the host did not introduce itself",
  )

  const session = exchange.get(SESSION_DOC_ID, SessionDoc)
  const live = exchange.get(LIVE_DOC_ID, LiveDoc)
  const roots = rootDocs(exchange)
  // Never written here: `cards` is how the page reads it.
  const places = exchange.get(PLACES_DOC_ID, PlacesDoc)
  const texts = cardTexts(
    exchange,
    host.peerId,
    id => places.cards()[id] !== undefined,
  )
  // The host's records, this tab's moves, and the cards as the page reads
  // them: the records with those moves drawn over them (`localStep`).
  const records = readPlaces(places)
  // With no moves, the cards drawn are the records themselves (`withPending`).
  const local = snapshotStore<LocalState>({
    records,
    moves: NO_MOVES,
    cards: records,
  })
  const cards = select(local, s => s.cards)
  const moves = select(local, s => s.moves)
  const acting = snapshotStore<ActingState>(NO_ACTING)
  const inventory = inventorySlots(exchange, me, host.peerId, {
    held: () => heldBy(local.current().records, me).map(c => c.id),
    intents: () => slotIntents(local.current().moves),
  })
  // Before the directory arrives, a start would leave out every root not yet
  // read, and their run-end reports and mentions would count as new.
  const attention = attentionStore(exchange, me, host.peerId, () =>
    sync(session).readyFor(p => p.peerId === host.peerId)
      ? startingSince(readRoots(session).values())
      : null,
  )
  const open = openThreads(exchange, me, host.peerId, () => {
    const archived = readArchived(session, places)
    return new Set(archived.keys())
  })
  // The archive is read from both: the board's cards and their histories.
  const unsubscribeSession = subscribe(session, () => open.repair())
  const step = (event: LocalEvent) => {
    local.set(localStep(local.current(), event, me))
    inventory.repair()
  }
  // Its own document, which the host neither holds nor relays (host/policy.ts).
  const undo = await createUndoStack({
    exchange,
    docId: `undo:${exchange.peerId}`,
    key: "cards",
    scope: id => cardIdOfDoc(id) !== undefined,
  })
  // This tab's swaps in your inventory, on the same document under their
  // own key: a text's undo never takes a swap. The repair writes
  // outside it, so an undo refuses a swap whose slots it changed.
  const swaps = await createUndoStack({
    exchange,
    docId: `undo:${exchange.peerId}`,
    key: "slots",
    scope: id => id === personDocId("inventory", me),
  })
  const presence = presenceSeat(
    exchange,
    me,
    options.presenceDecay ?? PRESENCE_DECAY,
  )
  const sender = Control.sender(exchange, host.peerId)
  const line = hostLine({
    send: command => sender.send(command),
    replies: Control.claimReceiver(exchange, host.peerId),
  })

  const unsubscribePlaces = subscribe(places, () => {
    step({
      kind: "records",
      records: readPlaces(places),
      rev: readPlacesRev(places),
    })
    texts.sweep()
    open.repair()
  })
  // A client does not reconnect: once the host has gone, nothing this tab
  // sent or sends will be answered. The moves the host accepted are dropped
  // too (`hostLeft`): no copy of the places will reach their `rev`.
  const unsubscribePeers = exchange.peers.subscribe(() => {
    if (exchange.peers.current.has(host.peerId)) return
    step({ kind: "hostLeft" })
    line.close("the host left")
  })

  const send = (intent: Intent): Promise<Outcome> =>
    line.request(intent).then(r => r.outcome)

  /**
   * Send a request that moves cards: each drawn at once as one of `pending`,
   * which share its id, until this tab's copy holds what the host did, and
   * answered as the host answers it. `queuedBy`: who queued the card a
   * refusal is about, if it is queued. An accepted take into the inventory
   * writes its slot before its answer is stepped.
   */
  function tracked(
    intent: Intent,
    pending: readonly [Pending, ...Pending[]],
    queuedBy: WriterId | null,
  ): Promise<{ readonly outcome: Outcome; readonly answer: MoveAnswer }> {
    const [first] = pending
    step({ kind: "sent", pending })
    return line.request(intent, first.id).then(({ outcome, rev }) => {
      const answer = moveAnswer(outcome, rev, {
        card: cardOfPending(first),
        queuedBy,
        actedAt: first.actedAt,
      })
      for (const p of pending) {
        const slotted = slotOnAccept(p, answer)
        if (slotted !== null) inventory.putAway(slotted.card, slotted.slot)
      }
      step({ kind: "answered", id: first.id, answer })
      return { outcome, answer }
    })
  }

  /**
   * A card's text version as this client has it now: what a queued card's
   * pop, and a run's pinned cards, wait for the host to hold. It opens
   * a card's document this client does not hold yet, so it is called while
   * gathering, never from a plan.
   */
  const versionOf = (id: CardId): string =>
    isTextCardId(id) ? textVersion(texts.text(id)) : ""

  /**
   * A move, tracked; with `draft`, a creation, drawn as that record. Never
   * into a queue: that is `queueCard`'s, with its text's version.
   */
  function sendMove(
    move: TypedMove,
    how: MoveHow,
    queuedBy: WriterId | null,
    draft: CardRecord | null,
    here: CanvasId | null,
  ): Promise<MoveAnswer> {
    return tracked(
      { kind: "move", moves: [move], here },
      [pendingMove(crypto.randomUUID(), move, how, draft)],
      queuedBy,
    ).then(r => r.answer)
  }

  return {
    principal,
    writer: me,
    exchange,
    session,
    live,
    presence: presence.handle,
    setReading: presence.setReading,
    clearReading: presence.clearReading,
    setTyping: presence.setTyping,
    roots: roots.roots,
    holdRoots: roots.hold,
    rootOf: roots.rootOf,
    cards,
    placesSettled: () => whenSettled(places).then(() => {}),
    moves,
    slots: inventory.slots,
    attention,
    openThreads: open,
    cardText: texts.text,
    undoFor(id) {
      const docs = [cardDocId(id)]
      return {
        typing: fn => undo.typing(fn),
        undo: options => undo.undo({ ...options, docs }),
        redo: options => undo.redo({ ...options, docs }),
      }
    },
    send(text, at, how = {}) {
      // gather: the root (minted and held for a send at the root), the card
      // as drawn, and each card's text version as this client has it.
      const root = roots.rootFor(at, how.root)
      if (root === undefined) return Promise.resolve(NO_ROOT)
      const record =
        how.card === undefined
          ? undefined
          : cards
              .current()
              .filter(isTextCard)
              .find(c => c.id === how.card)
      const plan = planSendRequest({
        text,
        at,
        how,
        root,
        card:
          record === undefined ? null : { record, seen: versionOf(record.id) },
        pinned: (how.pinned ?? []).map(id => ({ id, seen: versionOf(id) })),
        freshId: crypto.randomUUID(),
      })
      const sent =
        plan.pending === null
          ? line.request(plan.intent, plan.id)
          : tracked(plan.intent, [plan.pending], null)
      return sent.then(({ outcome }) => {
        // A canvas you start is in the sidebar.
        if (at.kind === "branch" && startsRoot(at, outcome))
          open.ensure(at.canvas)
        return outcome
      })
    },
    request: send,
    createCard(card, text, how = OFF_PAGE) {
      undo.gesture(() => {
        texts.text(card.id).text.insert(0, text)
      })
      // Made plain: its command is set by a request of its own, after it.
      const { command } = card.content
      const answer = sendMove(
        { card: card.id, from: null, to: placeKey(card.place) },
        how,
        null,
        {
          ...card,
          kind: "text",
          owner: me,
          placer: me,
          content: { ...card.content, command: null },
        },
        null,
      )
      if (command !== null)
        void send({ kind: "set-command", card: card.id, command })
      return answer
    },
    paste(pasted, how = OFF_PAGE) {
      const { paste, to, replacing, here } = pasted
      if (paste.kind === "text")
        undo.gesture(() => {
          texts.text(paste.card).text.insert(0, pasted.text)
        })
      const id = crypto.randomUUID()
      const main: Pending =
        paste.kind === "uncut"
          ? pendingMove(
              id,
              { card: paste.card, from: TRASH_PLACE, to },
              how,
              null,
            )
          : pendingMove(
              id,
              { card: paste.card, from: null, to },
              how,
              pastedDraft(paste, drawnPlace(to, me, readPlaces(places)), me),
            )
      const trash =
        replacing === null
          ? []
          : [
              pendingMove(
                id,
                { ...replacing, to: TRASH_PLACE },
                { actedAt: how.actedAt, slot: null },
                null,
              ),
            ]
      return tracked(
        { kind: "paste", paste, to, replacing, here },
        [main, ...trash],
        null,
      ).then(r => r.answer)
    },
    moveCard(move, how = OFF_PAGE, queuedBy = null, here = null) {
      return sendMove(move, how, queuedBy, null, here)
    },
    queueCard(planned, hold, how = OFF_PAGE, command = null) {
      const move = stampSeen(planned, versionOf(planned.card))
      const draft = queuedDraft(move, me, command)
      return tracked(
        {
          kind: "queue-card",
          move,
          hold,
          command: move.from === null ? command : null,
        },
        [pendingMove(crypto.randomUUID(), move, how, draft)],
        null,
      ).then(r => r.answer)
    },
    reorderCard(reorder, how = OFF_PAGE) {
      const pending: Pending = {
        id: crypto.randomUUID(),
        answer: { state: "sent" },
        slot: null,
        actedAt: how.actedAt,
        kind: "reorder",
        reorder,
      }
      return tracked({ kind: "reorder", reorder }, [pending], null).then(
        r => r.answer,
      )
    },
    moveCards(moves, actedAt, here = null) {
      const id = crypto.randomUUID()
      const pending = ({ move, slot }: SlotMove) =>
        pendingMove(id, move, { actedAt, slot }, null)
      const [first, ...rest] = moves
      return tracked(
        { kind: "move", moves: moves.map(m => m.move), here },
        [pending(first), ...rest.map(pending)],
        null,
      ).then(r => r.answer)
    },
    async undoMoves(canvas, direction) {
      const { outcome, rev } = await line.request({
        kind: "undo-move",
        canvas,
        direction,
      })
      // Drawn as the host left it: wait for this tab's copy to hold the undo.
      if (rev !== null) await whenRev(places, rev)
      return outcome
    },
    swapSlots(a, b) {
      const now = inventory.stored()
      swaps.gesture(() =>
        inventory.write(
          swapWrites(a, b, [now[String(b)] ?? null, now[String(a)] ?? null]),
        ),
      )
      step({ kind: "acted", at: AT_INVENTORY })
    },
    async undoSwap(direction) {
      const done =
        direction === "undo"
          ? await swaps.undo({ whole: true })
          : await swaps.redo({ whole: true })
      if (done.kind === "refused")
        step({
          kind: "refused",
          refusal: { card: null, actedAt: AT_INVENTORY, code: "slots-changed" },
        })
    },
    refuse(refusal) {
      step({ kind: "refused", refusal })
    },
    acted(at) {
      step({ kind: "acted", at })
    },
    proposed(lane, action, to = null) {
      // An acceptance names the proposed changes this tab shows now: its
      // record, as the strip drew it.
      const seen =
        action === "accept"
          ? proposedChangesSeen(readProposedByLane(session).get(lane))
          : null
      return sendActing(acting, { kind: "proposed", lane, action, to }, () =>
        send({ kind: "proposed", lane, action, to, seen }),
      )
    },
    actOnAccepted(action) {
      return sendActing(acting, { kind: "accepted", action }, () =>
        send({ kind: action }),
      )
    },
    restore(preview) {
      return sendActing(acting, { kind: "restore", of: preview.of }, () =>
        send({ kind: "restore", of: preview.of, seen: preview.from }),
      )
    },
    resolve(lane, path, choose) {
      return sendActing(acting, { kind: "resolve", lane, path }, () =>
        send({ kind: "resolve", lane, path, choose }),
      )
    },
    access(lane, answer) {
      return sendActing(acting, { kind: "access", lane, answer }, () =>
        send({ kind: "ssh-access", lane, answer }),
      )
    },
    acting: readable(acting),
    async close() {
      // Each part is let go of on its own, so one that throws stops no other,
      // as the host's own shutdown runs its steps; the exchange's shutdown,
      // last, rejects `close()` when it fails.
      for (const dispose of [
        unsubscribePlaces,
        unsubscribePeers,
        inventory.dispose,
        attention.dispose,
        open.dispose,
        unsubscribeSession,
        texts.dispose,
        () => undo.dispose(),
        () => swaps.dispose(),
        () => line.close("the client closed"),
        presence.dispose,
      ])
        try {
          dispose()
        } catch {}
      await exchange.shutdown()
    },
  }
}

/** Resolves once this copy of the places has reached `rev`. */
function whenRev(places: PlacesDocHandle, rev: number): Promise<void> {
  if (readPlacesRev(places) >= rev) return Promise.resolve()
  return new Promise<void>(resolve => {
    const stop = subscribe(places, () => {
      if (readPlacesRev(places) < rev) return
      stop()
      resolve()
    })
  })
}

/** `promise`, or a rejection with `message` after `ms`. */
function within<T>(
  ms: number,
  promise: Promise<T>,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, late]).finally(() => clearTimeout(timer))
}

/** The card a paste draws until the host answers: the host's make (`pastedCard`), at its target as drawn. */
const pastedDraft = (
  paste: Paste,
  drawn: CardPlace | undefined,
  me: WriterId,
): CardRecord | null =>
  paste.kind === "uncut" || drawn === undefined
    ? null
    : (pastedCard(paste, drawn, me) ?? null)
