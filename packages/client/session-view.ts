// client/session-view — connect to a host and expose a renderable view.
//
// Runs unmodified in a browser AND in Node (the e2e check), because the only
// environment-specific value is the WebSocket constructor. No pi.

import { Exchange } from "@kyneta/exchange"
import { subscribe } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"

import {
  type EntryId,
  type Intent,
  type LaneName,
  laneNameForWriter,
  type Position,
  type projectTranscript,
  type ReferenceTarget,
} from "@pineta/core"
import { decodeReply, encodeIntent, type Outcome } from "@pineta/protocol/codec"
import { Control } from "@pineta/protocol/line"
import {
  HOST_PEER_ID,
  type Reply,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import { SessionDoc, type SessionDocHandle } from "@pineta/schema"
import {
  readEntryCount,
  readStreaming,
  readTranscript,
  type StreamingView,
} from "./projection.ts"

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
  readonly onChange?: (view: SessionView) => void
}

export type { StreamingView }

export interface SessionView {
  /** This writer's own lane, derived from its peer id (ADR-0011). */
  readonly laneName: LaneName
  readonly transcript: ReturnType<typeof projectTranscript>
  readonly streaming: StreamingView | null
  readonly entryCount: number
}

export interface SessionClient {
  readonly peerId: string
  /**
   * The live Exchange and doc, exposed so a React tree can render from the
   * SAME connection this client already owns (via ExchangeProvider) rather
   * than opening a second one. Node callers — the e2e check — ignore both and
   * use `view()`, so one connection story serves both environments.
   */
  readonly exchange: Exchange
  readonly doc: SessionDocHandle
  /**
   * This writer's lane. The host derives the same name from the same peer id,
   * via the transport, so no lane name ever crosses the wire.
   */
  readonly laneName: LaneName
  view(): SessionView
  /**
   * Send a prompt. With no `from`, it appends at this writer's lane tip. With
   * an entry, it forks from there.
   */
  prompt(text: string, from?: EntryId): Promise<Outcome>
  /** Move this writer's lane to `to`, running nothing. */
  navigate(to: Position): Promise<Outcome>
  /** Cite an entry or a span of one, from this writer's lane tip. */
  cite(to: ReferenceTarget): Promise<Outcome>
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

  /**
   * The rendered view. Transcript order comes from the parentId walk, never
   * from seq (ADR-0013: nothing may render by seq order). Entries in the doc
   * carry no seq at all, so this is enforced structurally, not by discipline.
   */
  const laneName = laneNameForWriter(peerId)

  function view(): SessionView {
    return {
      laneName,
      transcript: readTranscript(doc, laneName),
      streaming: readStreaming(doc, laneName),
      entryCount: readEntryCount(doc),
    }
  }

  const unsubscribe = subscribe(doc, () => options.onChange?.(view()))

  /** Encode an intent, send it, and resolve with the decoded outcome. */
  function send(intent: Intent): Promise<Outcome> {
    const id = `c-${Math.random().toString(36).slice(2, 10)}`
    const settled = new Promise<Reply>(resolve => replyWaiters.set(id, resolve))
    sender.send(encodeIntent(id, intent))
    return settled.then(decodeReply)
  }

  return {
    peerId,
    laneName,
    exchange,
    doc,
    view,
    prompt(text: string, from?: EntryId): Promise<Outcome> {
      return send(
        from === undefined
          ? { kind: "prompt", text }
          : { kind: "branch", text, from },
      )
    },
    navigate(to: Position): Promise<Outcome> {
      return send({ kind: "navigate", to })
    },
    cite(to: ReferenceTarget): Promise<Outcome> {
      return send({ kind: "reference", to })
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
