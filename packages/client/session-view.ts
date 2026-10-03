// client/session-view — connect to a host and expose a renderable view.
//
// Runs unmodified in a browser AND in Node (the e2e check), because the only
// environment-specific value is the WebSocket constructor. No pi.
//
// `connectSession` connects, then wires its parts to each other: the roots
// held (`root-docs.ts`), the cards' texts (`card-texts.ts`), this tab's moves
// over the host's records (`localStep`), your inventory's slots
// (`inventory-slots.ts`), this seat's presence (`presence-seat.ts`), and the
// requests to the host (`host-line.ts`). Each part's decisions are pure
// functions: `planHold`, `localStep`, `repairStep`, `chatIntent`.

import {
  createUndoStack,
  Exchange,
  type Undone,
  whenPeer,
} from "@kyneta/exchange"
import type { UndoTarget } from "@kyneta/react"
import { type CommitOptions, subscribe } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"
import {
  type CardId,
  type CardRecord,
  type EntryId,
  type Intent,
  keyOf,
  type LaneName,
  type LineAction,
  type Move,
  type MoveDirection,
  moveOf,
  type OfferAction,
  type Position,
  type RootId,
  type WriterId,
  writerOfPrincipal,
} from "@pineta/core"
import { offerSeen } from "@pineta/marginalia"
import type { Outcome } from "@pineta/protocol/codec"
import { Control } from "@pineta/protocol/line"
import {
  HOST_PRINCIPAL,
  LIVE_DOC_ID,
  PLACES_DOC_ID,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import { inventoryDocId, writersPolicy } from "@pineta/protocol/writers"
import { readOffers, readPlaces, readPlacesRev } from "@pineta/reads"
import {
  asSessionDoc,
  cardDocId,
  cardIdOfDoc,
  LiveDoc,
  type LiveDocHandle,
  PlacesDoc,
  PRESENCE_DECAY,
  type PresenceDecay,
  type PresenceDocHandle,
  type RootDocHandle,
  type SessionDocHandle,
  StorageDoc,
  type TextDocHandle,
  textVersion,
} from "@pineta/schema"
import { type ActingState, NO_ACTING, sendActing } from "./acting.ts"
import {
  type ActedAt,
  AT_INVENTORY,
  answerOf,
  cardOfPending,
  IN_COLUMN,
  intentsOf,
  type LocalEvent,
  type LocalState,
  localStep,
  type MoveAnswer,
  type MoveHow,
  type MovesState,
  NO_MOVES,
  OFF_PAGE,
  type Pending,
  pendingOf,
  type Refusal,
  slotOnAccept,
  stampSeen,
} from "./card-moves.ts"
import { cardTexts } from "./card-texts.ts"
import { hostLine } from "./host-line.ts"
import { heldBy, type Slots, swapWrites } from "./inventory.ts"
import { inventorySlots } from "./inventory-slots.ts"
import { presenceSeat } from "./presence-seat.ts"
import { NO_ROOT, rootDocs } from "./root-docs.ts"
import { type ChatHow, chatIntent } from "./send.ts"
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
   * Who this client is: a person's email, the principal its Exchange names
   * (ADR-0037). Kyneta issues the seat.
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
  /** The session's records, the directory of roots among them (ADR-0063). */
  readonly session: SessionDocHandle
  /** What is streaming now (ADR-0063): which lanes run, and their streams. */
  readonly live: LiveDocHandle
  /**
   * The roots' documents this client holds (ADR-0063): those it was asked to
   * hold (`holdRoots`), and a root it has just started, until then.
   */
  readonly roots: Readable<ReadonlyMap<RootId, RootDocHandle>>
  /**
   * Hold exactly `roots`' documents, and a root this client just started:
   * opened if new, and every other let go (`destroy`), which leaves the
   * host's copy (S86).
   */
  holdRoots(roots: ReadonlySet<RootId>): void
  /** The root a held document has `entry` in, or undefined. */
  rootOf(entry: EntryId): RootId | undefined
  /**
   * Who is here (ADR-0024). Write it only through `setReading`,
   * `clearReading` and `setTyping`, which write under this seat's key.
   */
  readonly presence: PresenceDocHandle
  /**
   * Every card's record (ADR-0059): the host's, with this tab's moves the
   * copy does not yet hold drawn over them (`withPending`). The places
   * document itself is never exposed, and a write to it throws
   * (`writersPolicy`). Move a card only through `createCard` and `moveCard`,
   * and write its text through its editor.
   */
  readonly cards: Readable<readonly CardRecord[]>
  /**
   * This tab's undo stack, narrowed to one card: undo and redo take only the
   * steps that wrote its text, its creation among them (ADR-0052). The stack
   * itself is not exposed: its own `undo()` takes the tab's last step,
   * wherever that is. It is in memory, so it lasts until the tab reloads or
   * closes (ADR-0048). Each undo and redo says what it did (`Undone`).
   */
  undoFor(id: CardId): CardUndo
  /**
   * This window's column `columnKey` follows the thread ending at `end`,
   * in the root whose root entry is `root` (null: not yet known).
   */
  setReading(columnKey: string, end: string, root: string | null): void
  /** The column closed: its entry is deleted, not left to decay. */
  clearReading(columnKey: string): void
  /** This window is typing in the composer at `end`. Silence decays it. */
  setTyping(end: string): void
  /**
   * A human message. `at` is where the sender is reading, or the branch point
   * (only a `branch` starts at the root). It runs the agent only if the agent
   * is its addressee (`address`).
   */
  chat(text: string, at: Position, how?: ChatHow): Promise<Outcome>
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
  cardText(id: CardId): TextDocHandle
  /**
   * Create a card holding `text`: its text in one undo step, so undoing past
   * the first keystroke empties it, and a request that the host place it
   * (ADR-0059), then one for its command when it has one. Into your
   * inventory, `how.slot` is the slot it takes.
   */
  createCard(card: NewCard, text: string, how?: MoveHow): Promise<MoveAnswer>
  /**
   * Ask the host to move a card (ADR-0059), as the page planned it: a take,
   * a put, a queue, an unqueue, or a discard (`to` null). A move into a
   * queue is sent with its text's version as this client has it then (S96).
   * Into your inventory with `how.slot`, the slot is written once the host
   * accepts, before the answer is recorded, so the repair never sees the
   * card held without its slot. `queuedBy`, for an unqueue, is who queued
   * the card: if the host took it first, the refusal says it was sent, as
   * theirs. Resolves with the host's answer.
   */
  moveCard(
    move: Move,
    how?: MoveHow,
    queuedBy?: WriterId | null,
  ): Promise<MoveAnswer>
  /**
   * Hand several cards at once, as one move the host accepts or refuses
   * whole (a keep, ADR-0066), each with the slot it takes.
   */
  moveCards(
    moves: readonly { readonly move: Move; readonly slot: number | null }[],
    actedAt: ActedAt,
  ): Promise<MoveAnswer>
  /**
   * Undo or redo your newest move in `root`: the host's history of your
   * moves there, from any of your tabs (ADR-0066).
   */
  undoMoves(root: RootId, direction: MoveDirection): Promise<Outcome>
  /**
   * Swap two slots of your inventory, in one write, as one step of this
   * tab's swaps; no host is asked.
   */
  swapSlots(a: number, b: number): void
  /**
   * Undo or redo this tab's newest swap, whole or refused: refused, said at
   * the inventory, when the slots it wrote have changed since (S90).
   */
  undoSwap(direction: MoveDirection): Promise<void>
  /** Keep a refusal: one made before anything was sent, or an undo's. */
  refuse(refusal: Refusal): void
  /** This tab's moves: in flight and refused (`card-moves.ts`). */
  readonly moves: Readable<MovesState>
  /**
   * Your inventory's slots as your document holds them, repaired from the
   * host's record on every change (`repairStep`). Written only by your own
   * tabs: the repair, a take's answer, and `swapSlots`.
   */
  readonly slots: Readable<Slots>
  /**
   * Title the entry `entry`, or clear its title with null (ADR-0045), in
   * the held root that has it.
   */
  mark(entry: EntryId, title: string | null): Promise<Outcome>
  /**
   * An offer action on a lane's offer in your repo; a take names its
   * destination bookmark, null for the default, and the offer as this tab's
   * record shows it (`offerSeen`). Tracked in `acting`.
   */
  offer(
    lane: LaneName,
    action: OfferAction,
    to?: string | null,
  ): Promise<Outcome>
  /** Set up the integration line, or land your work on it (ADR-0060). Tracked in `acting`. */
  line(action: LineAction): Promise<Outcome>
  /** Your offer and line commands out now, or refused or failed (`acting.ts`). */
  readonly acting: Readable<ActingState>
  close(): Promise<void>
}

