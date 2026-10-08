# WS2 — TypeScript migration

> **Later:** `scripts/check-boundaries` was deleted in
> `PLAN-2026-09-25-apps-and-packages`. Boundaries are enforced by module
> resolution; see `docs/01-architecture.md`.

> **Superseded in part by ADR-0015.** `StoredEntry` no longer exists: the type
> is `EntryWithoutSeq` and uses a *distributive* omit, because `Omit` over
> pi's `Entry` union silently collapsed it to the common keys. The stored shape
> is now `StoredEntryRow`, a typed Kyneta row. See
> `S17-typed-entries.md`.

**Date:** 2026-09-24 · **Repo:** `~/halecraft/pinetrie` (working copy, not committed)
**Node:** v24.19.0 (native type stripping — no `tsx`, no build step)
**TypeScript:** 5.9.3, `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`

---

## 1. VERDICT

**ALL modules converted. `typecheck` clean, `verify` green, and the real-browser
check passes on the TypeScript build.**

| # | module | files | status |
|---|---|---|---|
| — | `core/` | 1 | done before this run (the worked example) |
| 1 | `schema/` | 1 | ✅ |
| 2 | `protocol/` | 2 | ✅ |
| 3 | `client/` | 2 | ✅ |
| 4 | `host/` | 2 | ✅ |
| 5 | `e2e/` | 2 | ✅ |
| 6 | `test/` | 1 | ✅ |
| 7 | `scripts/` + `conformance/` | 4 | ✅ |
| 8 | `storage/` | 4 | ✅ (incl. the 638-line adapter) |

19 `.ts` files. The only remaining `.mjs` is `vitest.config.mjs`, left alone
deliberately — it is Vitest's own config entry, not project source.

**Storage was NOT left for last as briefed.** `host/index.ts` imports
`createAgent`/`newId` from `storage/`, so `host` could not typecheck until
`storage` had types. I converted `storage` at step 4 instead. Everything still
went one module at a time with `verify` green in between.

---

## 2. Commands and real output

```
$ pnpm run typecheck
> tsc --noEmit
(no output — exit 0)
```

```
$ pnpm run verify
Checked 24 files in 15ms. No fixes applied.     # biome
check: ok — all boundary rules hold              # boundaries
sanity: ok                                       # build guards
 Test Files  1 passed (1)
      Tests  11 passed (11)                      # vitest
  TOTAL: 21/21 passed, 0 failed                  # pi conformance (kyneta)
  TOTAL: 21/21 passed, 0 failed                  # pi conformance (memory control)
=== e2e: pass=16 fail=0 ===
=== VERIFY EXIT: 0 ===
```

```
$ pnpm run build:client
built client/app.bundle.js                       # 771463 bytes
  loro-crdt 1.16.1
  wasm from …/loro-crdt@1.16.1/…/bundler/loro_wasm_bg.wasm
```

esbuild took the `.ts` entry point with no config change.

**`e2e:live` (real model):** `pass=20 fail=0`, model emitted `PINETRIE-OK`.

**`e2e:browser` — a Playwright server WAS listening on 3100, so I ran it:**

```
  browser : 141.0.7390.37
  PASS  page loaded, wasm instantiated, client connected to the host
  PASS  no page errors during load
  PASS  lane carries writer identity, not "main": w-01a0d573-20e2-7008-bbb2-431bce085e85
  PASS  streaming text appeared in the DOM while the turn was running
  PASS  assistant reply rendered in the DOM
  PASS  transcript ordered by parentId walk: [user, assistant]
  PASS  no page errors overall
=== browser e2e: pass=7 fail=0 ===
```

---

## 3. Types that encode an ADR invariant

This is the point of the migration, not the syntax change.

### Carried through from `core/` into the boundaries

- **`LaneName` (ADR-0011)** now flows end to end. `RunningHost.laneName` and
  `CreateAgentOptions.laneName` are typed `LaneName`, not `string`. Since only
  `laneNameForWriter()` can mint one, passing `"main"` into `createAgent` is a
  compile error, not a runtime hazard. The brand previously stopped at `core/`'s
  edge; it now reaches the pi adapter.

- **`LocalSeq` / no-seq-on-the-wire (ADR-0013)** is enforced three ways:
  - `protocol/messages.ts` declares `Command` and `Reply` as exact interfaces
    with no `seq` field, so adding one breaks every call site.
  - `schema/index.ts` has no seq in the document shape at all.
  - `projectTranscript(entries, tipId)` still cannot accept a seq — ordering is
    structural, from the `parentId` walk.

