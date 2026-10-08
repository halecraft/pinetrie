# S25 — the session document on `json.bind`

- **Status:** Answered
- **Led to:** ADR-0023

**Answers.**
1. **The session document runs on `json.bind` with no other change.** Switching
   `SessionDoc` from `loro.bind` to `json.bind`, and `batch` from
   `@kyneta/loro-schema` to `@kyneta/schema`, left every gate green: unit
   167/167, pi's storage conformance 21/21 twice, e2e 91/91, e2e:live 94/94,
   the real browser 49/49 with no page errors, and the build.
2. **The browser no longer loads Loro:** 466 kB of JS (142 kB gzipped), against
   578 kB of JS and 3,240 kB of wasm (about 1,235 kB gzipped) on Loro.
3. **Writes cost about the same.** The e2e tool run grew the store 314 KB on
   `json`, against 287 KB on Loro, for 82 KB printed.
4. **The plain substrate's in-memory op log grows until `compact()`, which trims
   it.** 5,000 text edits left 2.65 MB of log that `exportSince` could still
   serve, and 21 MB more heap. After `compact()` the log was gone, the heap back
   to its start, and a client behind the new base receives the whole document
   (S24).

## Why it was asked

S24 found that an authoritative document compacts live on `json.bind`, and
pine·trie's session document is written only by the host. Before deciding, it had
to be measured whether the session document runs on the plain substrate at all:
pi's storage semantics, streaming, persistence, the browser; and what the plain
substrate keeps in memory.

## Result

The change, in a spike revision:
- `packages/schema/index.ts`: `json.bind` instead of `loro.bind`; `batch` and
  `createDoc` from `@kyneta/schema`;
- `packages/pi/storage.ts`: `batch` from `@kyneta/schema`.

It type-checks unchanged. `KynetaStorage`'s changefeed paths, the typed entry
row (ADR-0015), streams as text edits (ADR-0022), the restart over a SQLite
store, and the browser all work as they did.

| gate | Loro | json |
|---|---|---|
| unit | 167 | 167 |
| conformance | 21/21 ×2 | 21/21 ×2 |
| e2e | 91 | 91 |
| e2e:live | 94 | 94 |
| e2e:browser | 49 | 49 |
| browser bundle, gzipped | about 1,235 kB (with wasm) | 142 kB |
| store growth for the e2e tool run | 287 KB | 314 KB |

**A check was measuring nothing on `json`.** The e2e store-growth check summed
`length(blob) + length(payload)` over the store's records. The plain substrate
stores records as text, so `blob` is NULL, the SQL sum is NULL, and the check
read 0 KB and passed. It now uses `coalesce`, and measures 314 KB.

**The op log.** In `packages/schema/src/substrates/plain.ts` (Kyneta), the log is
spliced only by `advance()`, which `compact()` calls. Measured on a live
document with 5,000 edits to a 50 KB tail-kept text:

| | retained log | heap |
|---|---|---|
| before | 2,653 KB | 10 → 31 MB |
| after `compact()` | none (entirety only) | 11 MB |

## Consequences

1. **Moving the session document to `json.bind` is a small change, and
   compaction becomes a requirement, not an optimization.** Without it, both the
   store and the host's memory grow with every edit. A policy is needed: when to
   compact (for example after a run ends, above a size, or when idle).
2. **Compaction's cost moves to reconnecting clients.** A client behind the base
   receives the whole document once. For a session, that is its current
   conversation, not its history.
3. **One host is the session's only writer.** That is already true; on `json` it
   becomes a rule. A second host would be a replica.
4. **ADRs to revise:** ADR-0008 (Loro history as infrastructure), ADR-0016
   (racing lazily created containers: moot with one writer, harmless to keep),
   and the environment gate's Loro floor, which the host no longer needs.
   Existing `.pinetrie/pinetrie.db` stores are Loro and cannot be opened: start a new
   file.

## Method

The real code, switched in a spike revision and run through every gate. A
disposable probe for the op log, on a live `json` document in a Kyneta
`Exchange`. The Loro bundle size was measured by switching back and building.
