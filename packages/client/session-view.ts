// client/session-view — connect to a host and expose a renderable view.
//
// Runs unmodified in a browser AND in Node (the e2e check), because the only
// environment-specific value is the WebSocket constructor. No pi.

import { Exchange } from "@kyneta/exchange"
import { subscribe } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"

import {
  type ChatMode,
  type EntryId,
  type Intent,
  NOBODY,
  type Position,
  parseMentions,
  type ReferenceTarget,
  THE_AGENT,
  type WriterId,
  writerId,
} from "@pineta/core"
import { decodeReply, encodeIntent, type Outcome } from "@pineta/protocol/codec"
import { Control } from "@pineta/protocol/line"
import {
  HOST_PEER_ID,
  type Reply,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import { SessionDoc, type SessionDocHandle } from "@pineta/schema"

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
  /**
   * A human message. `at` is where the sender is reading (the root starts a
   * new conversation); `mode` says how it joins the tree (`ChatMode`). It runs
   * the agent only if the agent is compelled.
   */
  chat(text: string, at: Position, mode?: ChatMode): Promise<Outcome>
  /** Cite `to`, attached where you are reading (`at`). */
  cite(to: ReferenceTarget, at: Position): Promise<Outcome>
  setName(name: string): Promise<Outcome>
  /** Make the thread rooted at `at` a working session, or a conversation. */
  setThreadMode(at: EntryId, mode: "session" | "conversation"): Promise<Outcome>
  /** Every reply as it arrived on the wire, for wire-level checks. */
  readonly replies: readonly Reply[]
  close(): Promise<void>
}

export async function connectSession(
  options: ConnectOptions,
): Promise<SessionClient> {
  const peerId =
    options.peerId ?? `client-${Math.random().toString(36).slice(2, 10)}`

  const transport = new WebsocketClientTransport({
    url: options.url,
    WebSocket: options.WebSocket,
    reconnect: { enabled: false },
  })
  const exchange = new Exchange({ id: peerId, transports: [transport] })
  await transport.waitForStatus("ready", { timeoutMs: 10_000 })

  const doc = exchange.get(SESSION_DOC_ID, SessionDoc)
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

  /** Encode an intent, send it, and resolve with the decoded outcome. */
  function send(intent: Intent): Promise<Outcome> {
    const id = `c-${Math.random().toString(36).slice(2, 10)}`
    const settled = new Promise<Reply>(resolve => replyWaiters.set(id, resolve))
    sender.send(encodeIntent(id, intent))
    return settled.then(decodeReply)
  }

  return {
    peerId,
    writer: writerId(peerId),
    exchange,
    doc,
    chat(text, at, mode = "reply") {
      return send({
        kind: "chat",
        text,
        at,
        mode,
        mentions: parseMentions(text),
      })
    },
    cite(to, at) {
      return send({ kind: "reference", to, at })
    },
    setName(name) {
      return send({ kind: "name", name })
    },
    setThreadMode(at, mode) {
      return send({
        kind: "thread",
        at,
        compels:
          mode === "session" ? { kind: "agent", agent: THE_AGENT } : NOBODY,
      })
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
