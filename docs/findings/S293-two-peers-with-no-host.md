# S293 — do two of your devices sync your documents directly, with no host, under the same policies?

- **Status:** Open

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
