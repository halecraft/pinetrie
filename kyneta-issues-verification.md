# Verification addendum — the three reported issues, re-tested on latest local build

**Date:** 2026-09-20 · **Build:** local workspace at `63f95c0`, dist current (no `src/*.ts` newer than its `dist/index.js` in `schema`, `loro`, `exchange`, `machine`) · `loro-crdt` 1.16.1 · Node v24.19.0

Companion to `kyneta-compact-loro.md`, `kyneta-line-schemahash-collision.md`, `kyneta-ephemeral-wire-cost.md`.

| # | Issue | Status |
|---|---|---|
| 1 | `compact()` throws on live Loro docs | ❌ **unchanged** |
| 2 | `Line.protocol` identical-schema collision | ✅ **fixed at the root** |
| 3 | Ephemeral wire cost | ⚠️ **fixed for the multi-leaf case; our shape is untouched** |

Also confirmed still-fixed from the previous round: **ephemeral `merge()` notifies subscribers** (`e0a9ec9`). `subFires` is 94/94 for both ephemeral conditions in the streaming test, where both were 0.

---

## 1. `compact()` on a live Loro substrate — UNCHANGED ❌

```
compact(d:loro): THROWS -> advance() on a live Loro substrate is not yet supported.
                           Use advance() on a LoroReplica instead.
compact(d:json): OK
```

The stub at `packages/schema/backends/loro/src/substrate.ts:356` is as reported. The questions in the original doc stand — chiefly whether this is unfinished plumbing (given `LoroReplica.advance()` looks complete) or is masking genuine unsoundness, since `advance()` replaces `currentDoc` while readers close over the backing doc.

This remains the one with a concrete cost to us: ~9.6 KB of unreclaimable op-log per streamed message.

---

## 2. `Line.protocol({client, server})` identical schemas — FIXED ✅

**Fixed at the root, which was the best of the three options the original doc floated.** The change is not a guard in `Line` — it is the registry rule. `line.ts` now reads:

```ts
// Symmetric protocols share one BoundSchema between the directions;
// asymmetric ones bind each. Two binds of structurally identical schemas
// are interchangeable and need no special handling here — `exchange.get()`
// compares what a schema can read, not which object the caller held.
```

That is suggestion #3: reference equality was the wrong check. The asymmetric branch additionally reuses the client bind when the two schemas are the *same object* (`serverSchema === clientSchema ? clientBound : json.bind(…)`).

**Verified** — a Line declared with structurally identical `client` and `server` schemas now opens and carries traffic:

```
ISSUE 2 — asymmetric IDENTICAL schemas, sender+receiver created: OK (no collision)
send(): OK
```

**Unrelated note for consumers:** the Line API was renamed in the same window — `open()` → `sender()`, `listen()` → `claimReceiver()`, plus a new `manager()`. Our first re-test failed with `p.open is not a function`. Worth a CHANGELOG line if it doesn't have one.

---

## 3. Ephemeral wire cost — FIXED FOR THE ROSTER SHAPE, NOT FOR OURS ⚠️

`6cbaff4 feat(schema,exchange)!: ephemeral sync ships what changed` does what it says, and we can confirm the headline claim independently. But **it does not address the shape our report was about**, and the distinction is worth stating precisely because the two are easy to conflate.

### The fix works, measured

200-leaf roster, one leaf changed per update:

```
ROSTER: 200 leaves, one leaf changed per update
  roster   20 updates ->  2850 bytes        (142 bytes/update, flat)
```

That matches the commit message's *"It now costs 150, and stays flat as the roster grows."* ✅

### Our shape is unaffected, and still quadratic

One leaf whose value grows ~29 chars per update:

```
ACCUM: 1 leaf, value grows by ~29 chars per update
  accum    20 updates ->    8655 bytes
  accum    40 updates ->   28925 bytes      (×3.34)
  accum    80 updates ->  104265 bytes      (×3.60)
```

**≈×4 per doubling — still O(n²).** And the real streaming benchmark is unchanged from the pre-fix figures:

| condition | before | after |
|---|---|---|
| A durable list | 20 348 | 20 348 |
| **B ephemeral, accumulated text** | 139 643 | **143 162** |
| C ephemeral, newest delta only | 13 602 | 17 121 |

### Why — and why this is arguably correct

"Ships what changed" means **which leaves changed**, not a diff *within* a leaf. A leaf is `[value, timestamp, installedAt, deleted?]` and the unit of transmission is the leaf. When the single leaf's value is the growing string, the whole leaf genuinely did change, so the whole value ships. Delta granularity is per-key, and our value is one key.

That is a defensible boundary — intra-leaf diffing would mean a delta format per value type, which is what the durable substrates are for. **We are not asking for it.** The original doc framed this as a design consequence rather than a defect, and that framing survives the fix.

### What it means for us

Unchanged: our mitigation is a **windowed tail** — cap the ephemeral value at the last N characters and reconcile the full text from the durable committed entry. That bounds bytes per update and keeps hydration correct inside the window.

The open questions from the original doc narrow to one: **is a bounded/windowed presence value something you would want to support at the schema level** (e.g. "keep last N"), or is it firmly application territory? Given that "ship what changed" is now per-leaf, an application that wants bounded cost for an accumulating value has to either window it or shard it across leaves — and the second is an awkward encoding.

A doc-comment pointing this out would likely have saved us the measurement: the header now says "incarnation" rather than "snapshot-only" (`63f95c0`), so the old signal that updates ship whole values is gone, while the per-leaf granularity of the new behaviour is not obvious from the outside.

---

## Reproduction

All probes are in `<pineta>/sandbox/s4-transport/`, wired to the local workspace by symlink (`relink.sh`; note `npm install` deletes the symlinks):

```bash
node smoke.mjs              # sanity: stepInPlace present, loro-crdt 1.16.1
node e2-streaming.mjs       # the three streaming conditions, byte counters on the socket
node probe-shapes.mjs 20    # roster (many leaves) vs accum (one growing leaf); arg = update count
node probe-ephemeral2.mjs   # ephemeral local vs remote subscribe, with a json control
```
