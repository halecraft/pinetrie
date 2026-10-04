# S9 — Does pi's `IdGenerator` collide under concurrent multi-peer use?

**Status:** Answered.

## Brief

**Size:** S · **Depends on:** nothing · **Raised by:** S7 residual #7

**Question.** ADR-0009 makes id uniqueness safety-critical. S7 used its *own*
UUIDv7 implementation. pi ships an injectable `IdGenerator`. Does pi's produce
collisions across peers — same millisecond, same process, forked processes?

**Kill criterion.** Any collision path means we must supply our own generator
rather than use pi's default. Cheap to check, expensive to discover later:
failure is *silent data loss*.

## Report

**Date:** 2026-09-20 · **pi / pi-ai:** 0.85.0 · **Node:** v24.19.0 · **Sandbox:** `sandbox/s9-idgen`

---

## 1. VERDICT

**PASS — the kill criterion is not met. pi's default `IdGenerator` is safe for Pineta, and it is safe for a *structural* reason, not a statistical one: it is not stock UUIDv7 but a 41-bit strictly-incrementing counter, so two ids from one module instance can never collide at all (probability exactly 0, not 2⁻⁷⁴).** Cross-instance safety rests on a 40-bit CSPRNG seed plus 33 freshly-random bits per id = 2⁻⁷³ pairwise, within one bit of stock v7. 41 assertions, zero failures.

**The one boundary worth recording:** cross-instance safety degrades at ~10⁴ concurrent instances × 10⁶ ids each (expected collisions 5.3×10⁻³). That is far outside Pineta's plausible scale, and v1 is a single host process (ADR-0001/0007) where the probability is exactly zero.

---

## 2. What I ran

### Dependency wiring — **the dist-overlay fallback, not `link:`**

`link:` is pnpm/yarn syntax; npm rejects it outright:

```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "link:": link:~/halecraft/kyneta/packages/schema
```

So I used **S14 §2's documented fallback**: `npm install` the published 3.0.0 packages for valid semver metadata, then overlay the locally-built `dist/` trees (`schema`, `loro-schema`, `machine`, `changefeed`, `random`). `loro-crdt` pinned to `1.16.1`.

Mandatory sanity check, passing:

```
stepInPlace is a function : true
loro-crdt                 : 1.16.1 (>= 1.13.4 OK)
@kyneta/schema            : 3.0.0 (pkg.json says 3.0.0; dist overlaid from local)
pi uuidv7 importable      : true
sample id                 : 01a0bd1e-8930-747e-8e8e-10d8c2a7cb06
SANITY OK
```

Kyneta is only needed for step 7 (the end-to-end tie-back to ADR-0009); steps 1–6 test pi's generator directly.

### Files and timings

```bash
cd ./sandbox/s9-idgen && npm install --no-audit --no-fund
# then overlay local dists (see above), then:
  sanity                 exit=0     57ms
  step1-layout           exit=0     48ms  STEP1: pass=8  fail=0
  step2-inprocess        exit=0   3841ms  STEP2: pass=18 fail=0
  step3-fork             exit=0     71ms  STEP3: pass=4  fail=0
  step4-crossproc  256   exit=0    ~2.5s  STEP4: pass=6  fail=0
  step5-math             exit=0     30ms
  step6-volume     24 25000  exit=0 880ms STEP6: pass=1  fail=0
  step7-kyneta-e2e       exit=0   2116ms  STEP7: pass=4  fail=0
```

`decode.mjs` decodes an id into its three fields; `pi-uuid.mjs` imports pi's **real** module (and can load fresh instances via a cache-busting query).

### Read-only compliance

All work is confined to the sandbox. `~/halecraft/kyneta` is untouched — 0 files modified during the spike; `git status --porcelain` still lists exactly the 19-file `da978ec` working-copy set S14 recorded. No package-manager command ran there.

`~/.pi` shows recent writes, and they are **not mine**: they are the orchestrating pi session's own transcripts and subagent artifacts (`sessions/--Users-duane-tmp--/…`, `missions/…`) — i.e. pi recording *this* spike, which is why they contain the string `s9-idgen`. The spike scripts import exactly one pi module, `pi-ai/dist/utils/uuid.js`, which generates UUIDs and performs no I/O.

