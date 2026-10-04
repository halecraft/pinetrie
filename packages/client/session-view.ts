// client/session-view — connect to a host and expose a renderable view.
//
// Runs unmodified in a browser AND in Node (the e2e check), because the only
// environment-specific value is the WebSocket constructor. No pi.

import {
  createUndoStack,
  Exchange,
  sync,
  type Undone,
  whenPeer,
} from "@kyneta/exchange"
import type { UndoTarget } from "@kyneta/react"
import { batch, type CommitOptions, subscribe } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"
import {
  type ArchiveAction,
  type CardCommand,
  type CardId,
  type CardRecord,
  type ChatMode,
  type EntryId,
  ERR,
  type Intent,
  keyOf,
  type LaneName,
  type LineAction,
  type Move,
  type MoveDirection,
  type OfferAction,
  type Position,
  parseMentions,
  type RootId,
  rootDocId,
  rootIdFor,
  rootOfDocId,
  type WorkSetting,
  type WriterId,
  writerOfPrincipal,
} from "@pineta/core"
import { offerSeen } from "@pineta/marginalia"
import {
  decodeReply,
  encodeIntent,
  type Outcome,
  revOfReply,
} from "@pineta/protocol/codec"
import { Control } from "@pineta/protocol/line"
import {
  HOST_PRINCIPAL,
  LIVE_DOC_ID,
  PLACES_DOC_ID,
  PRESENCE_DOC_ID,
  type Reply,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import { inventoryDocId, writersPolicy } from "@pineta/protocol/writers"
import {
  readLaneRecords,
  readOffers,
  readPlaces,
  readPlacesRev,
} from "@pineta/reads"
import {
  asRootDoc,
  asSessionDoc,
  cardDocId,
  cardIdOfDoc,
  InventoryDoc,
  LiveDoc,
  type LiveDocHandle,
  PlacesDoc,
  PRESENCE_DECAY,
  type PresenceDecay,
  type PresenceDocHandle,
  presenceDoc,
  type RootDocHandle,
  readingKey,
  readSlots,
  type SessionDocHandle,
  StorageDoc,
  seatKey,
  TextDoc,
  type TextDocHandle,
  textVersion,
} from "@pineta/schema"
import { type ActingState, NO_ACTING, sendActing } from "./acting.ts"
import {
  type ActedAt,
  AT_INVENTORY,
  answerOf,
  intentsOf,
  type MoveAnswer,
  type MoveHow,
  type MovesEvent,
  type MovesState,
  movesStep,
  NO_MOVES,
  OFF_PAGE,
  type Pending,
  type Refusal,
  withPending,
} from "./card-moves.ts"
import { hostLetGo, spentCards } from "./card-state.ts"
import { newRootId } from "./ids.ts"
import {
  type HeldSince,
  heldBy,
  planSlots,
  type Slots,
  steadiness,
  takeWrites,
} from "./inventory.ts"
import { type SnapshotStore, snapshotStore } from "./store.ts"

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
  /** Called on every change to the document; read it through `@pineta/reads`. */
  readonly onChange?: () => void
}

