# S91 — Undo stacks per person and root, stored by the host

- **Status:** Answered
- **Led to:** ADR-0066

Asked while planning undo of moves on the host (ADR-0066): can the host keep
one stack per person and root in its store, so a person's tabs share it,
it outlives a restart, it unloads when idle, and it can be destroyed without
being loaded? Measured in a lane (Node 24) against Kyneta with
`undo({ whole: true })` (Kyneta `11365c0`). The host was an `Exchange`
(`type: "service"`) over `openStore`'s SQLite store, with a Yjs places
document of `.json()` rows (a place and a placer). Each stack's document was
`undo:<person>:<root>`, key `moves`, scope the places document. Each move
was a gesture on its person and root's stack, whichever tab made it. The
probe (`probe-s84.ts`) and its output (`results-s84.json`) are kept under
`.plans/s82-probe/`, not committed. The probe was named S84 before that
number went to `S84-the-session-as-one-document.md`.

**Answers.**

1. **A person's tabs share one history per root.** Ada took `a1` from tab 1
   and `a2` from tab 2, both in root R1; she also took `b1` in R2, and Bea
   took `x1` in R1. Ada's undo in R1 put `a2` back, from either tab. `a1`
   stayed taken, and so did `b1` (another root) and `x1` (another person).
2. **A stack survives a restart.** After the host stopped and started again
   over the same file, Ada's undo in R1 undid her last move there, and a
   second undo the one before it.
3. **An idle stack unloads and loads again.** `dispose`, `flush`, then
   `unload` of its document: the Exchange no longer held it. The next undo
   made the stack again, loaded it from the store, and undid the move.
4. **A stored stack can be destroyed without loading it.** `destroy` of a
   document stored but not loaded in this run did not throw. At the next
   start the store no longer held it (`open` gave `undefined`), a stack made
   on its id undid nothing, and the card it had moved stayed where it was.
   A stack not destroyed was still in the store.

**What it settles.** The host can keep moves' history per person and root
as Kyneta stacks in its own store: shared by a person's tabs, kept across
restarts, unloaded when nobody is there, and retired by id alone, so a sweep
needs only the store's listing.