---

## 3. Evidence

### 3.1 The generator — located and quoted

Default wiring, `pi-agent-core/dist/harness/session/session.js:158`:

```js
this.idGenerator = options.idGenerator ?? { next: uuidv7 };
```

imported at `session.js:1`:

```js
import { uuidv7 } from "@earendil-works/pi-ai/utils/uuid";
```

The implementation, quoted in full from `pi-ai/dist/utils/uuid.js`:

```js
const MAX_UUID_V7_TIMESTAMP = 0xffffffffffff;
const MAX_SEQUENCE = (1n << 41n) - 1n;
let lastOrdinaryTimestamp = -1;
let sequence;
/** Generate a time-ordered UUIDv7. A supplied timestamp is preserved for follower ids. */
export function uuidv7(timestampMs) {
    const requestedTimestamp = timestampMs ?? Date.now();
    if (!Number.isInteger(requestedTimestamp) || requestedTimestamp < 0 || requestedTimestamp > MAX_UUID_V7_TIMESTAMP) {
        throw new RangeError(`UUIDv7 timestamp must be an integer between 0 and ${MAX_UUID_V7_TIMESTAMP}`);
    }
    const effectiveTimestamp = timestampMs === undefined ? Math.max(requestedTimestamp, lastOrdinaryTimestamp) : timestampMs;
    if (timestampMs === undefined)
        lastOrdinaryTimestamp = effectiveTimestamp;
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    if (sequence === undefined) {
        sequence =
            (BigInt(bytes[1]) << 32n) |
                (BigInt(bytes[2]) << 24n) |
                (BigInt(bytes[3]) << 16n) |
                (BigInt(bytes[4]) << 8n) |
                BigInt(bytes[5]);
    }
    else {
        if (sequence === MAX_SEQUENCE)
            throw new RangeError("UUIDv7 generator sequence exhausted");
        sequence++;
    }
    const timestamp = BigInt(effectiveTimestamp);
    for (let index = 5; index >= 0; index--) {
        bytes[index] = Number(timestamp >> BigInt((5 - index) * 8)) & 0xff;
    }
    bytes[6] = 0x70 | Number((sequence >> 37n) & 0x0fn);
    bytes[7] = Number((sequence >> 29n) & 0xffn);
    bytes[8] = 0x80 | Number((sequence >> 23n) & 0x3fn);
    bytes[9] = Number((sequence >> 15n) & 0xffn);
    bytes[10] = Number((sequence >> 7n) & 0xffn);
    bytes[11] = Number((sequence & 0x7fn) << 1n) | (bytes[11] & 0x01);
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}
```

**This is not stock UUIDv7.** RFC 9562 method 1 re-randomises 74 bits per id. pi's draws 16 random bytes but then **overwrites bytes 0–10 and the top 7 bits of byte 11** with a timestamp and a monotonic counter. The counter is module-level, seeded **once, lazily, on first call**, from exactly five CSPRNG bytes — and **never resets per millisecond**.

**Provenance checks.** Exactly one `pi-ai` copy exists under the pi install (0.85.0). The bundled build `dist/bundle/chunks/chunk-USJZMAIR.js` carries a semantically identical copy (`var MAX_SEQUENCE=(1n<<41n)-1n,lastOrdinaryTimestamp=-1,sequence;function uuidv7(timestampMs){…}`), so the TUI path behaves the same. `pi-agent-core/dist/index.js:1` re-exports it (`export { uuidv7 } from "@earendil-works/pi-ai";`).

### 3.2 Field layout — verified, not inferred

```
  PASS  decode+reencode is lossless (all 128 bits accounted for)
  PASS  version nibble == 7 for all
  PASS  variant == 0b10 (RFC 4122) for all
  PASS  sequence increments by exactly 1 per call (deltas observed: 1)

  2000 ids spanned 11 distinct millisecond(s)
  first: 01a0bd1f-2868-74e9-9a0e-bc3b00a37d91  seq=675065323037
  last : 01a0bd1f-2873-74e9-9a0e-cbd8fb9a698d  seq=675065325036
  PASS  all 2000 ids distinct
  distinct fresh33 values among 2000 ids: 2000
  PASS  the 33 fresh bits are re-randomised per call
```

