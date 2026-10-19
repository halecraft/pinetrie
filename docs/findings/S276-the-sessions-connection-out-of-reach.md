# S276 — With the session's pure modules behind its main entry and its connection behind a subpath, pure code needs five globals, none of them the session's

Numbered S274 until 2026-10-20, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0194

**Question.** S273 found eight globals named by interface and what it
reaches, and three of them (`crypto`, `setTimeout`, `clearTimeout`) are
the session's shell's, reached because TypeScript checks every file a
program reaches. While they are on the pure list, every global the
session's connection comes to need must join it. Interface takes from
`@pinetrie/session` the types `SessionClient` and `HostRequest`
(`connect.ts`) and `AttentionStore` (`attention-doc.ts`), the acting
types, the card moves, the inventory and `SendHow`.

1. If those types live in modules that import no connection code, and
   interface imports from an entry that re-exports only pure modules,
   which globals does interface's program still need?
2. What stands in the way?

**Kill criterion.** If the session's types cannot be separated from its
connection without moving most of `connect.ts`, the list keeps the
session's globals and S273's eight stand.

**Throw away.** The patch, applied in the working copy and reverted;
this file records what it changed.

## Answers

1. **Five: `TextEncoder`, `TextDecoder`, `URL`, `URLSearchParams`,
   `AbortSignal`,** all named by core and rules. With them, interface and
   shell type-check against nothing else, except `upload.ts`'s `fetch`
   and `Blob`, which leave interface anyway (S269).

   **What the patch did:**
   - `SessionClient` and `HostRequest`, with the two types only they
     name (`NewCard`, `CardUndo`), moved from `connect.ts` to a new
     `client.ts`, which imports types only, from modules that hold no
     connection: `acting.ts`, `card-moves.ts`, `inventory.ts`,
     `open-threads.ts`, `send.ts`, `store.ts`, and Kyneta's and pine·trie's
     packages. `connect.ts` re-exports them.
   - `AttentionStore` and `SeenMentions` moved from `attention-doc.ts`
     (which uses timers) to a new `attention-store.ts`.
   - An entry re-exporting only what interface takes, from those modules,
     as a subpath of the package; interface's imports pointed at it.

   Interface's own type check (`tsc -p packages/interface`, with Node's
   types) passed with the patch.
2. **Two things, each small.**
   - **The package's main entry reaches everything.** `index.ts`
     re-exports `connectSession` (`connect.ts`) and the id minters
     (`ids.ts`, which uses `crypto`), and TypeScript checks every module
     an entry re-exports. So the pure modules need an entry of their own.
     The page's `main.tsx` and the suites' `join` are the only importers
     of `connectSession`, so the main entry can be the pure one and the
     connection a subpath, with fewer imports changed than the reverse.
   - **`sendActing` (`acting.ts`) is the shell inside a pure module.** It
     sets a store, sends, and defaults its id to `crypto.randomUUID()`;
     `nextActing` and `actingStep` beside it are pure. With its id taken
     from its caller, nothing else remains. It belongs with the session's
     connection, which calls it.

   The kill criterion is not met: four types and one function move.

**Measured** 2026-10-19 with TypeScript 7.0.2, the workspace's, after
accepted work's merge of that day; the patch was reverted and the
working copy compared equal to that merge.
