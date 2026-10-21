// S293's page: one of Ada's devices, a browser store, and a WebRTC data
// channel to her other device; the driver relays the signalling. Bundled
// with `esbuild page.ts --bundle --format=esm` outside the repo.

import { Exchange, whenHydrated } from "@kyneta/exchange"
import { createIndexedDBStore } from "@kyneta/indexeddb-store"
import { batch, Schema } from "@kyneta/schema"
import { createWebrtcTransport, type WebrtcTransport } from "@kyneta/webrtc-transport"
import { yjs } from "@kyneta/yjs-schema"

const Drafts = yjs.bind(Schema.struct({ slots: Schema.record(Schema.string()) }))
const Text = yjs.bind(Schema.struct({ text: Schema.text() }))

let ex: Exchange
let transport: WebrtcTransport
let pc: RTCPeerConnection
const candidates: RTCIceCandidateInit[] = []
let channelOpen = false

const docs = () => ({ drafts: ex.get("drafts:ada", Drafts), text: ex.get("card:k1", Text) })

function newPeer(remote: string) {
  pc = new RTCPeerConnection({ iceServers: [] })
  pc.onicecandidate = e => {
    if (e.candidate) candidates.push(e.candidate.toJSON())
  }
  const attach = (dc: RTCDataChannel) => {
    dc.binaryType = "arraybuffer"
    const go = () => {
      channelOpen = true
      transport.attachDataChannel(remote, dc)
    }
    if (dc.readyState === "open") go()
    else dc.addEventListener("open", go)
  }
  pc.ondatachannel = e => attach(e.channel)
  return attach
}

;(window as any).probe = {
  async open() {
    const store = await createIndexedDBStore("s293")
    transport = createWebrtcTransport()
    ex = new Exchange({ principal: "ada", store, transports: [transport] })
    const d = docs()
    await whenHydrated(d.drafts)
    await whenHydrated(d.text)
    return ex.peerId
  },
  async offer(remote: string) {
    const attach = newPeer(remote)
    attach(pc.createDataChannel("kyneta"))
    await pc.setLocalDescription(await pc.createOffer())
    return pc.localDescription?.toJSON()
  },
  async answer(remote: string, offer: RTCSessionDescriptionInit) {
    newPeer(remote)
    await pc.setRemoteDescription(offer)
    await pc.setLocalDescription(await pc.createAnswer())
    return pc.localDescription?.toJSON()
  },
  async accept(answer: RTCSessionDescriptionInit) {
    await pc.setRemoteDescription(answer)
  },
  takeCandidates() {
    return candidates.splice(0)
  },
  async addCandidates(cs: RTCIceCandidateInit[]) {
    for (const c of cs) await pc.addIceCandidate(c)
  },
  write(thread: string, card: string, more: string) {
    const d = docs()
    batch(d.drafts, x => x.slots.set(thread, card))
    d.text.text.insert(d.text.text().length, more)
  },
  read() {
    const d = docs()
    return { seat: ex.peerId, slots: d.drafts.slots(), text: d.text.text(), channelOpen, peers: ex.peers().size }
  },
}