The lossless re-encode is the load-bearing check: every one of the 128 bits is accounted for by exactly one of `{timestamp 48, version+variant 6, sequence 41, fresh 33}`.

Seeding across 40 fresh module instances:

```
    min = 39847508059
    max = 1088883149194
    2^40 = 1099511627776   2^41-1 (MAX_SEQUENCE) = 2199023255551
  PASS  40 fresh instances all seeded differently
  PASS  every seed < 2^40 (built from exactly 5 random bytes)
```

### 3.3 (a)(b)(d)(e) In-process — uniqueness is structural

```
=== (a) same process, tight loop, 1,000,000 ids ===
  generated 1000000 ids in 2526ms  (396/ms)
  distinct = 1000000
  PASS  zero duplicates in 1000000 ids
  busiest millisecond held 540 ids (sampled 200k) — ids routinely share a ms

=== (b) two generator INSTANCES in one process (the v1 architecture) ===
  PASS  two Sessions' default idGenerators share ONE function reference
  genA produced 100000, genB produced 100000, interleaved
  PASS  zero overlap between two interleaved in-process generators
  PASS  200,000 ids across both generators all distinct

=== (b2) two separate MODULE instances (worker_threads, dup node_modules) ===
  instance1 first seq = 984010985062
  instance2 first seq = 337018985757
  PASS  separate module instances seed independently (no shared counter)
  PASS  zero collisions across two independent module instances (100k ids)

=== (d) PINNED timestamp — every id forced into the same millisecond ===
  200,000 ids all generated with next(1700000000000)
  decoded timestamp of a sample: 1700000000000 (matches: true)
  PASS  zero duplicates with a fixed timestamp (counter alone guarantees it)
  PASS  supplying timestampMs still advances the shared sequence
  after pinning to 1700000000000, next ordinary id has ts=1789880206608
  PASS  a pinned past timestamp does NOT poison lastOrdinaryTimestamp

=== (e) does it derive from PID / hostname / process-start seed? ===
  PASS  source contains no "process.pid" / "pid" / "hostname" / "os." /
        "networkInterfaces" / "cpus" / "Math.random"
  PASS  randomness source IS "globalThis.crypto.getRandomValues" (CSPRNG)
```

**(d) is the decisive result.** 200,000 ids forced into a *single* millisecond, zero duplicates. Time contributes nothing to uniqueness; the counter does all the work. A stock v7 generator in the same test would rely purely on 74 random bits.

**(b) matters most for v1**: `genA.next === genB.next` — two `Session`s constructed without an explicit `idGenerator` literally share one function object and therefore one counter. Two harnesses in one host process cannot collide.

### 3.4 (b/fork) fork() after the parent has already seeded

The classic silent-duplication path. `sequence` is seeded **lazily on first call**, so the dangerous ordering is: parent calls `uuidv7()` *first*, then forks.

```
  parent pid=79521 seeded, first seq=544573099394
  forking 12 children... done
    pid=79522 seed=278123118934
    pid=79523 seed=216346303426
    pid=79524 seed=1093617451096
    pid=79525 seed=474040616854
    ... (12 total)
  PASS  all 12 forked children seeded DIFFERENTLY
  PASS  no child inherited the parent's already-initialised seed
  PASS  all 65 ids across parent+12 children distinct
```

Node's `child_process.fork()` starts a fresh V8 with a fresh module registry, so no module state crosses. **There is no POSIX `fork()`-without-`exec` path in Node**, which is what would actually duplicate a seeded counter.

### 3.5 (a/cross-process) 256 processes spawned simultaneously

