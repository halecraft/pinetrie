// client/session-view — connect to a host and expose a renderable view.
//
// Runs unmodified in a browser AND in Node (the e2e check), because the only
// environment-specific value is the WebSocket constructor. No pi.

import { Exchange } from "@kyneta/exchange"
import { subscribe } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"

import type { projectTranscript } from "@pineta/core"
import { SessionDoc, type SessionDocHandle } from "@pineta/schema"
import { Control } from "../protocol/line.ts"
import {
  type Command,
  command,
  HOST_PEER_ID,
  type Reply,
  SESSION_DOC_ID,
} from "../protocol/messages.ts"
import {
  readEntryCount,
  readLane,
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
  readonly laneName: string | null
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
  view(): SessionView
  /** Send a prompt; resolves with the host's Reply. */
  /**
   * Send a prompt. `parentId` null appends at the lane tip; a string forks
   * from that entry (the host navigates there first).
   */
  prompt(text: string, parentId?: string | null): Promise<Reply>
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
  function view(): SessionView {
    return {
      laneName: readLane(doc),
      transcript: readTranscript(doc),
      streaming: readStreaming(doc),
      entryCount: readEntryCount(doc),
    }
  }

  const unsubscribe = subscribe(doc, () => options.onChange?.(view()))

  return {
    peerId,
    exchange,
    doc,
    view,
    /**
     * Send a prompt. `parentId` null appends at the lane tip; a string forks
     * from that entry (the host navigates there first).
     */
    prompt(text: string, parentId?: string | null): Promise<Reply> {
      const id = `c-${Math.random().toString(36).slice(2, 10)}`
      const settled = new Promise<Reply>(resolve =>
        replyWaiters.set(id, resolve),
      )
      const outgoing: Command =
        parentId === null || parentId === undefined
          ? command({ id, kind: "prompt", text })
          : command({ id, kind: "branch", text, parentId })
      sender.send(outgoing)
      return settled
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