/** A value to read, and a way to hear it change: `useSyncExternalStore`'s shape. */
export type Readable<T> = Pick<SnapshotStore<T>, "current" | "subscribe">

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
  /** Who is here (ADR-0024). Write only through the methods below. */
  readonly presence: PresenceDocHandle
  /**
   * Every card's record (ADR-0059): the host's, with this tab's moves the
   * copy does not yet hold drawn over them (`withPending`). The places
   * document itself is never exposed, and a write to it throws
   * (`writersPolicy`). Move a card
   * only through the methods below, and write its text through its editor.
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
  setName(name: string): Promise<Outcome>
  /** End the running turn of the thread whose lane is `lane`. */
  stop(lane: LaneName): Promise<Outcome>
  /** Have the host name the thread a column's reserved lane will be (ADR-0057). */
  reserve(lane: LaneName): Promise<Outcome>
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
  createCard(card: CardRecord, text: string, how?: MoveHow): Promise<MoveAnswer>
  /**
   * Ask the host to remove a card, outside the undo stack: a fresh column's
   * card discarded with its column, which nothing could show again, or one
   * in your inventory.
   */
  discardCard(id: CardId, how?: MoveHow): void
  /**
   * Ask the host to queue a card on `lane`, from `at`: after the lane's
   * last queued card, queued by you. A card's box undoes only its text
   * (ADR-0052); the move is undone from the page, by the host (ADR-0066).
   */
  queueCard(
    id: CardId,
    where: { readonly lane: LaneName; readonly at: Position },
    how?: MoveHow,
  ): void
  /**
   * Ask the host to take a queued card back below the line, where it was
   * queued. If the host took it first, the refusal says it was sent.
   */
  unqueueCard(
    id: CardId,
    queued: { readonly lane: LaneName; readonly by: WriterId },
    how?: MoveHow,
  ): void
  /**
   * Hand a card from one place to another (ADR-0059): a take or a put. Into
   * your inventory with `how.slot`, the slot is written once the host
   * accepts, before the answer is recorded, so the repair never sees the card
   * held without its slot. Resolves with the host's answer.
   */
  moveCard(move: Move, how: MoveHow): Promise<MoveAnswer>
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
  /** Ask the host to set a card's command, or clear it with null (ADR-0055). */
  setCommand(id: CardId, command: CardCommand | null): void
  /**
   * What you did that was refused (ADR-0059), each until your next move
   * where you acted.
   */
  readonly refusals: Readable<readonly Refusal[]>
  /** This tab's moves: in flight and refused (`card-moves.ts`). */
  readonly moves: Readable<MovesState>
  /**
   * Your inventory's slots as your document holds them, repaired from the
   * host's record on every change (`planSlots`). Written only by this
   * client's methods.
   */
  readonly slots: Readable<Slots>
  /** Hide the root `root` for everyone, or bring it back (ADR-0029). */
  archive(action: ArchiveAction, root: EntryId): Promise<Outcome>
  /** Title the entry `entry`, or clear its title with null (ADR-0045). */
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
  /** Every reply as it arrived on the wire, for wire-level checks. */
  readonly replies: readonly Reply[]
  close(): Promise<void>
}

/** How a chat is sent: its mode, its column's lane, and its send id. */
export interface ChatHow {
  readonly mode?: ChatMode
  /** The lane the sender's column is bound to. */
  readonly lane?: LaneName
  /** A Start Agent column. */
  readonly asksAgent?: boolean
  /** Where a lane this send creates works; absent, the lane above's setting (ADR-0032). */
  readonly work?: WorkSetting
  /** The send's id, minted by a fresh column so it can find its message. */
  readonly id?: string
  /** The card the text is sent from, which the host spends once it is sent. */
  readonly card?: CardId
  /** The column it is sent from, where a refusal of its card's move is said. */
  readonly column?: string
  /** The lane id the column reserved: what a lane this send creates is called (ADR-0057). */
  readonly reserved?: LaneName
  /** The root a new tab minted as it opened: where its first send starts (ADR-0066). */
  readonly root?: RootId
  /** The WIP bookmark a lane this send creates starts from; absent, the line (ADR-0060). */
  readonly base?: string
}

/** One card's undo, as its box binds it, saying what each undo and redo did. */
export type CardUndo = Omit<UndoTarget, "undo" | "redo"> & {
  undo(options?: CommitOptions): Promise<Undone>
  redo(options?: CommitOptions): Promise<Undone>
}

