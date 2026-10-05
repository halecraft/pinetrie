# S86 — what Kyneta does with many root documents

Measured in a lane (Linux, Node 24) for `PLAN-2026-10-03-root-documents`,
before ADR-0063. Kyneta read at `kyneta/workspace/pineta`. The setup: a host
`Exchange` over `openStore`'s SQLite store and clients over Kyneta's in-process
`Bridge`, with plain `json` documents. The probes are in `.plans/s86-probe/`,
not committed.

**Answers.**

1. **An unloaded root comes back when a client asks, but only from a host
   that declares itself the authority.** Kyneta's sync program reloads an
   unloaded document on a peer's request only where `servesUnloaded()`, which
   is `Policy.authority === "self"` (Kyneta's `packages/exchange/TECHNICAL.md`,
   "Document classification on present").
   - Without that policy, a client's `get` of a root the host had unloaded
     never received it.
   - With `{ authority: "self" }` registered, the first client had its 500
     entries in 32 ms, and a second client in 7 ms.
   - No `unloaded-doc-reloaded` warning reached `console.warn`.
   - pine·trie's host declares no authority today.
2. **A client's `destroy` leaves the host's copy alone.** After one client
   destroyed its copy, the host still held all 500 entries. The same client's
   next `get` had them again in 17 ms.
3. **A client takes in every announced document whose schema it knows.**
   Kyneta auto-interprets an announced document whose schema hash matches a
   schema the client has registered: step 2 of the classification, before
   `resolve` runs.
   - A client that opened one document of the roots' schema held all 101
     afterwards: 22 MB of heap.
   - The same client with a `canShare` policy declining `root:` documents it
     does not hold held 1, and 0.05 MB. Its later `get` of one root had it
     in 6 ms.
   - So on a client, every root shares the session's schema, and a client
     must decline the roots it has not opened.
4. **`canShare` is asked as `get` opens a document, and not again.**
   Opening a document announces it (`present`) and asks peers for it
   (`interest`) in the same step, each sent only where `canShare` allows
   (Kyneta's `handleDocEnsure` in `packages/exchange/src/sync-program.ts`).
   - Found by the browser suite: a page whose policy read the roots it held
     after `get` returned opened the root's tab and never received its
     entries ("another window draws it too", `e2e/browser/images`).
   - So the client records a root as wanted before it calls `get`.
5. **A session schema without its stream fields opens a store written with
   them.** A `json` document with `streamText` and `activeRuns`, compacted,
   reopened under a schema of `entries` alone. It hydrated with its entries,
   and needed no declared migration.

## Consequences for the plan

- The host registers `{ authority: "self" }`. It is the session's only
  writer and has no upstream, so nothing it settles changes meaning: its
  `whenHydrated` already ignores peers (`apps/pinetrie/host/index.ts`).
- The client registers a `canShare` that declines a `root:` document unless
  the client holds it (`planHeldRoots`).
- Step A, moving streams to `pinetrie:live`, needs no migration code.
