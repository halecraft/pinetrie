# S293 — do two of your devices sync your documents directly, with no host, under the same policies?

- **Status:** Answered

For ADR-0202, which says the same policies hold on a relay, on a peer
reached directly and on another person's host, so federation needs no new
rules for documents.

**Question.**

1. Two of Ada's peers, each with a store, connected to each other over a
   direct transport and to no host: do her own documents (a drafts record,
   a card's text) sync both ways, and survive each peer's restart?
2. With `writersPolicy`-style `canWrite` registered on both (a document
   only the host may write), does a write to it throw on each, and is an
   offer of it from one refused by the other?
3. A third peer, Bea, connects to Ada's: does `canShare` keep Ada's own
   documents from her, as the host's policy does now?
4. Then a host joins one of them: does everything converge, with no
   document written twice?
5. WebRTC: two headless Chromium pages on one origin, the driver relaying
   their signalling, each with `@kyneta/webrtc-transport` over an
   `RTCDataChannel`: does question 1 hold there too?

**Kill criterion.** The design's claim about federation does not hold if
two peers with no host diverge, or if a policy that holds through the
host does not hold between them.

**Throw away.** The probe, built outside the repo with packages its
lockfile does not hold, as S290 was
(`docs/findings/S290-a-browser-store/`). For Node, a transport that pairs
two exchanges directly (`@kyneta/bridge-transport`, or a WebSocket
server on one of them).

**Answers.**

1. **Yes: Ada's two devices sync both ways with no host, and survive
   each restart.** Her desktop served a WebSocket and her laptop
   connected to it; each had a SQLite store. A draft and a card's text
   written on either reached the other. Each kept its seat across a
   restart, read its documents from its store once hydrated, and caught
   up on what the other wrote meanwhile; a draft the laptop wrote while
   the desk was off reached the desk when it came back.
2. **Yes, a document only the host may write is refused on both.**
   Each device's own write to the places threw `NotAWriterError`. A rogue
   peer of Ada's that ran no policy wrote the places and offered them to
   the desk: the desk refused them (`refuse`, and Kyneta's
   `offer-refused` warning on the rogue), and they reached neither
   device. The rogue's write to a card's text, which anyone may write,
   reached the laptop through the desk.
3. **Yes, Bea never gets Ada's own documents.** Connected to the desk,
   she was not sent Ada's drafts; asking for them, and for Ada's `json`
   prefs, by id, she read them empty (`vacant`); her own write to Ada's
   drafts threw. The card's text reached her, and her edit to it reached
   the laptop through the desk.
4. **Everything any member may write converged; a document only the
   host writes did not cross a peer that is not the host.** A host
   joined the laptop. It received Ada's drafts, the card's text with each
   writer's part once, and her prefs, a `json` document written by the
   desk alone, with no `lineage-collision`. Then the host wrote the
   places:
   - the laptop, connected to the host, took them;
   - the desk, connected only to the laptop, **refused** them, and so
     did Bea, connected only to the desk;
   - once the desk connected to the host as well, it took them; Bea,
     still behind the desk, refused the desk's relay and never had them.

   Kyneta judges an offer by its **sender**, not by who wrote its
   operations: the exchange accepts one when `canAccept ∧ canWrite` hold
   for the peer that sent it (`exchange.ts`, the `Synchronizer`'s
   `canAccept`), as its README says ("against the sender of every
   offer"). So a document with one writer travels only along a link to
   that writer, or through a peer the policy also names as a writer. The
   host relays a person's documents today only because `mayWrite` names
   it one of their writers (`packages/protocol/TECHNICAL.md`).
5. **Yes, over WebRTC too.** Two browser contexts (two devices, two
   IndexedDB stores) paired over an `RTCDataChannel` through
   `@kyneta/webrtc-transport`, the driver relaying the offer, answer and
   ICE candidates. Both ways synced; a reload kept the laptop's seat and
   its documents; after signalling again, it caught up on the desk's
   write made while it reloaded, and its next write reached the desk. A
   reload needs signalling again: the data channel does not survive it.

The Node probe ran twice with the same answers (`node-output.txt`,
`node-output-2.txt`), the WebRTC probe once (`rtc-output.txt`).

**Consequences.**

- The kill criterion is met in part. No two peers diverged, and every
  refusal the host makes was made between peers too. But a policy that
  holds through the host refuses more between peers: **a document with
  one writer reaches only the peers linked to its writer, or to a peer
  named as one of its writers.** A hub never shows this, since every
  client links to the host.
- For ADR-0202, "the same policies hold on a relay, on a peer reached
  directly and on another person's host" holds for documents that merge
  (a canvas, a thread's log, card texts, your own documents among your
  devices), not for documents with one writer: the places today, and the
  agent's record that only its tether writes. A member who reaches the
  tether only through another member's peer would never receive the
  agent's record. The choices: such a document travels only on links to
  its writer (every reader connects to the tether, or to the host that
  holds it); the policy names its relays as writers, which lets a relay
  forge it; or a receiving peer judges each operation by its author,
  which needs signed operations Kyneta does not have (`canWrite` sees
  the sender only).
- A person's own documents travel between her devices directly, with no
  host: ADR-0202's "what is yours starts with you" holds across devices.
- WebRTC needs a signalling path for every pairing, a reload's included.
- Not measured: more than one hop of a merging document's relay under
  load, a NAT between real machines, and Safari or Firefox.

**Method.** Node 24 in a Linux lane, with packages installed outside the
repo (`versions.json`). `node.ts`: Ada's desk (`WebsocketServerTransport`
behind a `ws` server) and laptop (`WebsocketClientTransport` with
`reconnect`), each with `@kyneta/sqlite-store` over `better-sqlite3`, and
each registering one policy shaped as `writersPolicy` and the host's
`canShare`: the places writable by the host alone, a person's documents
writable and shared by that person and the host. A restart was
`shutdown` and a new `Exchange` over the same file. A rogue peer was an
`Exchange` with no policy. Bea and the host were further `Exchange`s, the
host joined through a transport added to the laptop
(`addTransport`). Kyneta's diagnostics were read from the console.
`rtc.ts` drove headless Chromium (`playwright-core` 1.64.1) with WebRTC's
mDNS hiding off so loopback candidates connect; `page.ts`, bundled by
esbuild, opened `createIndexedDBStore` and a `WebrtcTransport`, and
attached the data channel once open.
