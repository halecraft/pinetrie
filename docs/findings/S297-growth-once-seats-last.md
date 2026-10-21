# S297 — what grows in the host's store, and how fast, once seats last and requests are intents

- **Status:** Answered
- **Led to:** ADR-0202

For ADR-0202. With a browser store a tab keeps its seat across reloads
(S290), so seats stop being new on every visit; Kyneta keeps `Line`
documents to a seat that never returns for good ("Nothing removes them
yet", its README); a thread's intent log is kept as its history; a live
Yjs document cannot trim its history (S291); a move costs 12 bytes kept
for good (S289).

**Question.**

1. How many seats does a person make, with Web Locks: per device, per
   tab opened at once, after closing and opening tabs many times? Does the
   pool stay at the most tabs open at once, as Kyneta says?
2. The bytes in the host's store for each seat that connects (its `Line`
   documents, its seat record) and for each seat that never returns.
3. A thread's intent log after 10,000 messages and 1,000 edits, as Yjs:
   its bytes, its load time, and the bytes the agent's record holds for
   the same thread.
4. What a sweep of the `Line`s of seats gone for good would need: what
   tells the host a seat will not return.

**Kill criterion.** None: the answers are measurements, which decide
whether a sweep, a log's retention, or a shallower intent shape is needed
before a plan.

**Throw away.** The probes: Kyneta in Node with the SQLite store
(`@kyneta/sqlite-store`, which the repo holds) for 2 to 4, and headless
Chromium with `@kyneta/indexeddb-store` outside the repo for 1, as S290.

**Answers.**

1. **A device's seats stay at the most tabs it had open at once, on a
   secure origin, and are new on every open anywhere else.** Over one
   origin's store in headless Chromium, on `http://localhost`:
   - one tab reloaded 20 times held one seat, and so did one tab closed
     and opened 20 times;
   - three tabs at once, ten times over, used the same three seats;
   - ten at once made ten, and one tab opened afterwards took one of
     them, so the pool was ten seats after 82 opens;
   - a tab whose renderer crashed (`chrome://crash`) released its seat:
     the next tab took it;
   - another browser profile, which is another device, got a seat not
     seen before.

   With no Web Locks the store issues a new seat on every open: ten opens
   made ten seats with `locks: null`, and five made five on a LAN address
   (`http://<the lane's IP>`), which is not a secure context. There the
   store warned: "Web Locks are unavailable, so every open is a new peer.
   Serve the page from a secure context to keep one across reloads."
   pine·trie's invite links are plain `http://` on the LAN address
   (`planInvites`, `apps/pinetrie/host/admission.ts`), so every
   collaborator who is not on loopback gets a new seat on every load, as
   now.
2. **A seat that opens a `Line` and leaves keeps about 2.4 kB in the
   hub's store, and about 1.3 kB more for each request it sent; a
   compaction brings it to about 390 bytes.** A Kyneta hub over
   `node:sqlite`, opened as pine·trie's `openStore` does, kept with
   Kyneta's default `departureTimeout`:
   - each seat left two `Line` documents, one each way;
   - one request and its answer each (a 300-byte body): 6 records,
     2,412 bytes a seat, the records and their metadata;
   - 20 each: 44 records, 26,486 bytes; 200 each: 404 records,
     255,981 bytes. Acknowledged messages leave the `Line`'s state, but
     their operations stay in the store until a compaction;
   - `exchange.compact` on all 150 `Line` documents, with every seat
     gone, succeeded for both directions, the half the clients wrote
     included, and took them from 1,897,375 bytes to 57,240: 388 bytes a
     seat, two records each.

   pine·trie's own seat record (`pinetrie.seat`, `packages/rules/seat.ts`:
   its peer, `clientID`, person and first-seen time) is about 114 bytes as
   JSON, computed from its shape, not measured in a host.
