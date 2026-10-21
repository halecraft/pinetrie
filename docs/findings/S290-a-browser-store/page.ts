// S290's page: one tab of Ada's, with a browser store, reconnecting. Bundled
// with `esbuild page.ts --bundle --format=esm` in a directory holding
// versions.json's packages, outside the repo (none of them is in its
// lockfile).

import { Exchange, Line, sync, whenPeer } from "@kyneta/exchange"
import { createIndexedDBStore } from "@kyneta/indexeddb-store"
import { batch, Schema } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"
import { yjs } from "@kyneta/yjs-schema"

const Drafts = yjs.bind(Schema.struct({ slots: Schema.record(Schema.string()) }))
const Text = yjs.bind(Schema.struct({ text: Schema.text() }))
const Cmd = Line.protocol({
  topic: "cmd",
  schema: Schema.struct({ text: Schema.string() }),
})

const replies: string[] = []
let ex: Exchange
let drafts: ReturnType<typeof ex.get<typeof Drafts>>
let text: ReturnType<typeof ex.get<typeof Text>>
let sender: { send(m: { text: string }): void } | null = null
let status = "none"

async function lineTo(hub: string) {
  sender = Cmd.sender(ex, hub)
  const receiver = Cmd.claimReceiver(ex, hub)
  void (async () => {
    for await (const m of receiver) replies.push(m.text)
  })()
}

;(window as any).probe = {
  async open(url: string) {
    const store = await createIndexedDBStore("s277")
    const t = new WebsocketClientTransport({
      url,
      WebSocket,
      reconnect: { enabled: true, maxAttempts: 1000, baseDelay: 200, maxDelay: 500 },
      lifecycle: { onStateChange: s => (status = s.to.status) },
    })
    ex = new Exchange({
      principal: "ada@s277.test",
      transports: [t],
      store,
      canShare: id => (id.startsWith("undo:") ? false : undefined),
    })
    drafts = ex.get("drafts:ada", Drafts)
    text = ex.get("card:k1", Text)
    const known = localStorage.getItem("hubSeat")
    if (known !== null) await lineTo(known)
    else
      void whenPeer(ex, p => p.principal === "hub").then(async p => {
        localStorage.setItem("hubSeat", p.peerId)
        await lineTo(p.peerId)
      })
    return ex.peerId
  },
  write(thread: string, card: string, more: string) {
    batch(drafts, d => d.slots.set(thread, card))
    text.text.insert(text.text().length, more)
  },
  send(m: string) {
    if (sender === null) return false
    sender.send({ text: m })
    return true
  },
  read() {
    return {
      seat: ex.peerId,
      slots: drafts.slots(),
      text: text.text(),
      replies,
      status,
      line: sender !== null,
      connectivity: sync(text).connectivity,
    }
  },
}