### New in this run

- **`SessionDocHandle` (`schema/index.ts`)** — `ReturnType<typeof newSessionDoc>`,
  derived from the schema value rather than hand-written. Verified that
  `exchange.get(id, SessionDoc)` produces the *identical* type, so host and
  client share one handle type and the doc shape stays the single source of
  truth. A drift in the doc shape now fails at compile time in both consumers.

- **`KynetaStorage implements Storage` (`storage/kyneta-storage.ts`)** — the
  single highest-value annotation in the migration. pi's own `Storage`
  interface now checks all eleven method signatures at compile time. The
  21-case conformance suite proves *behaviour*; this proves *shape*, and will
  catch a pi signature change on upgrade before the suite is even run.

- **`Agent` (`storage/pi.ts`)** — the facade host/ sees, now declared
  explicitly rather than inferred. Every member is a string, void, or a promise
  of our own shapes. "No pi type crosses this boundary" is now a checked
  property of the signature instead of a convention.

- **`InboundCommand` at the socket edge (`host/index.ts`)** — see §4.3.

---

## 4. What the type checker CAUGHT

Five real findings. Three are latent bugs that were live in the `.mjs`.

### 4.1 Reading an undeclared field on Kyneta's `Segment` — silent O(n) cliff

`storage/kyneta-storage`'s changefeed reconciler read `seg.key`:

```js
const field = segs[0]?.key                    // before
```

Kyneta's published `Segment` interface has **no `key`** — it declares
`role`, `resolve()` and `coord()`, and its own doc comment says to use
`coord()` for "identity `key`, schema/position walks". I confirmed at runtime
that the object *does* carry `key` (`{kind, key, dead, role, resolve, coord}`),
so the code worked — by depending on an implementation detail outside the
contract.

Failure mode had Kyneta ever stopped materialising it: `field` becomes
`undefined`, every remote change falls into the catch-all branch, and reconcile
degrades from **O(delta) to O(document)** on every sync. Slow, not wrong — so
nothing would have alerted us. Now uses the supported accessor:

```ts
const coord = segment.coord()
return typeof coord === "string" ? coord : undefined
```

### 4.2 `prompt()` reported `stopReason: "unknown"` on every single turn

```js
return { stopReason: result?.stopReason ?? "unknown" }   // before
```

`RunResult` is `Result<OperationResultRecord | SuspendedRun, LaneBusy | …>` —
a discriminated union `{ok:true,value} | {ok:false,error}`. **There is no
`stopReason` on any branch.** The `?.` and `??` meant it silently returned
`"unknown"` forever, including for failures. Nothing consumed it, so it was
invisible. Now returns the real terminal status and distinguishes rejection:

```ts
if (!result.ok) return { ok: false, status: `rejected:${result.error._tag}` }
return { ok: true, status: result.value.status }   // completed|declined|aborted|failed|suspended
```

