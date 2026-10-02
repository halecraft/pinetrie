// client/session-view — connect to a host and expose a renderable view.
//
// Runs unmodified in a browser AND in Node (the e2e check), because the only
// environment-specific value is the WebSocket constructor. No pi.

import { createUndoStack, Exchange, sync, whenPeer } from "@kyneta/exchange"
import type { UndoTarget } from "@kyneta/react"
import { batch, subscribe } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"

import {
  type ArchiveAction,
  type CardId,
  type CardRecord,
  type ChatMode,
  type EntryId,
  type Intent,
  type LaneName,
  type OfferAction,
  type Position,
  parseMentions,
  type WorkSetting,
  type WriterId,
  writerOfPrincipal,
} from "@pineta/core"
import { encodeCard } from "@pineta/marginalia"
import { decodeReply, encodeIntent, type Outcome } from "@pineta/protocol/codec"
import { Control } from "@pineta/protocol/line"
import {
  CARDS_DOC_ID,
  HOST_PRINCIPAL,
  PRESENCE_DOC_ID,
  type Reply,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import {
  CardsDoc,
  type CardsDocHandle,
  cardDocId,
  cardIdOfDoc,
  PRESENCE_DECAY,
  type PresenceDecay,
  type PresenceDocHandle,
  presenceDoc,
  readingKey,
  SessionDoc,
  type SessionDocHandle,
  seatKey,
  TextDoc,
  type TextDocHandle,
} from "@pineta/schema"
import { hostLetGo, spentCards } from "./card-state.ts"

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
  readonly doc: SessionDocHandle
  /** Who is here (ADR-0024). Write only through the methods below. */
  readonly presence: PresenceDocHandle
  /**
   * Every card's record (ADR-0048). Read it through `readCards`; write a
   * card only through `createCard` and `discardCard`, and its text through
   * its editor.
   */
  readonly cards: CardsDocHandle
  /**
   * This tab's undo stack, narrowed to one card: undo and redo take only the
   * steps that wrote its text, its creation among them (ADR-0052). The stack
   * itself is not exposed: its own `undo()` takes the tab's last step,
   * wherever that is. It is in memory, so it lasts until the tab reloads or
   * closes (ADR-0048).
   */
  undoFor(id: CardId): UndoTarget
  /** This window's column `columnKey` follows the thread ending at `end`. */
  setReading(columnKey: string, end: string): void
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
   * Create a card holding `text`: its record and its text in one undo step,
   * so undoing past the first keystroke removes it again.
   */
  createCard(card: CardRecord, text: string): void
  /**
   * Delete a card's record, outside the undo stack: a fresh column's card
   * discarded with its column, which nothing could show again.
   */
  discardCard(id: CardId): void
  /** Hide the root `root` for everyone, or bring it back (ADR-0029). */
  archive(action: ArchiveAction, root: EntryId): Promise<Outcome>
  /** Title the entry `entry`, or clear its title with null (ADR-0045). */
  mark(entry: EntryId, title: string | null): Promise<Outcome>
  /**
   * Merge your work into a lane (ADR-0038): `updated`, with the composer's
   * prefill, when clean; `started`, the resolution run, when it conflicts.
   */
  update(lane: LaneName): Promise<Outcome>
  /** Act on a lane's offer in your repo: take it, split it, and so on. */
  offer(lane: LaneName, action: OfferAction): Promise<Outcome>
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
  /** The lane id the column reserved: what a lane this send creates is called (ADR-0057). */
  readonly reserved?: LaneName
}

/** What every send from one column carries, whichever card it is sent from. */
export type ColumnHow = Pick<ChatHow, "lane" | "reserved"> & {
  readonly asksAgent: boolean
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
  await transport.waitForStatus("ready", { timeoutMs: 10_000 })
  // Kyneta issues the host's seat, so it is found by its principal.
  const host = await within(
    10_000,
    whenPeer(exchange, p => p.principal === HOST_PRINCIPAL),
    "the host did not introduce itself",
  )

  const doc = exchange.get(SESSION_DOC_ID, SessionDoc)
  const cards = exchange.get(CARDS_DOC_ID, CardsDoc)
  // Each card document this client opens is watched until the host destroys
  // it, and then this client's copy is destroyed too, so no step on it stands
  // and a redo in an emptied box cannot write into it (S64). The host's
  // `dismiss` leaves a receiver's copy in place.
  const watched = new Map<CardId, () => void>()
  const letGo = new Set<CardId>()
  const dropSpent = () => {
    for (const id of spentCards(letGo, c => cards.cards.has(c))) {
      letGo.delete(id)
      void exchange.destroy(cardDocId(id))
    }
  }
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
    scope: id => id === CARDS_DOC_ID || cardIdOfDoc(id) !== undefined,
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

  const unsubscribe = subscribe(doc, () => options.onChange?.())
  const unsubscribeCards = subscribe(cards, () => {
    dropSpent()
    options.onChange?.()
  })

  /**
   * Encode an intent, send it, and resolve with the decoded outcome. The id is
   * a UUID, because a chat's id is its send id, stored with the message.
   */
  function send(
    intent: Intent,
    id: string = crypto.randomUUID(),
  ): Promise<Outcome> {
    const settled = new Promise<Reply>(resolve => replyWaiters.set(id, resolve))
    sender.send(encodeIntent(id, intent))
    return settled.then(decodeReply)
  }

  return {
    principal,
    writer: me,
    presence,
    cards,
    undoFor(id) {
      const docs = [cardDocId(id)]
      return {
        typing: fn => undo.typing(fn),
        undo: options => undo.undo({ ...options, docs }),
        redo: options => undo.redo({ ...options, docs }),
      }
    },
    setReading(columnKey, end) {
      batch(presence, d => d.reading.set(readingKey(mine, columnKey), end))
    },
    clearReading(columnKey) {
      const key = readingKey(mine, columnKey)
      if (presence.reading()[key] !== undefined)
        batch(presence, d => d.reading.delete(key))
    },
    setTyping(end) {
      batch(presence, d => d.typing.set(mine, end))
    },
    exchange,
    doc,
    chat(text, at, how = {}) {
      return send(
        {
          kind: "chat",
          text,
          at,
          mode: how.mode ?? "reply",
          lane: how.lane ?? null,
          asksAgent: how.asksAgent === true,
          mentions: parseMentions(text),
          work: how.work ?? null,
          card: how.card ?? null,
          reserved: how.reserved ?? null,
        },
        how.id,
      )
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
    createCard(card, text) {
      undo.gesture(() => {
        cards.cards.set(card.id, encodeCard(card))
        cardText(card.id).text.insert(0, text)
      })
    },
    discardCard(id) {
      cards.cards.delete(id)
    },
    update(lane) {
      return send({ kind: "update", lane })
    },
    offer(lane, action) {
      return send({ kind: "offer", lane, action })
    },
    archive(action, root) {
      return send({ kind: "archive", action, root })
    },
    mark(entry, title) {
      return send({ kind: "mark", entry, title })
    },
    replies,
    async close() {
      try {
        unsubscribe?.()
        unsubscribeCards?.()
        for (const stop of watched.values()) stop()
        watched.clear()
        undo.dispose()
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
