// client/session-view — connect to a host and expose a renderable view.
//
// Runs unmodified in a browser AND in Node (the e2e check), because the only
// environment-specific value is the WebSocket constructor. No pi.

import { Exchange } from "@kyneta/exchange"
import { batch, subscribe } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"

import {
  type ChatMode,
  type Intent,
  type LaneName,
  type Position,
  parseMentions,
  type ReferenceTarget,
  type WriterId,
  writerId,
} from "@pineta/core"
import { decodeReply, encodeIntent, type Outcome } from "@pineta/protocol/codec"
import { Control } from "@pineta/protocol/line"
import {
  HOST_PEER_ID,
  PRESENCE_DOC_ID,
  type Reply,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import {
  PRESENCE_DECAY,
  type PresenceDecay,
  type PresenceDocHandle,
  presenceDoc,
  readingKey,
  SessionDoc,
  type SessionDocHandle,
} from "@pineta/schema"

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
  readonly peerId?: string
  /** Called on every change to the document; read it through `@pineta/reads`. */
  readonly onChange?: () => void
}

export interface SessionClient {
  readonly peerId: string
  /** Who this client is to the host: derived from the peer id, as the host does. */
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
  /** This window's column `columnKey` follows the thread ending at `end`. */
  setReading(columnKey: string, end: string): void
  /** The column closed: its entry is deleted, not left to decay. */
  clearReading(columnKey: string): void
  /** This window is typing in the composer at `end`. Silence decays it. */
  setTyping(end: string): void
  /** This window is editing `note`, or, with null, has stopped. */
  setEditing(note: string | null): void
  /**
   * A human message. `at` is where the sender is reading, or the branch point
   * (only a `branch` starts at the root). It runs the agent only if the agent
   * is its addressee (`address`).
   */
  chat(text: string, at: Position, how?: ChatHow): Promise<Outcome>
  /** Cite `to`, attached where you are reading (`at`). */
  cite(to: ReferenceTarget, at: Position): Promise<Outcome>
  setName(name: string): Promise<Outcome>
  /** End the running turn of the thread whose lane is `lane`. */
  stop(lane: LaneName): Promise<Outcome>
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
  /** The send's id, minted by a fresh column so it can find its message. */
  readonly id?: string
}

export async function connectSession(
  options: ConnectOptions,
): Promise<SessionClient> {
  const peerId =
    options.peerId ?? `client-${Math.random().toString(36).slice(2, 10)}`

  const transport = new WebsocketClientTransport({
    url:
      options.key === undefined
        ? options.url
        : `${options.url}?key=${encodeURIComponent(options.key)}`,
    WebSocket: options.WebSocket,
    reconnect: { enabled: false },
  })
  const exchange = new Exchange({ id: peerId, transports: [transport] })
  await transport.waitForStatus("ready", { timeoutMs: 10_000 })

  const doc = exchange.get(SESSION_DOC_ID, SessionDoc)
  const presence = exchange.get(
    PRESENCE_DOC_ID,
    presenceDoc(options.presenceDecay ?? PRESENCE_DECAY),
  )
  const me = writerId(peerId)
  const sender = Control.sender(exchange, HOST_PEER_ID)
  const receiver = Control.claimReceiver(exchange, HOST_PEER_ID)

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
    peerId,
    writer: me,
    presence,
    setReading(columnKey, end) {
      batch(presence, d => d.reading.set(readingKey(me, columnKey), end))
    },
    clearReading(columnKey) {
      const key = readingKey(me, columnKey)
      if (presence.reading()[key] !== undefined)
        batch(presence, d => d.reading.delete(key))
    },
    setTyping(end) {
      batch(presence, d => d.typing.set(me, end))
    },
    setEditing(note) {
      batch(presence, d => d.editing.set(me, note))
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
        },
        how.id,
      )
    },
    cite(to, at) {
      return send({ kind: "reference", to, at })
    },
    setName(name) {
      return send({ kind: "name", name })
    },
    stop(lane) {
      return send({ kind: "stop", lane })
    },
    replies,
    async close() {
      try {
        unsubscribe?.()
      } catch {}
      try {
        await exchange.shutdown()
      } catch {}
    },
  }
}