(pi's errors are `TaggedError` classes discriminated by `_tag`, not `kind`.)

### 4.3 The wire type is looser than the contract type — untrusted input

`host` typed the inbound command as our own `Command` (with `kind: "prompt"`).
tsc rejected it: the Line schema `Schema.string(...["prompt"])` produces
`kind: string`, not a literal.

That is not a typing nuisance, it is the truth — the command arrives off a
socket and is **untrusted**. Typing it as our `Command` was a lie that only
compiled because the file was untyped. Now typed `InboundCommand` (core's
permissive shape), with `planCommand` doing the narrowing and rejecting
anything malformed. This is exactly the FC/IS gather→plan boundary.

### 4.4 The browser e2e never shut the host down

```js
await host.close?.().catch?.(() => {})      // before
```

`RunningHost` exposes `shutdown()`, not `close()`. Optional chaining made this
a permanent no-op, so the host and its websocket server leaked for the life of
the process. Now `await host.shutdown().catch(() => {})`.

### 4.5 A unit test was asserting against the wrong union branch

`test/core.test.ts` read `.code` off `planCommand(...)` directly.
`CommandDecision` is a discriminated union and `.code` exists only on the
`reject` branch — so on the `run` branch the test would have compared
`undefined` and still passed. Added a `rejection()` helper that asserts the
branch first. Same for `report.problems[0]`, which
`noUncheckedIndexedAccess` correctly flagged as possibly `undefined`.

### Bonus — a boundary hole that predates this run

`scripts/check-boundaries` walked only `.mjs|.js`. `core/index.ts` was already
converted, so **it was silently exempt from the architecture rules**, and every
module would have dropped out of enforcement as it converted. Fixed first, before
converting anything (now walks `.mts|.ts|.mjs|.js`, excluding `.d.ts` and
bundles). The `core -> — nothing —` line in the dependency map is now a verified
result rather than an artifact of scanning zero files.

---

## 5. Where I weakened a type, and why

Honest list. No `@ts-expect-error` and no non-null assertions anywhere.

1. **`as` at the untyped-substrate boundary (≈8 sites).** The doc stores
   entries/values/lists as `Schema.any()`, so the substrate genuinely cannot
   describe them. I confined the casts to named readers —
   `#readEntryRaw()`, `#readValueRaw()` — plus the two client/e2e read sites,
   rather than scattering them. Local interfaces (`StoredValueRecord`,
   `StoredListElement`, `StoredEntry`, `StoredUsageRow`) describe the shapes we
   own; `StoredEntry` is `Omit<Entry, "seq">`, derived from pi's type, which
   also documents ADR-0013 structurally.

2. **`asMapChange()` narrows a changefeed op with a local shape.** Kyneta's
   change algebra is broad and we only ever look at map `set`/`delete` keys.
   Restating the whole union would be worse. Uses `unknown` + narrowing, not `any`.

3. **`conformance/run-conformance.ts`: `factory: () => Promise<{storage: unknown} & AsyncDisposable>`.**
   The suite's fixture type is not exported, and the file loads pi by URL. The
   `unknown` is confined to that one local.

4. **`storage/pi-deep.ts` uses relative `typeof import(...)` paths.** pi's export
   map refuses these subpaths to the *type* resolver as well as the runtime one,
   so package specifiers do not work. `node_modules/@earendil-works/*` is a
   stable symlink, so this does not bake in a pnpm content hash — and the three
   deep imports are now **fully typed from pi's real `.d.ts`** instead of
   arriving as `any`. If pi moves one, it fails at compile time.

5. **Boundary checker taught a new spelling, not a weaker rule.** Those relative
   paths tripped the checker as "imports module `node_modules`". I made it
   classify a relative path into `node_modules/@earendil-works/*` **as a pi
   import**, so the "only storage may import pi" rule still applies. Verified
   with a negative control: adding that same import to `host/index.ts` fails
   with `reaches pi via a relative path … only storage/ may`. No rule was
   relaxed.

---

## 6. Residual unknowns; verified vs assumed

**Verified by execution:**
- `tsc --noEmit` clean (exit 0) on all 19 files.
- `pnpm run verify` exit 0 — biome, boundaries, sanity, 11 unit tests, 21/21
  conformance ×2, 16/16 e2e.
- `e2e:live` 20/20 against a real model; `e2e:browser` 7/7 in real Chromium
  141 with the TypeScript build.
- `build:client` produces a working 771 KB bundle from the `.ts` entry.
- Node 24 runs the mixed `.ts`/`.mjs` graph with no flags and no `tsx`.
- The boundary negative control still fires.
- Kyneta's runtime `Segment` really does carry `key` (probe), and `coord()`
  returns the same value — so §4.1 is a contract fix, not a behaviour change.

**Assumed, not verified:**
- That `KynetaStorage implements Storage` is *semantically* complete, not just
  structurally. The 21-case suite is the behavioural evidence; `implements`
  only proves shape.
- That the `as` casts at the substrate boundary describe what is really stored.
  They match what `KynetaStorage` itself writes, and conformance exercises the
  round trip, but nothing type-checks the doc's contents.
- That no pi type leaks through `Agent`. Every member is declared with our own
  shapes, but I did not exhaustively audit transitive type identity.
- `storage/` still imports `core/` (for `LaneName`). That was already permitted
  by the rules (`local: ["storage","schema","core"]`), but it is a new edge —
  the dependency map now reads `storage -> core/, kyneta, pi, schema/`.

**Not addressed:**
- `vitest.config.mjs` left as `.mjs`.
- The SRP note in `storage/pi.ts` still stands: this directory is really "the pi
  adapter", and would be more honestly named `pi/`.
- No runtime behaviour was intentionally changed except the three bug fixes in
  §4.1, §4.2 and §4.4. §4.2 changes `Agent.prompt`'s return shape from
  `{stopReason}` to `{ok, status}`; nothing consumed the old field.