3. **A Yjs intent log of 10,000 messages and 1,000 edits is 5.4 MB, and
   loads in about 110 ms; the same messages as pi's record are 7.0 MB
   compacted.** The log appended one intent per transaction, under five
   writers' `clientID`s, each intent `{ id, kind, author, seq, parent,
   target, text, replaces }`, with an edit carrying the text it replaces.
   Messages averaged about 300 characters.
   - Its text came to 3,664,840 bytes; its Yjs update to 5,434,062 bytes
     (5,378,719 as update v2), so about 161 bytes an intent beyond its
     text. Kyneta's entirety payload was the same 5,434,062 bytes.
   - Loading it into a fresh document took a median of 111 ms over five
     runs, and reading every intent after that added nothing measurable.
     `Y.applyUpdate` alone took 24 ms.
   - The record, one root-document row a message as `KynetaStorage`
     writes them, holding no edits: 6,973,933 bytes compacted, and
     7,773,850 of operations before a compaction. It loaded in 91 ms.

   The agent's replies and tool calls are in neither figure: they are in
   the record alone, as now.
4. **Nothing tells a host that a seat will not return.** Read from
   Kyneta's source and README, and from question 1:
   - A peer goes `peer-disconnected`, then `peer-departed` once its
     `departureTimeout` passes, or at once on a graceful `shutdown` or a
     `depart`. A departed peer is gone from `exchange.peers`, but its seat
     can come back later from its store, as the same peer: departure is
     not "never again".
   - What ends a seat for good happens on the device and is never sent:
     its site data cleared, its profile deleted, a store opened with no
     Web Locks (every such open's seat is gone at its close).
   - What a host can know is when it last saw each seat, and the pool's
     bound: a person's live seats are at most their tabs open at once,
     per device.

   So a sweep of what a gone seat leaves can only be by time since it
   was last seen, and must be safe for a seat that does come back.

The outputs are in `seats-output.txt`, `lines-output.txt` and
`log-output.txt`.

**Consequences.**

- **Seats last only on a secure origin.** On loopback a tab keeps its seat
  and a device's seats are bounded by its tabs open at once. A
  collaborator on an invite link (`http://` on the LAN) gets a new seat
  on every load, so for them nothing of ADR-0202's lasting seat holds:
  attribution, a bounded seat count, and the store keeping one seat's
  documents. Lasting seats for everyone need the host to serve its page
  over HTTPS, or another secure context.
- **Requests as intents in logs, not `Line`s, remove the per-seat
  growth.** A `Line` to a seat that never returns costs about 2.4 kB, and
  1.3 kB a request until compacted, for good. Under ADR-0202's intent
  logs, a seat leaves only its seat record (about 114 bytes) and whatever
  it wrote in documents that are kept anyway. If `Line`s stay, the host
  compacts them, which here worked on both halves once their seats were
  gone, and sweeps a seat's two `Line` documents by time since it was
  last seen.
- **A thread's intent log is affordable, and is stored next to the
  record.** At about 161 bytes an intent beyond its text, the log is
  smaller than the record holding the same messages. But the messages
  are then stored twice, the log's 5.4 MB plus the record's 7.0 MB in
  this example, with the log never trimmed (S291). An edit that carries
  what it replaces doubles that edit's text.
- **A log's load stays small beside a page's other costs** at this size,
  about 0.1 s for 11,000 intents in Node. A log ten times as long would be
  about 54 MB, where retention becomes a decision of its own.
- Not measured: Firefox and Safari; a browser profile's site data
  cleared; pine·trie's own host with seats that last; a log with the
  agent's words in it; the cost of a log in a browser tab's memory.

**Method.**

- **Seats** (`seats.ts`, `seats-page.ts`): headless Chromium
  (Playwright's headless shell, `playwright-core` 1.64.1), a page bundled
  by esbuild that opens `createIndexedDBStore("s297")` and an `Exchange`
  over it and returns its `peerId`, served from Node on
  `http://localhost`, and on the lane's LAN address for case H. Packages
  in `versions.json`, installed outside the repo.
- **The host's store** (`lines.ts`): a hub `Exchange` with
  `authority: "self"`, Kyneta's default `departureTimeout`, and
  `createSqliteStore` over `node:sqlite`, with the adapter pine·trie's
  `openStore` uses; clients over WebSocket, each a new seat, opening a
  `Line` to the hub, sending requests with a 300-byte body and awaiting
  each answer, then shutting down. Sizes are the `kyneta_records` rows'
  payload and blob bytes, with their `kyneta_doc_meta` rows.
- **The log and the record** (`log.ts`, run as
  `apps/pinetrie/e2e/s297-log.ts`, so it imports `@pinetrie/schema`'s
  `RootDoc` from the repo): documents from `createDoc`, one `batch` an
  intent or a row, sizes from `Y.encodeStateAsUpdate` and Kyneta's
  `exportEntirety` and `exportSince`. Times are medians of five runs in
  Node 24 in a Linux lane, a measurement of this machine only.
