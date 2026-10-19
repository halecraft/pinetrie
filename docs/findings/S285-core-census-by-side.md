# S285 — Core's lane side and its conversation vocabulary are tied by four imports and eight names

- **Status:** Answered
- **Led to:** ADR-0201

**Question.** For every export of `@pinetrie/core`, resolved by the
TypeScript checker (aliases followed, as S252 did), which packages name
it, in source and in tests, and which of core's own declarations name it?
Grouped by side:

- **lane side:** `lanes`, `lanehost`, `docker`, `jj`, `folder`, the
  packages that make and keep a lane's disk, container and history;
- **below rules, not lane side:** `schema`, `protocol`, `config`;
- **conversation side:** `rules`, `reads`, `session`, `interface`,
  `web`, `pi`, the app.

Then:

1. How many exports does no other package name?
2. Is the set of core's modules the lane side names, closed under core's
   own imports (values and types), disjoint from the conversation
   vocabulary (`cards.ts`, `places.ts`, `tree.ts`, `intents.ts`,
   `messages.ts`, `mentions.ts`)? Which declarations bridge them?
3. Who names `ERR`/`ErrCode` and `ValueWrite`/`Target`, and what would a
   module of their own import?

**Kill criterion.** If the lane side's names, closed over core's own
imports, take in most of the conversation vocabulary, core does not split
by side: one core stays, and only named exports and moved declarations
remain to decide. If fewer than 20 exports go unnamed outside core, named
exports buy documentation and little else.

**Throw away.** The probe and its output stay beside this file as a review
aid, as S252's census did, if a plan builds on them; otherwise they go.

## Answers

1. **Of 676 exports, 75 are named by no other package's source**, `fixtures.ts`
   aside, and 61 of them by no other package's tests either. Most are
   parts of a larger type that callers infer (`Ancestry`, `KindsInPlace`,
   `RootSummary`), or helpers named only inside their own module
   (`parseMarginOn`, `storedRowFields`, `trailerValues`). `places.ts` has
   12, `messages.ts` 7, `facts.ts` and `images.ts` 6 each. `export *`
   re-exports every one of them.
2. **The lane side names exports of 17 modules**, once `fixtures.ts` and
   the names in item 3 are left out: `accepted`, `bases`, `config`,
   `disks`, `errors`, `folder`, `ids`, `images`, `lane-env`, `lanes`,
   `paths`, `product`, `proposed`, `revisions`, `runs`, `thread-names`,
   `trailers`. Closed over core's own value and type imports as the code
   stands, they take in 33 of 42 modules (8593 of 9605 lines), every
   conversation module among them. So as written, the kill criterion
   holds: core does not split by side.
3. **But four imports and eight names make that closure**, not the
   vocabulary itself:
   - `ERR`, `ErrCode`, `refused`, `Refusal` live in `intents.ts`; `folder`
     names `ERR` and `ErrCode`, and `proposed.ts` imports them from
     `intents.ts`.
   - `ValueWrite`, `Target` and `SESSION_TARGET` live in `intents.ts`;
     `lanes` and `schema` name `ValueWrite`.
   - `trailers.ts` imports `firstLine`, a string helper, from `tree.ts`
     (its one value import into the conversation side); a `jj` test names
     it too.
   - `ids.ts` imports `IdOf` (card kind to card id) from `places.ts`, and
     `KINDS` from `kinds.ts`, which imports `CardPlace` from `places.ts`.
     They serve the card ids `ids.ts` holds beside the ids every package
     uses; the lane side names only `ThreadId`, `isThreadId`, `EntryId`,
     `entryId` and `WriterId`.

   With those names in modules of their own, `firstLine` out of
   `tree.ts`, and the card ids beside `kinds.ts`, the lane side's closure
   is **17 modules, 3738 of 9605 lines (39%), with no conversation module
   in it**.
4. **Who names the refusals and the writes:** `ERR` is named by `app`,
   `folder`, `pi`, `protocol`, `rules`, `session` (and `interface`'s
   tests); `ErrCode` by the same; `ValueWrite` by `app`, `lanes`,
   `rules`, `schema`; `Target` by `app` and `rules`; `refused` and
   `Refusal` by `app`, `protocol` and `rules`. A module of their own
   needs nothing beyond `ids.ts`.
5. **`protocol` and `schema` are not lane side.** `protocol` names 39
   conversation names (moves, places, intents, mentions): it is the wire
   for commands. Only `config` among the packages below rules is neither.
6. **The lane side is not the stabler half.** Since `1953d4ab` split
   core's index into modules (48 commits), 16 commits touched core's
   source: 8 touched lane-side modules, 14 conversation modules, 6 both;
   24 file changes against 42, about the lines' 39 to 61. Over core's
   whole history (133 commits), tree.ts alone changed 66 times, but most
   modules only exist since the split, so the longer count is not a fair
   comparison. A package of the lane side would not depend on something
   measurably steadier.

## How it was measured

`census.ts` (in `docs/findings/S285-core-census-by-side/`) is S252's
census generalized: it builds the root `tsconfig.json`'s program with
TypeScript 5.9's compiler API (installed outside the repo, since
TypeScript 7 has none), follows every identifier in the workspace to its
symbol, aliases resolved, and records which units name each export of a
package's entries (source and tests apart), and the package's own module
graph, value and type imports apart. `analyze.ts` groups core's exports by
side and computes the closures; `analysis.txt` is its output at
`ab304649cc02`. The closure with the cuts in item 3 was computed from the
same census, with those four imports removed and the eight names left out
of the lane side's starting set. Churn is `git log` over core's source,
tests, `index.ts` and `fixtures.ts` left out.
