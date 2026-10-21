# S290 — a page with a browser store keeps its work and its requests through an outage and a reload

Numbered S277, then S279, then S281, until 2026-10-20, when two files held each number.

- **Status:** Answered
- **Led to:** ADR-0202

Asked with Duane, for the first-principles design of pine·trie's
documents: whether a page that keeps a Kyneta store in the browser, and
reconnects, lets typing and starting things need no server. Today a
client keeps no store and never reconnects (ADR-0037), so with the host
gone the composer clears itself, and a reload loses what was typed.

**Question.**

1. With `@kyneta/indexeddb-store`, does a tab keep its seat across a
   reload, and does a second tab open at once get another?
2. With the hub down, do writes to your own document (a drafts record)
   and to a card's text throw, or stand? Do they survive a reload with
   the hub still down? Does a second tab read them?
3. When the hub comes back from its store, do those writes reach it?
4. A request sent over a `Line` while the hub is down, and one sent after
   a reload with the hub still down: are they answered once the hub is
   back, each exactly once and in order? Does the hub keep its seat
   across a restart from its store?
5. What the browser store costs the page.

**Kill criterion.** A browser store does not give pine·trie offline
drafts and requests if writes made offline are lost on a reload, if they
never reach the hub, or if a request is lost or answered twice.

**Throw away.** The probe, built outside the repo with packages its
lockfile does not hold: `page.ts`, `driver.ts`, and `versions.json` in
this spike's folder.

**Answers.**

1. **A reload keeps the seat, and a second tab gets its own.** The tab's
   seat was the same after the reload. A second tab, opened at once over
   the same store, was another seat. Both are Web Locks held by the
   store, on `localhost` (a secure context).
2. **Offline writes stand, survive a reload, and every tab reads them.**
   With the hub down, the transport was `reconnecting` and the document's
   connectivity `connecting`. A write to the drafts record, an append to
   the card's text, and a `Line` send threw nothing, and the tab read
   them at once. After a reload, with the hub still down, the tab read
   the same draft and text from its store. A second tab read them too,
   since tabs share an origin's store.
3. **They reach the hub when it comes back.** The hub restarted from
   its store on the same port, and the tab reconnected by itself. The
   hub then held the offline draft (`t2`) and the offline text
   (`hello offline`).
4. **Each request is answered exactly once, in order, through an outage
   and a reload.** `m1` was sent online, `m2` with the hub down, and `m3`
   after a reload with the hub still down. The hub received
   `m1, m2, m3`, each once, and the tab got `echo m2` and `echo m3`. The
   hub's seat was the same after its restart, so the `Line` the tab
   addressed to it carried on. The tab kept the hub's seat in
   `localStorage` to open its `Line` while the hub was away, because
   `whenPeer` waits for a connected peer.
5. **4.8 kB.** Minified, `@kyneta/indexeddb-store` is 4.8 kB of a 362 kB
   page holding Kyneta, Yjs and the transport.

Two runs, alike but for the seats' ids (`output.txt`, `output-2.txt`).

**Consequences.**

- The kill criterion is not met. **A page with a browser store and a
  transport that reconnects keeps what you write and what you ask through
  an outage and a reload.** ADR-0037's "a client keeps no store and does
  not reconnect" is what to revisit. The host's `departureTimeout: 0`,
  its deletion of every stored `Line` at start, and `HostLine.close`
  answering `failed` at once all rest on it.
- **A request made offline is delivered, so the host judges it when it
  arrives**, against what holds then. Which requests should not be
  carried out late is still open: the design note's fourth unknown.
- **A seat lasts across reloads**, so a seat's `clientID`, and with it
  who wrote what, is the same between visits. Seat records stop growing
  with every visit. The host's `Line`s to a seat that never returns are
  still stored for good (the fifth unknown).
- **A tab needs the host's seat while the host is away.** It keeps it
  from the last connection. A host whose seat changed (a new store) would
  leave those requests unanswered, so the page needs a rule for that.
- Not measured: Safari and Firefox, a store that hits its quota, an
  origin that is not a secure context (no Web Locks: a fresh seat on each
  load, the store warns), the hub on SQLite rather than an in-memory store
  shared across its restart, and pine·trie's own host.

**Method.** `driver.ts` ran in Node 24 in a Linux lane. It started a page
server and, on another port, a hub `Exchange` with `authority: "self"` and
an in-memory store whose data outlived the hub (`createInMemoryStoreData`),
listening on a `Line` and echoing each message. It drove headless Chromium
(Playwright's headless shell, `playwright-core` 1.64.1) on
`http://localhost`. `page.ts`, bundled by esbuild, opened
`createIndexedDBStore`, a `WebsocketClientTransport` with `reconnect`
enabled, a drafts record and a card's text (both Yjs), and a `Line` to the
hub. The hub's outage was its WebSocket server closed and its exchange
shut down. Its return was a new exchange over the same store data on the
same port.
