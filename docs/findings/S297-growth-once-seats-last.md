# S297 — what grows in the host's store, and how fast, once seats last and requests are intents

- **Status:** Open

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
