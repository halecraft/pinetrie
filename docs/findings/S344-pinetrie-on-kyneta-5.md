# S344 — does pine·trie run on Kyneta 5.0.0, and how is its lockfile changed?

- **Status:** Answered
- **Led to:** ADR-0202

For ADR-0202, whose audience policy (`Policy.subscribe`) and intent log
(`Schema.list.unrecorded`) rest on Kyneta 5.0.0 (S343). S343 read that the
upgrade touches the host's `handleConnection` and little else, but ran
nothing of pine·trie on 5.0.0. A lane must never let pnpm rewrite
`pnpm-lock.yaml`, since its store holds only Linux packages (`AGENTS.md`).

**Question.**

1. With every `@kyneta/*` dependency at 5.0.0, what fails: the type check,
   the unit tests, the host suite, the browser suite?
2. What must change in pine·trie's code for each failure?
3. How is the lockfile changed: does a lockfile written here keep every
   macOS package, or must it be written on the Mac, or edited by hand?

**Kill criterion.** None: the answer is what fails and what it takes.

**Throw away.** A scratch copy of the repo outside `/workspace`, where pnpm
may rewrite the lockfile, and every change made there.

**Answers.**

1. **One type error and one host-suite check fail; the unit tests and the
   browser suite pass.** In a copy of the repo with every `@kyneta/*`
   dependency at 5.0.0:
   - `tsc --noEmit`: one error, `handleConnection`'s result, which may now
     be `undefined` (`apps/pinetrie/host/http.ts`). The pure program's one
     error, `structuredClone` in `packages/rules/folder-records.ts`, is the
     same on 4.0.0.
   - The unit tests: 6,011 passed and 55 skipped, in 574 files
     (`unit.txt`).
   - The host suite: 77 passed, 1 failed, 1 skipped (the live model's). The
     failure, in `cards`, is "an edit to a pinned card made just before a
     send reaches that run", three runs of three on 5.0.0 (`host-suite.txt`);
     the same scenario passes on 4.0.0 (`cards-on-4.txt`).
   - The browser suite: 222 passed (`browser-suite.txt`).
   - The lanes and observer suites were not run.
2. **What each failure needs:**
   - **`handleConnection`** becomes `?.start()`: it returns nothing while
     the transport stops accepting, after closing the socket itself.
   - **The pinned-card check fails because of its helper, not because of
     pine·trie.** The check delays a card's text with `lateFor`
     (`apps/pinetrie/e2e/harness.ts`), which holds back only the WebSocket
     frames whose bytes name the card's document, so a later frame on the
     same socket overtakes it. Kyneta's wire names a document once and then
     by an alias: the overtaking frames name an alias the host has not yet
     learned, and are dropped (`alias-resolution-failed`,
     `unknown-doc-alias`, five times on both versions). Under 4.0.0 the text
     still reached the host within the run's 2 s wait. Under 5.0.0 it never
     did: the host's wait gave up at 2 s, and a further 20 s did not bring
     it (`pinned-wait.txt`). A WebSocket never reorders its frames, so the
     helper models what cannot happen. It has to delay the card's writes
     without reordering one socket's frames, for example by making the
     writes late in a second session's connection.
3. **A lockfile written here kept every macOS package.** `pnpm install
   --no-frozen-lockfile` in the copy changed only Kyneta's entries: no
   package or snapshot outside `@kyneta/*` was added or removed, and the
   same 57 lines name `darwin` and 64 `win32` before and after
   (`lockfile.diff`). So an upgrade whose packages are pure JavaScript can
   be written in a lane. `AGENTS.md`'s rule still holds for a change that
   adds or moves a package with platform builds.
4. **Two of Kyneta's own packages must be named.** Raising pine·trie's
   `@kyneta/*` dependencies left `@kyneta/reactive` and
   `@kyneta/sql-store-core` at 4.0.0, which `@kyneta/react` and
   `@kyneta/sqlite-store` 5.0.0 take as peers at `^5.0.0`: pnpm warned of
   unmet peers and installed anyway. Named at 5.0.0 (`@pinetrie/web` and
   `@pinetrie/app`), the warnings went, and the answers above held again:
   the unit tests, the host suite with its one failure, and the browser
   suite's 222. `lockfile.diff` is from then, and also holds
   `@kyneta/indexeddb-store` 5.0.0, added for S345.

**Consequences.**

- pine·trie can move to Kyneta 5.0.0 with three changes: `?.start()` in
  the host, `@kyneta/reactive` and `@kyneta/sql-store-core` named at
  5.0.0, and `lateFor` made to keep a socket's frames in order.
- Under 5.0.0, a frame dropped for an alias the receiver has not learned
  leaves its document unsynced, at least for 22 s and with the connection
  up. A WebSocket's order makes it unreachable in use, but it is worth
  telling Kyneta's authors: 4.0.0 recovered.
- Not measured: the lanes and observer suites on 5.0.0.

**Method.** The repo was copied to `/tmp` without `node_modules`, `.jj`
or `.git`, its `@kyneta/*` versions set to 5.0.0 in every `package.json`,
and `pnpm install --no-frozen-lockfile` run there. Then `pnpm run
typecheck`, `pnpm exec vitest run`, `pnpm run e2e` (and the `cards`
scenario twice more, and once in `/workspace` on 4.0.0), and
`pnpm run e2e:browser`, in Node 24 in a Linux lane. The host's wait for a
pinned card's text was logged for one run (`waitFor` in
`apps/pinetrie/host/pinned.ts`), then put back.