```
=== (a) 256 processes spawned simultaneously ===
  PASS  all 256 seeds distinct
  PASS  all 768 ids distinct across 256 processes

  seed space          = 2^40 = 1099511627776
  min pairwise gap    = 21248065
  expected min gap    ~ 2^40 / C(256,2) = 33686018
  => a process would need to emit 21248065 ids before reaching its nearest neighbour's seed
  PASS  closest two seeds are >1e6 apart

  octile histogram (expect ~32.0 each): 31 26 33 37 30 34 26 39
  PASS  seeds populate all 8 octiles of the 2^40 space
  Pearson r(pid, seed)  = -0.0840   (n=256)
  PASS  no pid derivation (|r| < 0.3 at n=256)
  Pearson r(starttime, seed) = -0.0877
  PASS  no clock derivation in the seed
```

The observed min gap (21.2M) matches the uniform-random prediction (33.7M) to within a factor, and the octile histogram is flat — consistent with 40 uniform CSPRNG bits and nothing else. At n=64 the pid correlation read 0.25; at n=256 it collapses to −0.08, confirming the smaller figure was sampling noise.

**Practical reading of the min gap:** the two closest-seeded of 256 simultaneous processes would each have to emit ~21 million ids before their counters even *reached* one another — and even then a collision would additionally require the 33 fresh bits to match.

### 3.6 (c) The birthday arithmetic

Model derived from the source: two ids are equal iff timestamp, sequence, **and** the 33 fresh bits are all equal. Within one instance the sequence strictly increments, so collision probability is exactly 0. Across instances, seeds are uniform over 2⁴⁰, so for a specific cross-instance pair P(seq equal) = 2⁻⁴⁰ and P(fresh equal) = 2⁻³³ ⇒ **2⁻⁷³ pairwise**, assuming the worst case that both ids also share a millisecond.

```
=== field budget (128 bits) ===
  timestamp        48 bits
  version+variant   6 bits   (fixed: 0x7, 0b10)
  sequence         41 bits   (seeded from 40 random bits, then ++)
  fresh random     33 bits   (bytes[11] bit0 + bytes[12..15])
  total           128 bits   48+6+41+33 = 128 ✓

=== expected colliding pairs: E = C(P,2) * n^2 * 2^-73 ===
   P \ n |        10^4 |        10^6
  -------+-------------+-------------
       2 |    1.06e-14 |    1.06e-10
      10 |    4.76e-13 |     4.76e-9
     100 |    5.24e-11 |     5.24e-7
   10000 |     5.29e-7 |    0.005293

=== near-miss: P(some pair of instances has OVERLAPPING seed ranges) ~ C(P,2)*2n/2^40 ===
   P \ n |        10^4 |        10^6
  -------+-------------+-------------
       2 |     1.82e-8 |     1.82e-6
      10 |     8.19e-7 |     8.19e-5
     100 |     9.00e-5 |    0.009004
   10000 |      0.9094 |       1.000
```

**Both fields are load-bearing.** At 10⁴ instances the seed ranges are *likely* to overlap somewhere — the first line of defence fails — yet expected collisions stay at 5×10⁻³ because an actual collision additionally needs 33 matching random bits. Neither the seed nor the per-id randomness is sufficient alone at that scale.

Comparison with stock RFC 9562 UUIDv7 method 1 (48-bit ts + 74 random bits):

| | intra-process, same ms | cross-process |
|---|---|---|
| stock v7 | 2⁻⁷⁴ (**not zero**) | 2⁻⁷⁴ |
| **pi's** | **0** (counter) | 2⁻⁷³ |

pi trades one bit of cross-process entropy for *absolute* intra-process uniqueness. For Pineta that is the right trade, because v1 is one host process.

**Exhaustion headroom:** worst-case seed 2⁴⁰−1 against `MAX_SEQUENCE` 2⁴¹−1 leaves a guaranteed 2⁴⁰ ≈ 1.1×10¹² ids — 35 years at 1,000 ids/sec — and it **throws** rather than wrapping. Fail-loud, not silent reuse.

### 3.7 (d) Bounded brute force

```
=== 24 processes x 25000 ids = 600,000 ids ===
  running... done in 258ms
  total emitted = 600,000, distinct = 600,000, duplicates = 0
  PASS  zero duplicates across 600,000 cross-process ids
  sequence-range overlaps between processes: 0
  (step 5 predicts P(any overlap) ~ 1.26e-05 at this scale)
```

Consistent with the arithmetic; it can only fail to disprove it, which is why it ran last.

