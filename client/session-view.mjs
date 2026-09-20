// client/session-view — connect to a host and expose a renderable view.
//
// Runs unmodified in a browser AND in Node (the e2e check), because the only
// environment-specific value is the WebSocket constructor. No pi.

import { Exchange } from "@kyneta/exchange"
import { subscribe } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"

import { projectTranscript } from "../core/index.mjs"
import { HOST_PEER_ID, SESSION_DOC_ID, command } from "../protocol/messages.mjs"
import { Control } from "../protocol/line.mjs"
import { SessionDoc, readEntries, readLaneNames, readLaneTip, readStream } from "../schema/index.mjs"

/**
 * @param {{ url: string, WebSocket: any, peerId?: string,
 *           onChange?: (view: object) => void }} options
 */
export async function connectSession(options) {
  const peerId = options.peerId ?? `client-${Math.random().toString(36).slice(2, 10)}`

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

  const replies = []
  const replyWaiters = new Map()
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
  function view() {
    const entries = readEntries(doc)
    const lanes = readLaneNames(doc)
    const laneName = lanes[0] ?? null
    const tip = laneName === null ? null : readLaneTip(doc, laneName)
    const runId = doc.activeRunId()
    return {
      laneName,
      transcript: projectTranscript(entries, tip),
      streaming: runId === "" ? null : { runId, text: readStream(doc, runId) },
      entryCount: Object.keys(entries).length,
    }
  }

  const unsubscribe = subscribe(doc, () => options.onChange?.(view()))

  return {
    peerId,
    view,
    /** Send a prompt; resolves with the host's Reply. */
    prompt(text) {
      const id = `c-${Math.random().toString(36).slice(2, 10)}`
      const settled = new Promise((resolve) => replyWaiters.set(id, resolve))
      sender.send(command({ id, kind: "prompt", text }))
      return settled
    },
    replies,
    async close() {
      try { unsubscribe?.() } catch {}
      try { await exchange.shutdown() } catch {}
    },
  }
}
