# S95 — how far the id brands reach, and what keeps them there

- **Status:** Answered

Numbered S71 until 2026-10-03, when two spikes held that number.

Measured in a lane (Linux, Node 24, TypeScript 5.9.3, Biome 2.4.8), for
`PLAN-2026-10-02-brand-ids-through-tree`. The type probes were edits to the
working copy, measured with `npx tsc --noEmit` and `npx biome lint`, then
reverted. The store probe read a copy of a working store's SQLite file.

**Answers.**

1. **A brand on the index's keys reaches every reader** (measured).
   With `TreeIndex.entries` typed `Readonly<Record<EntryId, EntryLike>>`,
   indexing it with a `string` is a compile error (TS7053: "expression of
   type 'string' can't be used to index type"). Changing only `EntryLike`,
   `TreeIndex` and `LaneView.tip` gave 141 errors, 38 of them outside tests:
   `core/tree.ts`, `core/asks.ts`, `reads/index.ts`, nine client files and
   `host/work/update.ts`. Fixing each one exposes the next layer, so the
   compiler walks the brand outward from the reads.
   - `Object.entries` and `Object.keys` give back `string`, so a
     `Record<EntryId, …>` is built and walked by each entry's own `id`
     (`Object.values`).
   - A `{ [k: string]: X }` is assignable to `Record<EntryId, X>`, so a test
     may still build one with `Object.fromEntries`; reading it back by a
     plain string is what fails.
   - A `Map<EntryId, X>`'s `get` refuses a `string`. A `string`-keyed map
     still accepts an `EntryId`, so a map left `string`-keyed compiles and
     leaves its lookups unchecked: a map's key type has to be changed on
     purpose.

2. **Biome can keep minting at the edges** (measured). `style/noRestrictedImports`
   with `paths: { "@pinetrie/core": { importNames: ["entryId", …] } }`, scoped
   by `overrides[].includes`, flagged exactly the files that imported a
   named minter, and no others: it reads parsed imports, not source text.
   `!` globs in `includes` exclude files, and two overrides may restrict
   different names in different directories (`biome.json`). It **cannot see
   a cast**: `id as EntryId` needs only the type, which every file may
   import.

3. **No stored lane name fails `isLaneName`** (measured on a read-only copy
   of a working store, 17,152 entries). Its `pi.branch.tip` values held 60
   lane names; all 60 pass `isLaneName`, and the stricter `parseNewLane`
   (`t-` and a lowercase uuidv7) too. No `lane` field of any stored record
   failed `isLaneName`. So checking lane names where they are read, and
   dropping those that fail, changes nothing for existing data.

4. **A held message's lane reached pi unchecked** (read in the source).
   `decodeHeld` cast its lane with `as LaneName` after checking only that it
   was a string; `planStartup` drains every held item's lane; `drainLane`
   appends through `agent.lane(lane)`; and `existing()` in `pi/agent.ts`
   finds any lane pi holds (`hasLaneRecord`). A held item for `"main"` would
   have been appended to a lane named `main`. Each decoder now checks its
   lane with `isLaneName`.

5. **A `tsc` run cannot name its failing check to `pnpm mutate`** (read in
   `scripts/mutate.ts`). `judge` matches a mutation's `expect` only against
   failing-check lines (`FAIL`, `×`, `AssertionError`), and `tsc` prints
   `file(line,col): error TS…`. A mutation whose command is `tsc` names no
   `expect`; with typecheck clean at baseline, any error is the mutant's.
   Biome's diagnostics start with `×`, so a lint mutation can name its
   message.