### 3.8 End-to-end against ADR-0009's actual failure mode

pi's real ids used as keys in S7's settled document shape, `Schema.record(Schema.struct.json({…}))`, two peers writing while partitioned:

```
=== two peers, pi's real uuidv7, 5000 entries each, written while PARTITIONED ===
  peer A wrote 5000, peer B wrote 5000 (no sync yet)
  after sync: docA has 10000 entries, docB has 10000
  PASS  no silent loss — all 10000 entries survived the merge
  PASS  zero id overlap between the two peers
  PASS  every entry's payload is distinct (nothing clobbered)

=== control: same doc shape, one DELIBERATELY reused key ===
  two peers wrote the SAME key; entries after sync = 1
  survivor text = "written by D"  (the other write is gone, no error)
  PASS  control reproduces ADR-0009's silent loss — so the test above is meaningful
```

Per S13's lesson, the control exercises the **same** configuration as the subject — same doc shape, same sync path, same generator — differing only in the reused key. It reproduces S7 §3.4's silent discard, which is what makes the 10,000-entry pass meaningful rather than vacuous.

---

## 4. Consequences for the plan

**Kill criterion NOT met. S9 resolves PASS.** No collision path was found. Pineta should **use pi's default generator** and must not replace it with anything weaker.

**ADR-0009 (entry id uniqueness) — upheld and now enforced by a verified mechanism.** The ADR says ids "MUST be unique and coordination-free." pi's default satisfies both: coordination-free (pure CSPRNG, zero network/PID/hostname input) and unique (structurally within a process, 2⁻⁷³ across). The ADR's note that pi's generator is "currently unverified (spike S9)" can be struck.

**ADR-0001/0007 (single host) is what makes this a non-issue for v1.** Within one host process every `Session` shares one counter (§3.3 b), so entry-id collision probability in v1 is **exactly zero**, not merely small.

**New hazard to record — the injection point, not the default.** `SessionOptions.idGenerator` is the danger, not `uuidv7`. S3 injected its own peer-tagged generator; anything Pineta injects must clear the bar established here: (i) no derivation from content, index, or position; (ii) ≥2⁻⁷⁰ pairwise cross-instance; (iii) strictly-increasing or otherwise structurally-unique within a process. Recommend adding to `04-roadmap.md`'s fitness functions: **assert that the configured `idGenerator` is pi's default unless a replacement has passed this bar.**

**Feeds `01-architecture.md`.** The line "Entry IDs are UUIDv7 — globally unique, time-sortable, coordination-free" is correct but understates it; suggest "UUIDv7-*shaped*: a 41-bit monotonic counter (seeded once per module instance from 40 CSPRNG bits) plus 33 fresh random bits — intra-process uniqueness is structural."

**A small bonus for S1.** `seq` is what S1 must dissolve. Note that pi's id counter is *already* the per-peer sequence S1 wants: `sequence` is monotonic per module instance and recoverable from any id via the decoder in `decode.mjs`. It is not a substitute for `seq` (it has no cross-peer total order), but it is a ready-made per-peer ordering key, and `(timestamp, sequence)` is monotonic within a writer. `decode.mjs` is worth keeping for S1.

**Spawns nothing.**

---

## 5. Residual unknowns (NOT resolved)

1. **No real `Session`/`AgentHarness` was instantiated.** I verified the default wiring by source quote (`session.js:158`) and by function identity (`genA.next === genB.next`), not by constructing a `StorageBackedSession`. If some higher layer injects an `idGenerator`, this spike does not see it. **I did not audit pi for injection sites.**
2. **`worker_threads` not tested directly.** Modelled via fresh module instances (§3.3 b2), which is the same mechanism (separate module registry), but the actual worker path — including whether each worker's `crypto` is independently seeded — was not exercised.
3. **VM/container image cloning and V8 startup snapshots.** If a process image is cloned *after* the first `uuidv7()` call, both clones inherit the same `sequence`; if the userspace CSPRNG state is also cloned and not reseeded, ids could be identical. This applies equally to stock UUIDv7 and to essentially any RNG-based scheme, so it is not a pi-specific defect — but it is the one genuine "unsafe under condition X". Mitigating: `sequence` is seeded **lazily**, so a snapshot taken before any id is generated is safe.
4. **`globalThis.crypto.getRandomValues` is assumed to be a proper CSPRNG.** Node delegates to OpenSSL; not audited here.
5. **`MAX_SEQUENCE` exhaustion never exercised.** The `RangeError` path is read from source, not triggered.
6. **The birthday arithmetic assumes independent uniform seeds** over 2⁴⁰ and ignores the timestamp field entirely (conservative — real timestamps add separation). The uniformity is supported by §3.5's octile histogram at n=256, not proven.
7. **Largest cross-process volume was 600k ids over 24 processes.** The 10⁴-instance regime in §3.6 is arithmetic only.
8. **`lastOrdinaryTimestamp` under clock skew** (NTP step-back) was not tested. It clamps monotonically for ordinary calls, which affects *ordering*, not uniqueness.