/**
 * What the host is asked for that is neither tracked nor needs a root found:
 * a chat and a move are tracked in `moves`, an undo of moves waits for this
 * tab's copy of the places, an offer action and a line action are tracked
 * in `acting`, and a mark needs its entry's root.
 */
export type HostRequest = Exclude<
  Intent,
  { kind: "chat" | "move" | "undo-move" | "mark" | "offer" | "line" }
>

/** A card to create: the session makes you its owner and placer. */
export type NewCard = Pick<CardRecord, "id" | "place" | "command" | "unsent">

/** One card's undo, as its box binds it, saying what each undo and redo did. */
export type CardUndo = Omit<UndoTarget, "undo" | "redo"> & {
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

  const session = asSessionDoc(exchange.get(SESSION_DOC_ID, StorageDoc))
  const live = exchange.get(LIVE_DOC_ID, LiveDoc)
  const roots = rootDocs(exchange)
  // Never written here: `cards` is how the page reads it (ADR-0059).
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
    intents: () => intentsOf(local.current().moves),
  })
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
  // own key: a text's undo never takes a swap (S90). The repair writes
  // outside it, so an undo refuses a swap whose slots it changed.
  const swaps = await createUndoStack({
    exchange,
    docId: `undo:${exchange.peerId}`,
    key: "slots",
    scope: id => id === inventoryDocId(me),
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
  })
  // A client does not reconnect: once the host has gone, nothing this tab
  // sent will be answered.
  const unsubscribePeers = exchange.peers.subscribe(() => {
    if (exchange.peers.current.has(host.peerId)) return
    step({ kind: "hostLeft" })
    line.settleAll("the host left before answering")
  })

  const send = (intent: Intent): Promise<Outcome> =>
    line.request(intent).then(r => r.outcome)

  /**
   * Send a request that moves cards: each drawn at once as one of `pending`,
   * which share its id, until this tab's copy holds what the host did, and
   * answered as the host answers it. `queuedBy`: who queued the card a
   * refusal is about, if it is queued. An accepted take writes its slot
   * before its answer is stepped.
   */
  function tracked(
    intent: Intent,
    pending: readonly Pending[],
    queuedBy: WriterId | null,
  ): Promise<{ readonly outcome: Outcome; readonly answer: MoveAnswer }> {
    const [first] = pending
    if (first === undefined) throw new Error("a move with no cards")
    step({ kind: "sent", pending })
    return line.request(intent, first.id).then(({ outcome, rev }) => {
      const answer = answerOf(outcome, rev, {
        card: cardOfPending(first),
        queuedBy,
        actedAt: first.actedAt,
      })
      for (const p of pending) {
        const take = slotOnAccept(p, answer)
        if (take !== null) inventory.take(take.card, take.slot)
      }
      step({ kind: "answered", id: first.id, answer })
      return { outcome, answer }
    })
  }

  /**
   * A move, tracked; with `draft`, a creation, drawn as that record. A move
   * into a queue carries its text's version as this client has it now: the
   * host takes the card only once it holds that much (S96).
   */
  function sendMove(
    planned: Move,
    how: MoveHow,
    queuedBy: WriterId | null,
    draft: CardRecord | null,
  ): Promise<MoveAnswer> {
    const move =
      planned.to?.kind === "queued"
        ? stampSeen(planned, textVersion(texts.text(planned.card)))
        : planned
    return tracked(
      { kind: "move", moves: [move] },
      [pendingOf(crypto.randomUUID(), move, how, draft)],
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
    moves,
    slots: inventory.slots,
    cardText: texts.text,
    undoFor(id) {
      const docs = [cardDocId(id)]
      return {
        typing: fn => undo.typing(fn),
        undo: options => undo.undo({ ...options, docs }),
        redo: options => undo.redo({ ...options, docs }),
      }
    },
    chat(text, at, how = {}) {
      const card =
        how.card === undefined
          ? undefined
          : cards.current().find(c => c.id === how.card)
      const root = roots.rootFor(at, how.root)
      if (root === undefined) return Promise.resolve(NO_ROOT)
      // Queued when the lane is busy, it waits for this much text (S96).
      const intent = chatIntent(
        text,
        at,
        how,
        root,
        card === undefined
          ? null
          : { id: card.id, seen: textVersion(texts.text(card.id)) },
      )
      // A chat's request id is stored as its message's `sendId`.
      const id = how.id ?? crypto.randomUUID()
      // A send takes its card out of the composer: drawn gone until the copy
      // holds what the host did with it, spent or queued.
      const sent =
        card === undefined
          ? line.request(intent, id)
          : tracked(
              intent,
              [
                pendingOf(
                  id,
                  moveOf(card, null),
                  IN_COLUMN(how.column ?? ""),
                  null,
                ),
              ],
              null,
            )
      return sent.then(r => r.outcome)
    },
    request: send,
    mark(entry, title) {
      const root = roots.rootOf(entry)
      if (root === undefined) return Promise.resolve(NO_ROOT)
      return send({ kind: "mark", root, entry, title })
    },
    createCard(card, text, how = OFF_PAGE) {
      undo.gesture(() => {
        texts.text(card.id).text.insert(0, text)
      })
      const answer = sendMove(
        { card: card.id, from: null, to: keyOf(card.place) },
        how,
        null,
        { ...card, owner: me, placer: me, command: null },
      )
      if (card.command !== null)
        void send({ kind: "set-command", card: card.id, command: card.command })
      return answer
    },
    moveCard(move, how = OFF_PAGE, queuedBy = null) {
      return sendMove(move, how, queuedBy, null)
    },
    moveCards(moves, actedAt) {
      const id = crypto.randomUUID()
      if (moves.length === 0)
        return Promise.resolve({ kind: "accepted", rev: places.rev() })
      return tracked(
        { kind: "move", moves: moves.map(m => m.move) },
        moves.map(({ move, slot }) =>
          pendingOf(id, move, { actedAt, slot }, null),
        ),
        null,
      ).then(r => r.answer)
    },
    async undoMoves(root, direction) {
      const { outcome, rev } = await line.request({
        kind: "undo-move",
        root,
        direction,
      })
      // Drawn as the host left it: wait for this tab's copy to hold the undo.
      if (rev !== null && readPlacesRev(places) < rev)
        await new Promise<void>(resolve => {
          const stop = subscribe(places, () => {
            if (readPlacesRev(places) < rev) return
            stop()
            resolve()
          })
        })
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
    offer(lane, action, to = null) {
      // A take names the offer this tab shows now: its record, as the strip
      // drew it (ADR-0065).
      const seen =
        action === "take" ? offerSeen(readOffers(session).get(lane)) : null
      return sendActing(acting, { kind: "offer", lane, action, to }, () =>
        send({ kind: "offer", lane, action, to, seen }),
      )
    },
    line(action) {
      return sendActing(acting, { kind: "line", action }, () =>
        send({ kind: "line", action }),
      )
    },
    acting: readable(acting),
    async close() {
      // Each is let go of on its own, so one that throws stops no other.
      for (const dispose of [
        unsubscribePlaces,
        unsubscribePeers,
        inventory.dispose,
        texts.dispose,
        () => undo.dispose(),
        () => swaps.dispose(),
        () => line.settleAll("the client closed before the host answered"),
        presence.dispose,
      ])
        try {
          dispose()
        } catch {}
      try {
        await exchange.shutdown()
      } catch {}
    },
  }
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