/** What every send from one column carries, whichever card it is sent from. */
export type ColumnHow = Pick<ChatHow, "lane" | "reserved" | "base" | "root"> & {
  readonly asksAgent: boolean
  readonly column: string
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
  // The roots' documents this tab holds: only those, since Kyneta takes in
  // every announced document whose schema a client knows, and every root's
  // is the session's (S86). `minted` holds a root this client just started
  // until the page asks for it.
  const asked = new Set<RootId>()
  const minted = new Set<RootId>()
  const roots = snapshotStore<ReadonlyMap<RootId, RootDocHandle>>(new Map())
  // What `hold` is about to hold. Kyneta asks `canShare` as `get` opens a
  // document, to announce it and ask the host for it: a root not yet wanted
  // then is never asked for (S86).
  let wanted: ReadonlySet<RootId> = new Set()
  exchange.register({
    name: "pineta.roots",
    canShare: (docId: string) => {
      const root = rootOfDocId(docId)
      return root === undefined ? undefined : wanted.has(root)
    },
  })
  /** A queue's root: its lane's (`LANE`), else its entry's. */
  const rootOfQueue = (lane: LaneName, at: Position): RootId =>
    readLaneRecords(session).get(lane)?.root ??
    (at.kind === "entry" ? rootOfEntry(at.id) : undefined) ??
    rootIdFor("")
  /** Open what `asked` and `minted` name, and let go of the rest. */
  const hold = () => {
    for (const root of minted) if (asked.has(root)) minted.delete(root)
    const want = new Set([...asked, ...minted])
    const now = roots.current()
    if (want.size === now.size && [...want].every(r => now.has(r))) return
    wanted = want
    const next = new Map<RootId, RootDocHandle>()
    for (const root of want)
      next.set(
        root,
        now.get(root) ?? asRootDoc(exchange.get(rootDocId(root), StorageDoc)),
      )
    roots.set(next)
    for (const root of now.keys())
      if (!want.has(root)) void exchange.destroy(rootDocId(root))
  }
  /**
   * Where `at` is: a held root's entry, or a root this client starts now:
   * the one its new tab minted as it opened (`minted`), or, for a send at
   * the root that names none (a script's), one minted here.
   */
  const spotRoot = (
    at: Position,
    minting: RootId | undefined,
  ): RootId | undefined => {
    if (at.kind === "root") {
      const root = minting ?? newRootId()
      minted.add(root)
      hold()
      return root
    }
    return rootOfEntry(at.id)
  }
  const rootOfEntry = (entry: EntryId): RootId | undefined => {
    for (const [root, doc] of roots.current())
      if (doc.entries.get(entry) !== undefined) return root
    return undefined
  }
  // Never written here: `cards` is how the page reads it (ADR-0059).
  const places = exchange.get(PLACES_DOC_ID, PlacesDoc)
  // Each card document this client opens is watched until the host destroys
  // it, and then this client's copy is destroyed too, so no step on it stands
  // and no undo or redo in its box can write into it (S64). The host's
  // `dismiss` leaves a receiver's copy in place.
  const watched = new Map<CardId, () => void>()
  const letGo = new Set<CardId>()
  const dropSpent = () => {
    const held = places.cards()
    for (const id of spentCards(letGo, c => held[c] !== undefined)) {
      letGo.delete(id)
      void exchange.destroy(cardDocId(id))
    }
  }
  // The moves this tab sent, and the cards as the page reads them: the
  // host's records with those moves drawn over them (card-moves.ts).
  let records = readPlaces(places)
  const moves = snapshotStore(NO_MOVES)
  const acting = snapshotStore<ActingState>(NO_ACTING)
  const cards = snapshotStore(withPending(records, NO_MOVES, me))
  const redraw = () => cards.set(withPending(records, moves.current(), me))
  // Your inventory's slots (ADR-0059): written by this person's tabs only,
  // repaired from the host's record on every change, and only once the
  // host's copy has reached this one. Repaired before then, an empty copy
  // would fill slots that the stored layout already names, and the merge
  // would move cards.
  const inventory = exchange.get(inventoryDocId(me), InventoryDoc)
  const slots = snapshotStore<Slots>(readSlots(inventory))
  const inventoryReady = () =>
    sync(inventory).readyFor(p => p.peerId === host.peerId)
  /** Write `writes` to the slots in one batch; nothing for none. */
  const writeSlots = (writes: {
    readonly set: Readonly<Record<string, CardId>>
    readonly clear: readonly string[]
  }) => {
    if (Object.keys(writes.set).length === 0 && writes.clear.length === 0)
      return
    batch(inventory, d => {
      for (const slot of writes.clear) d.slots.delete(slot)
      for (const [slot, card] of Object.entries(writes.set))
        d.slots.set(slot, card)
    })
  }
  // The host's records, not the drawn ones: a put in flight keeps its slot
  // until the host accepts it, so a refused put finds it there. A card is
  // acted on only once steady (`steadiness`): this tab looks again then.
  let heldSince: HeldSince = new Map()
  let wake: ReturnType<typeof setTimeout> | null = null
  const repair = () => {
    if (!inventoryReady()) return
    const held = heldBy(records, me).map(c => c.id)
    const stored = readSlots(inventory)
    const now = steadiness(heldSince, held, stored, Date.now())
    heldSince = now.memory
    if (wake !== null) clearTimeout(wake)
    wake =
      now.wake === null
        ? null
        : setTimeout(repair, Math.max(0, now.wake - Date.now()))
    writeSlots(planSlots(held, stored, intentsOf(moves.current()), now.steady))
  }
  const dispatch = (event: MovesEvent) => {
    moves.set(movesStep(moves.current(), event))
    redraw()
    repair()
  }
  /** A card as the page reads it now. */
  const cardNow = (id: CardId): CardRecord | undefined =>
    cards.current().find(c => c.id === id)
  const hostIn = (states: readonly { peer: { peerId: string } }[]) =>
    states.some(s => s.peer.peerId === host.peerId)
  const cardText = (id: CardId): TextDocHandle => {
    const text = exchange.get(cardDocId(id), TextDoc)
    if (watched.has(id)) return text
    let hadHost = hostIn(sync(text).peerStates)
    const stop = sync(text).onPeerSyncChange(states => {
      const hasHost = hostIn(states)
      const gone = hostLetGo({
        hadHost,
        hasHost,
        hostConnected: exchange.peers.current.has(host.peerId),
      })
      hadHost = hasHost
      if (!gone) return
      stop()
      watched.delete(id)
      letGo.add(id)
      dropSpent()
    })
    watched.set(id, stop)
    return text
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
  const presence = exchange.get(
    PRESENCE_DOC_ID,
    presenceDoc(options.presenceDecay ?? PRESENCE_DECAY),
  )
  // This seat's presence key: a person may be here from several (ADR-0037).
  const mine = seatKey(me, exchange.peerId)
  const sender = Control.sender(exchange, host.peerId)
  const receiver = Control.claimReceiver(exchange, host.peerId)

  const replies: Reply[] = []
  const replyWaiters = new Map<string, (reply: Reply) => void>()
  void (async () => {
    for await (const r of receiver) {
      replies.push(r)
      replyWaiters.get(r.id)?.(r)
      replyWaiters.delete(r.id)
    }
  })()

  const unsubscribe = subscribe(session, () => options.onChange?.())
  const unsubscribePlaces = subscribe(places, () => {
    records = readPlaces(places)
    dispatch({ kind: "changed", rev: readPlacesRev(places) })
    dropSpent()
    options.onChange?.()
  })
  const unsubscribeInventory = subscribe(inventory, () => {
    slots.set(readSlots(inventory))
    repair()
  })
  const unsubscribeInventorySync = sync(inventory).onPeerSyncChange(repair)
  repair()
  // A client does not reconnect: once the host has gone, no move of this
  // tab's will be answered.
  const unsubscribePeers = exchange.peers.subscribe(() => {
    if (!exchange.peers.current.has(host.peerId)) dispatch({ kind: "hostLeft" })
  })

  /**
   * Encode an intent, send it, and resolve with the decoded outcome and the
   * places document's `rev` the reply carries. The id is a UUID, because a
   * chat's id is its send id, stored with the message.
   */
  function request(
    intent: Intent,
    id: string = crypto.randomUUID(),
  ): Promise<{ readonly outcome: Outcome; readonly rev: number | null }> {
    const settled = new Promise<Reply>(resolve => replyWaiters.set(id, resolve))
    sender.send(encodeIntent(id, intent))
    return settled.then(reply => ({
      outcome: decodeReply(reply),
      rev: revOfReply(reply),
    }))
  }
  const send = (intent: Intent, id?: string): Promise<Outcome> =>
    request(intent, id).then(r => r.outcome)

  /**
   * Send a request that moves cards: each drawn at once as one of `pending`,
   * which share its id, until this tab's copy holds what the host did, and
   * answered as the host answers it. `card`: the card a refusal is about;
   * `queuedBy`: who queued it, when it was queued. An accepted move into
   * your inventory with a slot writes that slot first.
   */
  function tracked(
    intent: Intent,
    pending: readonly Pending[],
    how: { readonly card: CardId; readonly queuedBy: WriterId | null },
  ): Promise<{
    readonly outcome: Outcome
    readonly rev: number | null
    readonly answer: MoveAnswer
  }> {
    const [first] = pending
    if (first === undefined) throw new Error("a move with no cards")
    dispatch({ kind: "sent", pending })
    return request(intent, first.id).then(({ outcome, rev }) => {
      const answer = answerOf(outcome, rev, {
        ...how,
        actedAt: first.actedAt,
      })
      for (const p of pending) {
        const into = p.kind === "create" ? p.draft.place : p.move.to
        const card = p.kind === "create" ? p.draft.id : p.move.card
        if (
          answer.kind === "accepted" &&
          into?.kind === "inventory" &&
          p.slot !== null
        )
          writeSlots(takeWrites(readSlots(inventory), card, p.slot))
      }
      dispatch({ kind: "answered", id: first.id, answer })
      return { outcome, rev, answer }
    })
  }

  /** A move, tracked; with `draft`, a creation, drawn as that record. */
  function sendMove(
    move: Move,
    how: MoveHow & {
      readonly queuedBy: WriterId | null
      readonly draft: CardRecord | null
    },
  ): Promise<MoveAnswer> {
    const sent = {
      id: crypto.randomUUID(),
      answer: { state: "sent" },
      slot: how.slot,
      actedAt: how.actedAt,
    } as const
    return tracked(
      { kind: "move", moves: [move] },
      [
        how.draft === null
          ? { ...sent, kind: "move", move }
          : { ...sent, kind: "create", draft: how.draft },
      ],
      { card: move.card, queuedBy: how.queuedBy },
    ).then(r => r.answer)
  }

  return {
    principal,
    writer: me,
    presence,
    cards: { current: cards.current, subscribe: cards.subscribe },
    undoFor(id) {
      const docs = [cardDocId(id)]
      return {
        typing: fn => undo.typing(fn),
        undo: options => undo.undo({ ...options, docs }),
        redo: options => undo.redo({ ...options, docs }),
      }
    },
    setReading(columnKey, end, root) {
      const key = readingKey(mine, columnKey)
      batch(presence, d => {
        d.reading.set(key, end)
        d.readingRoot.set(key, root)
      })
    },
    clearReading(columnKey) {
      const key = readingKey(mine, columnKey)
      if (presence.reading()[key] !== undefined)
        batch(presence, d => {
          d.reading.delete(key)
          d.readingRoot.delete(key)
        })
    },
    setTyping(end) {
      batch(presence, d => d.typing.set(mine, end))
    },
    exchange,
    session,
    live,
    roots: { current: roots.current, subscribe: roots.subscribe },
    holdRoots(want) {
      asked.clear()
      for (const root of want) asked.add(root)
      hold()
    },
    rootOf: rootOfEntry,
    chat(text, at, how = {}) {
      const id = how.id ?? crypto.randomUUID()
      const card = how.card === undefined ? undefined : cardNow(how.card)
      const root = spotRoot(at, how.root)
      if (root === undefined)
        return Promise.resolve({
          kind: "refused",
          code: ERR.UNKNOWN_TARGET,
          message: "that message is in no root this tab holds",
        })
      const intent: Intent = {
        kind: "chat",
        text,
        root,
        at,
        mode: how.mode ?? "reply",
        lane: how.lane ?? null,
        asksAgent: how.asksAgent === true,
        mentions: parseMentions(text),
        work: how.work ?? null,
        // Queued when the lane is busy, it waits for this much text (S96).
        card:
          card === undefined
            ? null
            : { id: card.id, seen: textVersion(cardText(card.id)) },
        reserved: how.reserved ?? null,
        base: how.base ?? null,
      }
      // A send takes its card out of the composer: drawn gone until the copy
      // holds what the host did with it, spent or queued.
      const sent =
        card === undefined
          ? request(intent, id)
          : tracked(
              intent,
              [
                {
                  id,
                  kind: "move",
                  move: { card: card.id, from: keyOf(card.place), to: null },
                  answer: { state: "sent" },
                  slot: null,
                  actedAt: { kind: "column", key: how.column ?? "" },
                },
              ],
              { card: card.id, queuedBy: null },
            )
      return sent.then(r => r.outcome)
    },
    setName(name) {
      return send({ kind: "name", name })
    },
    stop(lane) {
      return send({ kind: "stop", lane })
    },
    reserve(lane) {
      return send({ kind: "reserve", lane })
    },
    cardText,
    createCard(card, text, how = OFF_PAGE) {
      const draft: CardRecord = { ...card, owner: me, placer: me }
      undo.gesture(() => {
        cardText(card.id).text.insert(0, text)
      })
      const answer = sendMove(
        { card: card.id, from: null, to: keyOf(card.place) },
        { ...how, queuedBy: null, draft: { ...draft, command: null } },
      )
      if (card.command !== null)
        void send({ kind: "set-command", card: card.id, command: card.command })
      return answer
    },
    discardCard(id, how = OFF_PAGE) {
      const card = cardNow(id)
      if (card === undefined) return
      void sendMove(
        { card: id, from: keyOf(card.place), to: null },
        { ...how, queuedBy: null, draft: null },
      )
    },
    moveCard(move, how) {
      return sendMove(move, { ...how, queuedBy: null, draft: null })
    },
    moveCards(moves, actedAt) {
      const [first] = moves
      if (first === undefined)
        return Promise.resolve({ kind: "accepted", rev: places.rev() })
      const id = crypto.randomUUID()
      return tracked(
        { kind: "move", moves: moves.map(m => m.move) },
        moves.map(({ move, slot }) => ({
          id,
          answer: { state: "sent" },
          slot,
          actedAt,
          kind: "move",
          move,
        })),
        { card: first.move.card, queuedBy: null },
      ).then(r => r.answer)
    },
    async undoMoves(root, direction) {
      const { outcome, rev } = await request({
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
      const now = readSlots(inventory)
      const [atA, atB] = [now[String(a)], now[String(b)]]
      const set: Record<string, CardId> = {}
      const clear: string[] = []
      if (atB === undefined) clear.push(String(a))
      else set[String(a)] = atB
      if (atA === undefined) clear.push(String(b))
      else set[String(b)] = atA
      swaps.gesture(() => writeSlots({ set, clear }))
      dispatch({ kind: "acted", at: AT_INVENTORY })
    },
    async undoSwap(direction) {
      const done =
        direction === "undo"
          ? await swaps.undo({ whole: true })
          : await swaps.redo({ whole: true })
      if (done.kind === "refused")
        dispatch({
          kind: "refused",
          refusal: { card: null, actedAt: AT_INVENTORY, code: "slots-changed" },
        })
    },
    refuse(refusal) {
      dispatch({ kind: "refused", refusal })
    },
    queueCard(id, { lane, at }, how = OFF_PAGE) {
      const card = cardNow(id)
      if (card === undefined) return
      // The text as this client has it: the host waits for that much (S96).
      const seen = textVersion(cardText(id))
      void sendMove(
        {
          card: id,
          from: keyOf(card.place),
          to: { kind: "queued", root: rootOfQueue(lane, at), at, lane, seen },
        },
        { ...how, queuedBy: null, draft: null },
      )
    },
    unqueueCard(id, queued, how = OFF_PAGE) {
      const card = cardNow(id)
      if (card === undefined || card.place.kind !== "queued") return
      void sendMove(
        {
          card: id,
          from: keyOf(card.place),
          to: {
            kind: "drafting",
            root: card.place.root,
            at: card.place.at,
            lane: card.place.lane,
          },
        },
        { ...how, queuedBy: queued.by, draft: null },
      )
    },
    setCommand(id, command) {
      void send({ kind: "set-command", card: id, command })
    },
    refusals: {
      current: () => moves.current().refusals,
      subscribe: moves.subscribe,
    },
    moves: { current: moves.current, subscribe: moves.subscribe },
    slots: { current: slots.current, subscribe: slots.subscribe },
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
    acting: { current: acting.current, subscribe: acting.subscribe },
    archive(action, root) {
      return send({ kind: "archive", action, root })
    },
    mark(entry, title) {
      const root = rootOfEntry(entry)
      if (root === undefined)
        return Promise.resolve({
          kind: "refused",
          code: ERR.UNKNOWN_TARGET,
          message: "that message is in no root this tab holds",
        })
      return send({ kind: "mark", root, entry, title })
    },
    replies,
    async close() {
      try {
        unsubscribe?.()
        unsubscribePlaces?.()
        unsubscribeInventory()
        unsubscribeInventorySync()
        if (wake !== null) clearTimeout(wake)
        unsubscribePeers()
        for (const stop of watched.values()) stop()
        watched.clear()
        undo.dispose()
        swaps.dispose()
      } catch {}
      // This seat's typing goes with it; another seat of the same person
      // keeps its own.
      try {
        if (presence.typing()[mine] !== undefined)
          batch(presence, d => d.typing.delete(mine))
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