---

## 6. Verified vs assumed

**Verified by execution:** the field layout, via lossless decode→re-encode over 2,000 ids; sequence increments by exactly 1 per call; 1,000,000 ids in one process with zero duplicates; 200,000 ids on a single pinned timestamp with zero duplicates; `genA.next === genB.next` for two default-constructed generators; 40 fresh module instances all seeded differently and all seeds < 2⁴⁰; 12 forked children seeded differently with none inheriting the parent's seed; 256 simultaneous processes with distinct seeds, flat octile histogram, r(pid)=−0.084, r(starttime)=−0.088; 600,000 cross-process ids with zero duplicates and zero sequence-range overlaps; 10,000 entries across two partitioned Kyneta peers with no loss; the deliberate-duplicate control reproducing silent loss; and the sanity gate (`stepInPlace` present, loro-crdt 1.16.1).

**Verified by source reading, quoted at file:line:** the default wiring `session.js:158` and its import at `session.js:1`; the full `uuidv7` implementation; the absence of pid/hostname/os/Math.random tokens; the re-export at `pi-agent-core/dist/index.js:1`; the semantically identical bundled copy in `chunk-USJZMAIR.js`; exactly one `pi-ai` copy (0.85.0) under the pi install.

**Assumed, not verified:** that `crypto.getRandomValues` is cryptographically sound; that no pi code path outside `harness/session` injects a non-default `idGenerator`; that fresh-module-instance semantics faithfully model `worker_threads`; that seeds are independent and uniform (supported by the histogram, not proven); that 2⁻⁷³ pairwise generalises to the 10⁴-instance regime, which was computed rather than measured.

**Explicitly not claimed:** that pi's generator is immune to VM-image cloning (§5.3); that it is stock RFC 9562 UUIDv7 (it is not); that the observed min seed gap is a guarantee rather than a sample.

## Review

**Verdict:** PASS — safe *structurally*, not statistically

41 assertions, zero failures.
Independently re-verified: the pinned-millisecond test, the fork test, and the
end-to-end ADR-0009 test with its control.

- **pi's `uuidv7` is not stock RFC 9562.** A 41-bit monotonic counter (seeded
  once per module instance from 40 CSPRNG bits, never reset per ms) + 33 fresh
  bits. Intra-process collision probability is **exactly 0**, not 2⁻⁷⁴.
- **Answered "why is it safe", not "no collisions in N trials"** — which is what
  the brief demanded, and it ran the brute-force volume test *last*, noting it
  "can only fail to disprove" the arithmetic.
- **Imported pi's real module** rather than reimplementing it, and verified the
  bundled TUI copy is semantically identical.
- **Proved the field layout** by lossless decode→re-encode over 2 000 ids — all
  128 bits accounted for — before drawing any conclusion from it.
- **Distinguished sampling noise from signal:** r(pid, seed) read 0.25 at n=64,
  so it re-ran at n=256 where it collapsed to −0.08.
- **Checked its own read-only compliance carefully**, and correctly identified
  recent `~/.pi` writes as the *orchestrating* session's own transcripts rather
  than its doing.
- Spawns nothing. Bonus for S1: pi's per-id `sequence` is already a per-peer
  monotonic ordering key, recoverable via its `decode.mjs`.
