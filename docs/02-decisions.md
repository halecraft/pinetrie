# Decisions (ADRs)

Format: Context / Decision / Consequences / Alternatives rejected.
Superseded ADRs are marked in place, never deleted — the rejected reasoning is
the valuable part.

---

## ADR-0001 — Embed `pi-agent-core`; do not use chord or the experimental server

**Status:** Accepted

**Context.** pi 0.85 is mid-rewrite into a distributed architecture:
coordinator → replaceable server → one worker process per session → N attached
clients, with a Radius relay for remote. It is real and it works (verified by
running it). But it is hidden behind `PI_EXPERIMENTAL=1`, undocumented, absent
from the CHANGELOG, and moves in lockstep across seven packages. Its state
replication (`chord.ReplicatedState`) is single-authority, which is precisely
what we need to replace.

**Decision.** Embed `@earendil-works/pi-agent-core` directly in our own Node
host. Do not depend on chord, `pi-server`, `pi-client`, the coordinator, or the
session worker.

**Consequences.** Fewer moving parts; no dependency on an unreleased hidden API;
we own the replication boundary. We forgo pi's session/plugin plumbing and its
presentation-plugin system, and must build host lifecycle ourselves.

**Alternatives rejected.** *Build on the experimental server* — we would inherit
a single-authority replication layer and then fight it. *Fork pi wholesale* —
unbounded maintenance against a fast-moving project.

---

## ADR-0002 — Kyneta is the storage of record; JSONL becomes an exporter

**Status:** Accepted

**Context.** Initially framed as "dual-write to pi's v4 JSONL for interop, or
single-write to Kyneta and fork the ecosystem." Investigation showed the second
horn is wrong (see ADR-0003): the ecosystem binds to the *lane/session API*, not
the file format.

**Decision.** Single-write to Kyneta. Provide a v4 JSONL **exporter** if
interchange is needed.

**Consequences.** Lost: session *interchange* — terminal `pi` cannot `/resume`
or `/tree` our sessions; `pi-acp`/Zed cannot see them; `--fork`, `/export`,
`/share`, and session pickers are path-based. Kept: skills, extensions, prompt
templates, MCP, subagents, compaction, providers — everything that is actually
the moat. An exporter is far cheaper to maintain than two live write paths.

**Alternatives rejected.** *Dual-write* — two live write paths that must agree,
for a benefit (TUI interop) we do not need in v1.

---

## ADR-0003 — Implement pi's `Storage` port rather than forking session internals

**Status:** Accepted

**Context.** `pi-agent-core` exposes `interface Storage` (10 methods) at
`harness/session/types.d.ts:386`, ships a conformance test suite, and already
has multiple implementations (jsonl, in-memory, gating, instrumented,
benchmark). `IdGenerator` is injectable too. Third-party backends are an
expected extension point, not a hack.

**Decision.** Write `KynetaStorage implements Storage`. Validate against pi's own
conformance suite in CI.

**Consequences.** `Storage` becomes our single deep coupling to pi — the surface
to watch on upgrade. If we also bind to `AgentLane` internals, that surface
doubles; avoid. Correctness is checkable against someone else's tests, which is
unusually good leverage.

**Alternatives rejected.** *Fork `session-manager`* — that is the legacy
pre-v4 path being replaced. *Project Kyneta from JSONL* — leaves a file as
source of truth under a CRDT, defeating the purpose.

---

## ADR-0004 — Entries are immutable; merges are additive nodes with a second parent

**Status:** Accepted

**Context.** pi's v4 model is already append-only with UUIDv7 IDs and
`parentId`. Immutability is what makes structural convergence trivial and
reference anchors permanently stable.

**Decision.** Never mutate a committed entry. A fold produces a **new** entry
carrying `fromId` alongside `parentId`. Allow `fromId` in the schema from day
one even though v1 creates none.

**Consequences.** Provenance, re-foldability, double-fold detection, and a
"landed" signal come free. Retrofitting a second parent edge later would be
painful; allowing it now costs one optional field. Text spans into entries need
no CRDT cursor.

---

## ADR-0005 — Summarization is lazy and destination-aware

**Status:** Accepted

**Context.** pi generates `BranchSummaryEntry` on *leaving* a branch — it
summarizes without knowing where the summary will land, and destroys the raw
material in the process.

**Decision.** Do not pre-summarize. At fold time, pass the LLM a three-way
structure (base = LCA sent once; `theirs` = folded leg; `ours` = destination
leg) and ask for a summary useful *at the destination*. Fall back to
compaction only under token pressure.

**Consequences.** Strictly more information at the moment of judgement; full
optionality preserved (re-fold differently, or into a different leaf). Cost:
fold is an LLM call — nondeterministic, non-idempotent, and potentially large.
The UI must tolerate two concurrent folds producing two valid merge nodes.

**Confirmed empirically by S5** (`findings/S5-fold-quality.md`). The ablation is
the evidence: the labelled three-way partition beat both `theirs`-only and the
same bytes unlabelled — and the unlabelled variant was the *worst* of the three.
The lift comes from the structure, not from model strength.

---

## ADR-0010 — A fold is destination-relative; the `ours` leg is mandatory

**Status:** Accepted (from S5)

**Context.** S5's ablation A ran the fold with only the `theirs` leg. The output
was not a *degraded* fold — it was **confidently wrong**, recommending a design
the destination had already considered and rejected, with no conflict detected.
Ablation B (all three legs, unlabelled) was worse still: it could not tell
destination from exploration and ended in state confusion.

**Decision.**

1. A fold node is valid **only relative to the destination it was folded into**.
   It is *not* a property of the source branch. The same branch folded at two
   destinations yields two different — and correctly different — summaries.
2. The `ours` leg is **mandatory**. The budget ladder (raw → per-leg compaction
   → branch summary) may compact `ours`, but may never drop it.
3. The legs must be **explicitly labelled** as base / ours / theirs. Passing the
   same content unlabelled is measurably worse than passing less.

**Consequences.** Dropping `ours` under budget pressure is a **correctness**
regression, not a quality one — state this in the ladder design. The UI must
never present a merge node as belonging to the source branch; it belongs to the
edge. Re-foldability (ADR-0004) is therefore not a nicety but a consequence of
the semantics.

**Alternatives rejected.** *Summarise the branch standalone and attach it
anywhere* — cheaper and cacheable, but ablation A shows it produces confident
errors about the destination's decisions.

---

## ADR-0006 — References live in their own namespace

**Status:** Accepted

**Context.** "Annotation" was too small a frame. What is wanted is a *pointer*:
a conversation should be able to reference anything discussed — a span of an
earlier message, a file range, an image region, a URL, another branch.

**Decision.** A discriminated union of reference kinds, stored in a dedicated
namespace rather than as fields on entries.

**Consequences.** Backlinks are queryable in both directions for free. Two
orthogonal graphs over the same nodes: `parentId` is causal, references are
semantic. New reference kinds are additive. Anchor stability splits by target
mutability (entries: stable offsets; files: content-addressed; composer: Loro
cursors).

---

## ADR-0007 — Host↔client transport is a Kyneta Line plus replicated docs

**Status:** Accepted

**Context.** `pi-client` ships unix transport only — there is no browser path in
pi. Kyneta already has `Line` (`packages/exchange/src/line.ts`): a reliable
bidirectional message stream over two authoritative docs with seq numbering and
ack-based pruning, plus websocket/SSE/WebRTC/unix transports.

**Decision.** Commands (prompt, steer, abort, fold) travel over a Kyneta Line.
State (entries, tips, presence) is replicated documents. No bespoke protocol.

**Consequences.** CQRS split, mirroring the shape pi's own experimental stack
arrived at (`AgentController` for commands, `Transcript` for state) — but with a
convergent rather than single-authority state layer. Removes the last reason to
keep chord. Remote/team networking becomes a transport swap.

**CONFIRMED by S4** over a real websocket: all 7 command kinds round-trip in
order, **p50 1.67 ms**, ~1 050 commands/sec, 2 000 commands with **1.01×**
outbox growth (ack-pruning works). Structured rejections survive the wire, as
does the ADR-0011 lane name.

**New constraint from ADR-0013:** transcript events carry `seq`, which is
**replica-local**. Clients must treat it as an opaque ordering key, never a
durable identifier.

---

## ADR-0014 — Token deltas ride the DURABLE document, not ephemeral presence

**Status:** Accepted for v1 (from S4). Revisit when the notification defect is
fixed. **Corrected post-review** — one supporting claim was retracted; the
decision stands on the remaining two.

**Context.** The open question in ADR-0007 was whether high-rate streaming
(`text_delta`) should use ephemeral presence — cheap, no history — or the durable
replicated doc. The expectation was presence. S4 measured a **real** captured pi
stream (94 deltas, 2 702 chars, **202.6 deltas/sec** — 4× the 50/s assumed)
replayed identically across three conditions.

| | A durable list | B ephemeral-accum | C ephemeral-delta |
|---|---|---|---|
| reactive notification | **94/94** | **0** ✗ | **0** ✗ |
| delta coverage | **100 %** | 98.9 % | 98.9 % |
| **connected** client renders exactly | **yes** | yes | ~~no — 2701/2702~~ — **harness bug, retracted** |
| mid-stream joiner renders exactly | **yes** | yes | **no — 1260/2702** ✗ (real) |
| live wire bytes | 20 348 | 139 643 (6.9×) | 13 602 |
| permanent history residue | **9 585 B** ✗ | none | none |

**Decision (REVISED — see correction below).** Stream token deltas into a durable
**`Schema.text()`** via `insert(at, delta)`, cleared on commit.

> ## ✅ CORRECTION — we had the wrong primitive, not the wrong substrate
>
> The table below blames ephemeral/snapshot-only for a quadratic wire cost.
> **That diagnosis is wrong.** Re-measured on the same stream (94 deltas,
> 2 702 chars):
>
> | shape | live wire bytes |
> |---|---|
> | **durable `Schema.text()`** | **18 131** |
> | durable `Schema.list()` | 18 174 |
> | **durable `Schema.string()` (LWW)** | **144 582** |
> | ephemeral `Schema.text()` | *unsupported by design* |
> | ephemeral `Schema.string()` | 140 490 |
>
> The decisive row is **durable `Schema.string()` at 144 582** — the *durable*
> substrate is just as quadratic. So the cost was never a property of ephemeral
> or of "snapshot-only"; it is a property of **accumulating into a whole-value
> LWW register on any substrate**. Conditions B and C both used
> `Schema.string()`, which is why both looked bad.
>
> **`Schema.text()` is a text CRDT: `insert(at, delta)` ships only the inserted
> characters.** It gives linear wire cost, exact mid-stream hydration, and
> reactive notification simultaneously — no windowing, no sharding, no
> disposable-doc trick needed for the *wire* problem.
>
> Ephemeral's refusal is deliberate and clearly explained: *"It keeps one
> timestamped tuple per leaf and decomposes only structs and records, so an
> ordered or counted container has no shape here."* Presence is for small
> replaced values; it was never the right home for accumulating text.
>
> **Residual (late-joiner download after commit):** `text` 11 436 B vs `list`
> 11 734 B vs never-streamed control 5 834 B — so ~5.6 KB residue per message,
> not the 9.6 KB originally recorded, and `text` is marginally better than
> `list` on both axes. Residue remains attributable solely to `compact()` being
> unavailable on Loro docs.
>
> **Lesson worth keeping:** we measured three *encodings of one primitive* and
> concluded something about the *substrate*. Before reporting a cost as a
> library property, check whether the library has a better-fitting type.

**Why, in order of weight.**

1. **The doc layer is not saturated.** At 4× the real rate: 100 % coverage,
   p50 1.78 ms. The kill criterion anticipated saturation; it did not occur.
2. **Ephemeral cannot notify.** `subscribe()` **never fires on remote arrival**
   (Kyneta defect — see action items). State lands, the client is never told.
   Usable only by polling, which disqualifies it for reactive UI.
3. ~~**Delta-only presence loses text on a *fully connected* client** —
   2701/2702.~~ **RETRACTED — this was a test-harness off-by-one**, not a
   substrate property. The observer's `seq` dedup collided with the ephemeral
   default of `0`, so delta index 0 (the single character `"A"`) was never
   recorded. See the correction block atop `findings/S4-browser-transport.md`.
   **Do not cite this claim.**
4. **Delta-only presence cannot serve a mid-stream joiner** — 1260/2702,
   and **this result is real**. A channel carrying only the newest delta cannot
   reconstruct a prefix it never saw. Inherent, not an artifact. Condition C is
   disqualified **on this ground**, which is the hazard S2/S14 anticipated — not
   the stronger claim originally made.

**The tradeoff being accepted, plainly.** ~9.6 KB of unreclaimable history per
streamed message — **3.5× the message's own size** — paid by every future late
joiner, forever. `exchange.compact()` **throws on a live Loro substrate**, so it
cannot be reclaimed today. For long sessions this is the dominant growth term.

**Escape hatches, neither verified.** (i) Keep pending frames in a **separate,
disposable Loro doc per message**, destroyed on commit, so residue never enters
the session doc — preserves A's correctness with none of its cost, and looks
strictly better → **S16**. (ii) Fix or await Loro-substrate compaction.

~~**B is the right long-term destination**~~ — **moot.** The notification defect
*was* fixed (verified), but B's O(n²) cost was never an ephemeral property, and
ephemeral cannot hold a `text` at all. Durable `Schema.text()` supersedes the
whole line of reasoning. The "windowed tail" mitigation is **not needed** and
should not be built.

---

## ADR-0008 — The conversation tree is explicit; Loro version history is infrastructure

**Status:** Accepted

**Context.** Tempting alternative: represent the tree implicitly with Loro
frontiers — chat becomes a flat list, revisiting a node becomes
`checkout(frontier)` + append, and branch storage comes free.

**Decision.** Keep `parentId`/`fromId` explicit. Use Loro's version history only
for replication and convergence *of the tree itself*.

**Consequences / rationale.**

1. **A CRDT op-DAG is a *merge* DAG, not a *branch* DAG.** Its purpose is to
   make divergent histories converge to one value; conversation branches must
   persist as distinct, simultaneously-visible alternatives. Loro's own 1.0 blog
   example is decisive — `checkout` + `setDetachedEditing` + concurrent insert,
   then `import`/`checkoutToLatest`, yields `"Hello, world! Alice!"`: the
   branches **merge into one string**. Correct CRDT behaviour, catastrophic
   conversation behaviour.
2. **Loro agrees.** Its docs state the application layer must still implement
   "version tags and branches."
3. **It welds us to Loro.** Kyneta's Loro backend exposes only
   `version()`/`VersionVector`; frontiers would mean reaching past Kyneta's
   substrate abstraction, forfeiting Yjs/plain-JS and the schema algebra.
4. **Addressability is lost.** References, backlinks, labels, and fold all need
   stable *entry* identity. A frontier addresses a document version, not a
   message.
5. **Lifecycles get welded.** Shallow snapshots could not be used to trim
   history without destroying conversation structure.
6. **jj already ran this experiment** and separated the two: operation log
   (infrastructure) vs commit DAG (semantics). We adopt the same split.

**Where frontiers remain useful:** document audit/undo, shallow snapshots for
long sessions, and `findIdSpansBetween` for debugging convergence.

**Alternatives rejected.** *Tree-as-time-travel* — genuinely elegant, but
auto-merge makes it semantically wrong for alternatives that must coexist.

**Confirmed empirically by S7** (`findings/S7-branch-convergence.md` §3.5): two
branches placed in a single `Schema.text()` converge correctly *and* collapse
into one linear transcript — unaddressable, unfoldable. The failure mode is now
reproduced locally rather than cited from Loro's blog.

---

## ADR-0009 — Entry id uniqueness is a safety invariant, not a convenience

**Status:** Accepted (from S7)

**Context.** Entries are stored in `Schema.record`, a Loro map. A Loro map is a
**per-key LWW register**. Grow-only-set semantics emerge only because each key
is written exactly once and so the register is never contended. S7 §3.4 wrote
the same key concurrently on two peers: one write survived, the other was
**silently discarded — no error, no conflict, no signal.**

**Decision.** Entry ids are UUIDv7 and MUST be unique and coordination-free.
No code path may derive an entry id from content, position, index, or any other
deterministic function that two peers could compute identically.

**Consequences.** This is the invariant the whole tree rests on; violating it
loses conversation data invisibly. It must be enforced mechanically, not by
convention — add it to the fitness functions in `04-roadmap.md`.

**S9 VERIFIED pi's default generator and it clears the bar — structurally, not
statistically.** `session.js:158`: `this.idGenerator = options.idGenerator ?? { next: uuidv7 }`.
pi's `uuidv7` is **not stock RFC 9562**: it draws 16 CSPRNG bytes but overwrites
most of them with a 48-bit timestamp and a **41-bit monotonic counter**, seeded
once per module instance from exactly 40 CSPRNG bits and **never reset per
millisecond**, leaving 33 freshly-random bits per id.

| | intra-process, same ms | cross-process |
|---|---|---|
| stock UUIDv7 | 2⁻⁷⁴ (*not* zero) | 2⁻⁷⁴ |
| **pi's** | **exactly 0** (counter) | 2⁻⁷³ |

pi trades one bit of cross-process entropy for **absolute** intra-process
uniqueness — the right trade here, since v1 is one host process.

**Decisive evidence:** 200 000 ids forced into a *single* pinned millisecond,
zero duplicates — time contributes nothing, the counter does all the work. Two
default-constructed `Session`s **share one function object** (`genA.next ===
genB.next`), so two harnesses in one host **cannot** collide. 12 children forked
*after* the parent seeded all seeded differently (Node has no POSIX
fork-without-exec, so no module state crosses). 256 simultaneous processes: all
seeds distinct, flat octile histogram, r(pid) = −0.08, r(starttime) = −0.09 — no
derivation from pid, hostname, `os.*`, or `Math.random`. End-to-end: 10 000
entries across two partitioned peers, zero loss; the deliberate-duplicate control
reproduces the silent discard, so the test is not vacuous.

**Decision: use pi's default. Do not replace it with anything weaker.**

**The hazard is the injection point, not the default.** `SessionOptions.idGenerator`
is where this can go wrong — S3 injected its own. Anything Pineta injects must
clear: (i) no derivation from content, index, or position; (ii) ≥ 2⁻⁷⁰ pairwise
cross-instance; (iii) structurally unique within a process.

**Known boundary:** cross-instance safety degrades at ~10⁴ concurrent instances ×
10⁶ ids (expected collisions 5.3×10⁻³) — far outside plausible scale. **Genuine
residual risk:** VM-image cloning or a V8 startup snapshot taken *after* the
first `uuidv7()` call would duplicate the counter. Not pi-specific, and mitigated
by lazy seeding.

**Alternatives rejected.** *Content-addressed ids* — deduplication is
superficially attractive but makes collision a normal event, i.e. routine
silent loss. *`Schema.list`* — avoids the LWW register but is not idempotent
and imposes a container order the tree does not want.

---

## ADR-0011 — The lane name carries writer identity; never share a lane

**Status:** Accepted (from S3 **and** S8, independently)

**Context.** ADR-0009 established that a Loro per-key LWW register is safe
exactly when each key has **one writer**. Entry ids achieve that via UUIDv7.
But pi keys three registers by **lane name** — `pi.branch.tip`,
`pi.lane.state`, `pi.lane.config` (`values.js:62-65`) — so two writers sharing
lane `"main"` contend on all three.

Measured under a shared lane (S8 §3.3, S3 §3.2):

- **3 of 8 entries orphaned** — a complete turn detached from the lane path
- **queued steering messages lost** (1/2) — `pi.lane.state` carries the inbox
- **an in-flight operation record vanished** (1/2)
- replicas **converged**, entry sets **identical**, **no error anywhere**

The failure shape is precise and nasty: this is *not* S7 §3.4's "an entry
disappears." Every entry survives; what is lost is **reachability**. Because
`scanBranch` walks parents from the tip (`lane.js:1478`), the losing peer's turn
becomes invisible to the transcript, to context assembly, and to the UI. It is
consistent, converged, and wrong.

**Decision.** Each concurrent writer MUST own a distinct lane, created at its
branch point:

```js
const lane = await harness.lane(`peer-${peerId}`, { createAt: branchPointEntryId }, ctx)
```

Lane names MUST derive from a coordination-free peer id — never from a user
string, never from a default like `"main"`. A `Lane` object is single-writer
state and must never outlive its writer's ownership.

**Why this design.** It is the ADR-0009 mechanism reused: uniqueness of the
*key* removes contention. One idea applied twice, no new machinery. It fixes
all three registers at once, requires **zero adapter complexity**, and uses
pi's native grain — `AgentHarness.lanes()`, `lanesByName`, and pi's own
three-lane conformance fixtures show multi-lane sessions are first-class.

**Alternatives rejected.** *Shared tip* — the measured data loss above.
*Per-peer key rewriting inside the adapter* (lane stays `"main"`) — leaks:
pi enumerates lanes by prefix-scanning the tip namespace
(`restore.js:51,55`), so `restoreSession` would see `["main@p1","main@p2"]`
as two lanes. The adapter would have to lie consistently across `getValue`,
`setValue`, **and** `scanValues`, buying nothing over lane-per-writer.
*Add-wins set of tips* — `Schema.set` is **rejected at runtime** by the Loro
backend (verified twice, independently).

**Consequences.**

- Lane-name collision is a **silent-data-loss safety invariant of the same
  class as ADR-0009** and needs the same mechanical enforcement.
- **Lanes accumulate; there is no deletion API.** Every writer that ever joins
  leaves three permanent registers. Bounded by distinct writers over session
  lifetime — a real leak, not yet urgent. The UI must distinguish live from
  historical lanes.
- **"The trunk" becomes a convention, not a lane.** If every writer has a lane,
  none is canonical. Open question → **S12**.
- **v1 is not exposed.** The hazard needs ≥2 harness processes on one logical
  session. v1 is one host with thin clients (ADR-0001/0007), and `Storage`'s
  admission queue serialises commits within a process (S2/T5). Two browser
  windows driving one host contend on nothing. **ADR-0011 is a prerequisite for
  multi-device/team multiplayer, not for the v1 demo.**
- **Retires a v1 worry:** `00-vision.md` proposed per-peer tips as *presence*.
  Unnecessary — durable per-peer lanes are sufficient and simpler. Presence
  remains right for *ephemeral* cursors (selection, scroll, live typing).

---

**Addendum (step 2, branch write).** `navigateTree` moves **this writer's**
lane tip. That is what makes an Aside private: the writer goes to the branch
and no other writer's lane is touched. Two writers branching concurrently
touch different lanes, so there is no contention on `pi.branch.tip` — but that
is exactly what step 3 must test rather than assume.

**Addendum (step 3, a lane per writer).** Until step 3 the host implemented
none of this: it minted one lane at startup and every client drove it, so one
window could move another's lane and only one turn ran at a time. Now each
client's lane is `laneNameForWriter(LineSender.peer)`. Identity comes from the
**transport**, never the message, so a client can only drive its own lane and no
command field can name someone else's. The host itself is not a writer. Proven
by a negative control: keying every writer to one shared lane fails "B
navigating did not move A's lane".

## ADR-0012 — The trunk is a derived value over an append-only promotion DAG

**Status:** Accepted (from S12)

**Context.** ADR-0011 gives every writer its own lane, so no lane is canonical —
yet the product is built on a trunk (`00-vision.md`: *"fold an exploration back
into the trunk"*). The danger was that any trunk representation reintroduces a
shared-writer register, **moving** ADR-0011's hazard rather than removing it.

Five candidates were run over one identical workload. Two reintroduce the hazard
and **lose folds silently** — including the one that looks most idiomatic:
pi ships `sessionName = value("pi.session.name")` (`values.js:79`), a genuine
keyless session-global register, which is precisely the shape that fails.

| | candidate | folds discoverable | verdict |
|---|---|---|---|
| (a) | designated lane `"main"` | 1/2 | **silent loss** (and mutual exclusion is unachievable across a partition) |
| (b) | label on an entry | 2/2 | no trunk tip at all (0/2 on path) |
| (c) | `pi.session.trunk` pointer | 1/2 | **silent loss** — the kill-criterion candidate |
| (d) | per-peer designated leaf | 2/2 | peers **permanently disagree** |
| **(e)** | **append-only promotion DAG** | **2/2** | **visible + convergent** |

**Decision.** Promotions are records in `Schema.record` keyed by UUIDv7:

```js
promotions: Schema.record(Schema.struct.json({
  id, entryId,
  prev: Schema.list(Schema.string()),   // promotions this one extends/supersedes
  peer, ts,
}))
```

The trunk tip is **derived**: the single leaf of that DAG, or — when concurrency
produced several — the winner under a total order `(ts, peer, id)`, **with the
fork explicitly surfaced**. This is ADR-0009's "unique key ⇒ single writer"
mechanism applied a **third** time (entry ids, lane names, now promotion ids).

**`prev` must be a LIST.** The experiment forced this: with a single
`prevPromotionId`, a losing promotion is never extended by anything, so it stays
a leaf forever and fork detection becomes a permanent false positive. A
promotion that resolves a fork extends **every leaf it supersedes** — exactly a
merge commit with two parents.

**Evidence.** 1000/1000 property trials (promotion durability + replica
agreement) across 5 seeds; **0/600** across two independent shared-register
controls; order-independent resolution over 500 shuffles; 91/91 promotions
durable with zero duplicate key writes. Independently re-verified at a fresh seed.

**Consequences.**

- **`leaves.length > 1` is a first-class, queryable state** meaning "the trunk
  has an unresolved fork." Not an error — the multiplayer equivalent of a merge
  conflict, detected **structurally** rather than heuristically. The UI must
  render it and offer re-fold.
- **Repair is free, via ADR-0010.** Because a fold is destination-relative, a
  losing promotion is repaired by **re-folding the source branch at the new
  tip** — not by grafting or rolling back the stale merge node, which remains as
  immutable provenance (ADR-0004). The mechanism was already prescribed; it is
  simply applied twice.
- Promotions accumulate with no GC, like lanes.
- **v1 unaffected** — concurrent promotion needs ≥2 harness processes.

**The deeper finding, which reframes the question.** Two concurrent folds onto
the same trunk tip are a **semantic conflict regardless of representation** — a
linear trunk path can contain only one of two siblings. *Every* candidate scored
1/2 (or 0/2) on "folds on the trunk path." So the real question was never "can
the trunk avoid contention" but **"does the conflict fail loudly or silently."**

---

## ADR-0013 — `seq` is a derived, replica-local ARRIVAL index

**Status:** Accepted (from S1). Clears the top blocker.

**Context.** `seq` was a shared dense commit counter. Under partition, two
replicas assign it independently → collisions, counter regression, and an entry
present in the document **silently skipped** by paginated reads.

**The decisive constraint — and it refutes the obvious fixes.** pi turns a cursor
into arithmetic on an integer line (`session.js:239-243`):

```js
order === "asc" ? { fromSeq: query.cursor.seq + 1 }
                : { toSeq:   query.cursor.seq - 1 }
```

`cursor.seq + 1` means *"the next possible position"*, which is sound only if
**nothing can ever appear between two already-issued positions**.

> **A convergent order and stable integer cursors are mutually exclusive.**
> Any convergent key — Lamport, HLC, `(uuidv7, peer)`, packed peer-ranges — is by
> construction one a late arrival sorts into the *middle* of:
> - **unique-but-convergent** → the arrival lands *below* an outstanding cursor
>   and is **never returned** (a skip);
> - **derived dense convergent index** → middle insertion shifts later positions
>   and entries are **returned twice** (a duplicate).
>
> Uniqueness is *not* sufficient. Only an order in which new observations always
> land **at the end** keeps `cursor.seq + 1` correct.

**Decision.** `seq` is a **replica-local arrival index**, derived from the
document and **never replicated**. The shared CRDT stores no seq and no counter.
Each item carries a coordination-free identity token so arrival can be tracked —
entries/usage use `id` (ADR-0009 already guarantees it), values a per-write
`wid`, list elements a per-append `eid`. `meta.nextSeq`, `messageCount` and
`usage` are all removed from the document and derived locally, since a shared
LWW counter clobbers exactly as `nextSeq` did.

**Invariant:** seq is a *topological linear extension* of the parent DAG
(parent always lower than child) — load-bearing, because `scanBranch` filters its
parent-walk with seq comparisons. Remote arrivals are assigned via Kahn's
algorithm, parents first.

**Evidence.** All three S3 defects gone (0 collisions, no regression, 0 skipped);
conformance 21/21 incl. the `memory` control; real `AgentHarness` 12/12 and
10/10; new property test **1000/1000** across 5 seeds where the shared-counter
control fails **0/300**; the mid-pagination-arrival crux passes with 0 duplicates
and 0 never-returned. Cold index rebuild is **57 ms at n=10 000**; incremental
reconcile is **O(δ), 0 ms** whether the document holds 10 000 or 50 000 entries.

**Consequences.**

- **Density was never required.** pi's own conformance suite ships a fixture
  literally named `"sequence gap"` (`conformance/storage.js:522`).
- **`ListReadOptions` does NOT break.** The "API-visible break → Loro `Cursor`"
  predicted by S2/T7 and `01-architecture.md` is **retired** — no Loro cursor is
  needed.
- **Arrival order is not a display order.** It is deliberately non-convergent and
  differs per replica; the same entry legitimately has different seq on two
  peers. Semantic order comes from the `parentId` walk. Nothing should render by
  seq.
- **⚠️ `seq` MUST NOT cross a replica boundary or survive a restart.** A cursor
  minted on one host is meaningless on another. pi never does either today
  (verified by a complete grep of non-test cursor uses in `dist/harness`) — but
  this becomes a constraint on **ADR-0007**: browser clients receive transcript
  events carrying `seq` from `commit.seqs[...]` and **must treat it as an opaque
  local ordering key**. Entry `id` is the durable identifier.
- **ADR-0009 is load-bearing a second way:** `id` *is* the arrival-dedup token.
  The new `wid`/`eid` tokens apply the same mechanism twice more.
- **ADR-0011 is unaffected and still required.** It fixes *reachability*; this
  fixes *ordering*. Independent defects, independent fixes.

**Alternatives rejected.** *Lamport + peer tiebreak inherited from Loro* — the
original plan in `01-architecture.md`; refuted above. *Packed unique-by-
construction keys* (peer-ranges, HLC) — same refutation: unique but convergent,
so late arrivals land behind live cursors. *Upstream contract change to
id-anchored cursors* — still worth proposing to pi as a cleanup, but **not
needed**; no renegotiation is required.

---

## ADR-0015 — Entries are a TYPED schema; `Schema.any()` only where the pi boundary forces it

**Status:** Accepted. Supersedes the unstated `Schema.any()` choice in
`packages/schema/index.ts`. Blocks `PLAN-2026-09-24-tree-read`, which was
written against untyped entries.

**Context.** `SessionDoc` declares the primary content of the document as an
opaque blob:

```ts
entries: Schema.record(Schema.any()),
```

The surrounding comment justifies the *record-vs-list* choice (ADR-0009) and
the *no stored seq* choice (ADR-0013) at length, and says **nothing** about
`Schema.any()` — the loosest decision in the file. This ADR supplies the
reasoning that was missing, and reverses the decision.

Kyneta is schema-first. From its README:

> **Schemas should be walked once.** … Kyneta's schema algebra collapses
> [reading, mutation, observation, validation, sync] into one catamorphism with
> pluggable interpreters — all behaviors are derived from the same structure.
> Your schema is the single source of truth not by convention, but by
> construction. Add a field and every behavior follows.

With `Schema.any()` the catamorphism has nothing to walk. For the primary
content of our document we forfeit validation, typed reads, observation
granularity, indexes and devtools. What remains is Loro with extra steps.

The concrete cost is visible in the code. `parentId` — the edge the entire
product is built on, the subject of ADR-0004, ADR-0008, ADR-0010 and ADR-0012 —
sits inside an untyped blob. `projectTranscript`, `orderNewEntries` and the
proposed `projectSpine` are hand-rolled traversals over untyped records,
reimplementing in TypeScript what the schema algebra derives.

**Three claims justified the opacity. All three were checked and two failed.**

1. *"pi's `Entry` has no closed type to express."* **False.** It is a closed
   discriminated union on a stable base:

   ```ts
   type EntryType = "message" | "compaction" | "branch_summary" | "custom"
   type Entry = MessageEntry | CompactionEntry | BranchSummaryEntry | CustomEntry
   interface EntryBase {
     id: string; parentId: string | null; seq: number;
     timestamp: number; type: EntryType; customType?: string;
   }
   ```

   Kyneta has `Schema.discriminatedUnion`, a direct match. Note also that
   `parentId` is **pi's** field: pi's session model is already tree-shaped, and
   `BranchSummaryEntry.fromId` is ADR-0004's merge node. We are not layering a
   tree onto a flat store; we were failing to type a tree that already exists.

2. *"Typing pi's shape couples our `schemaHash` to pi's releases, so a pi field
   addition would stop documents syncing."* **Partly true — corrected twice.**
   Kyneta does have a migration system, and `Migration.add` is tier T1
   identity-preserving, so this looked false. **S17 probe P1 shows the
   `supportedHashes` walk does not reach our entries at all:**

   | shape | reaches the pre-change hash |
   |---|---|
   | nested product (Kyneta's own tested case) | ✅ |
   | plain product inside a `Schema.record` | ❌ |
   | `struct.json` inside a record | ❌ |
   | `struct.json` inside a sum inside a record | ❌ |
   | sum as a root product field, no record | ❌ |

   The walk descends product→product fields only. `Schema.record` is a barrier
   and so is a sum. Since `entries` is a record, **no per-entry schema shape is
   migratable, however it is typed** — sealing the variants would not have
   helped either (row 2).

   What this costs is bounded, and probe P1c measured it: a **new schema reads
   old data locally**, filling absent fields with defaults. The hash matters at
   *Exchange negotiation* between peers on different Pineta builds. Pineta ships
   host and client together, so that is an upgrade-coordination concern, not a
   runtime one.

   **The design consequence is therefore not "seal the variants" but "keep the
   typed surface small and stable."** Every typed field is a field that forces a
   coordinated upgrade when pi moves it.

3. *"`packages/schema` must not import pi."* **True, and it survives.** This is
   the only surviving justification, and it constrains the *leaves*, not the
   structure.

**Decision.** Type the entry envelope as a flat `struct.json` with a small,
stable field set. Seal pi's variant-specific data in one `Schema.any()` leaf.

```
entries: Schema.record(
  Schema.struct.json({
    id:        Schema.string(),
    parentId:  Schema.string().nullable(),   // the tree edge (ADR-0008)
    type:      Schema.string(),              // unconstrained — see below
    timestamp: Schema.number(),
    fromId:    Schema.string().nullable(),   // merge node (ADR-0004), fold (ADR-0010)
    payload:   Schema.any(),                 // pi's variant data, sealed
  }),
)
```

Five sub-decisions, each evidence-backed:

- **A flat struct, NOT `Schema.discriminatedUnion`.** The union was the intended
  design until probe P1. Since migrations cannot reach into a record either way,
  a union buys per-variant validation at the cost of a schema change — and so a
  coordinated upgrade — every time pi adds an entry type. `type` as an
  unconstrained string means **a new pi `EntryType` requires no schema change at
  all.** Minimal surface, maximal tolerance.
- **Type exactly what Pineta reasons about.** `id`, `parentId`, `type` and
  `fromId` are the fields our own traversals read — `projectTranscript`,
  `orderNewEntries`, the planned `projectSpine`, and fold. Everything else is
  displayed, not reasoned over.
- **`.json()`, not plain `struct`.** Entries are written exactly once (ADR-0004,
  ADR-0009), so per-field CRDT merge is machinery we would never use. `.json()`
  is *"a plain-JSON merge boundary — the entire subtree is replaced atomically
  on write, not composed CRDT-style."* `LoroLaws` includes `"lww"`, so it binds
  on Loro.
- **`any()` only at the sealed leaf.** `AgentMessage`, `JsonValue` and `Usage`
  are deep pi / pi-ai types that `packages/schema` may not name. `any()` is
  `ScalarSchema`, hence `PlainSchema`, hence legal inside `.json()`.
- **No `seq` field.** ADR-0013 becomes **structural for stored entries**: an
  undeclared key cannot be written through a typed struct. This closes a
  measured asymmetry — Line messages were already protected structurally by
  `Schema.struct`, while stored entries relied entirely on the runtime
  `findSeqKeys` scan *because* they were `Schema.any()`. After this change that
  scan is a genuine backstop rather than the only guard.

**Probe evidence (S17, `sandbox/s17-typed-entries/`).**

| probe | question | result |
|---|---|---|
| P1 | do migrations reach entry fields? | **no** — record and sum are both barriers; control passed |
| P1c | can a new schema read old data? | **yes** — absent fields take defaults |
| P2 | is the changefeed still O(δ) per entry? | **yes** — typed ≡ opaque, 1 change per write |
| P2b | can P2 detect a regression? | **yes** — 3 writes → 3 changes |

**Consequences.**

- `KynetaStorage` gains a projection on write and a reconstruction on read.
  Round-trip fidelity through pi's `Storage` port is exactly what
  `pnpm run conformance` tests (21/21 + 21/21); it is the control for this
  change, not an afterthought.
- The hand-rolled traversals become candidates for retirement in favour of
  schema-derived reads and `@kyneta/index` for parent→children lookup. Not part
  of this ADR; revisit after the typed schema lands.
- **There is no migration chain to maintain, and that is the constraint, not a
  relief.** Probe P1 showed the `supportedHashes` walk never reaches a value
  inside a `Schema.record`, so no entry-shape change is migratable. Any change
  to the row is a **coordinated upgrade**: ship host and client together. Probe
  P1c bounds the damage — a new schema still reads old data locally, with
  absent fields taking defaults — so what is exposed is peer negotiation
  between different builds, not local read.
- **The tier table does not apply here.** `Migration.add` being T1 and a field
  removal being T2 is true of products reachable by the walk. Our entries are
  not reachable, so no tier is available to us. This is why the typed surface
  is deliberately small: every typed field is one that forces a coordinated
  upgrade if pi moves it.
- Provenance for the sealed `payload` is unrecorded, and P1 removes the
  consolation first claimed here: there is no migration chain acting as a
  version record. `schemaHash` identifies the shape; nothing identifies which
  pi build wrote a payload. See the open question below.
- `PLAN-2026-09-24-tree-read` is unblocked, with `projectSpine` respecified over
  typed rows. `message` lives in the sealed `payload` and is lifted by
  `readRenderableEntries` in `client/projection.ts`.

**Alternatives rejected.**

- *Keep `Schema.any()`.* Forfeits the library's entire value proposition for the
  document's primary content, and leaves ADR-0013 dependent on a runtime scan.
- *Type only the stable base (`id`, `parentId`, `type`, `timestamp`) and seal
  each variant payload.* This was the intended decision until claim 2 was
  checked. It was a hedge against a sync failure that migrations already solve,
  and it would have left `fromId` — ADR-0004's merge node — untyped.
- *Mirror pi's full `Entry`, including `AgentMessage`.* Breaches the pi boundary
  that `packages/schema` exists to hold, and couples us to pi-ai's message
  shape, which is deeper and faster-moving than the entry envelope.
- *A bespoke `formatVersion` field mirroring pi's `JSONL_FORMAT_VERSION = 4`.*
  Largely redundant: Kyneta's migration chain is the versioning mechanism for
  every typed field. Reconsider only for the sealed leaves.

**Open question.** Provenance for `any()` leaves. pi records
`JSONL_FORMAT_VERSION` in a header record; we record nothing about which pi
version wrote a sealed payload. Low urgency while the leaves are opaque
pass-through, but it becomes real the first time we interpret one.

---

## ADR-0016 — Never race a child container: lazily created containers need globally unique keys

**Status:** Accepted. From probe S18 (`docs/findings/S18-nested-values.md`).
Same family as ADR-0009: a per-key register whose violation is silent.

**Context.** Kyneta records are per-key last-writer-wins maps on Loro. A leaf
under a record key is one register. A *child container* under a record key (a
nested record, a list, a text) is created on first write. The question came up
concretely: could pi's values be stored nested, `values[namespace][key]`,
instead of flat under `namespace + "\0" + key`?

S18 measured it. Two replicas each write a different key into the same new
namespace, then sync:

| layout | kept both writers' values |
|---|---|
| flat, one leaf register per address | 40/40 |
| nested, namespace container **created concurrently** | **0/40** |
| nested, namespace container already existed | 40/40 |

Creating the same child container concurrently loses one writer's contents,
every time, with no error. Once it exists, merging inside it is fine.

**Decision.**

1. **A child container may be created lazily only under a key no two replicas
   can create concurrently**: in practice, a globally unique id.
2. **Where writers can share an address, store one leaf register per address.**
   pi's `values` stay flat, keyed by `physicalKey(namespace, key)`.
3. **That key is an identity, not a format.** `physicalKey` in
   `packages/schema` is its only definition; the writer and point lookups use
   it, and nothing parses it. Readers use the `namespace` and `key` properties
   every stored value carries. Verified: changing the encoding inside
   `physicalKey` leaves unit, conformance and every e2e check green.

**Consequences.**

- The current document complies, and the reason is now written down:
  `pendingText` (a text per run id) and `lists` (a list per pi
  `operationId:responseEntryId`) are the only lazily created containers, and
  both are keyed by globally unique ids.
- **Two things would break it silently:** keying a lazily created container by
  anything two replicas could share (a namespace, a lane name, a user id), or a
  second writing replica (multi-host, S8) meeting a container keyed by anything
  that is not unique. Both belong in review checklists.
- A namespace scan stays O(all values). Accepted: it is the price of a layout
  with no creation race.
- Before this change, the separator was defined twice, once in
  `packages/pi/storage.ts` (the writer) and once in `packages/schema` (the
  readers). Changing either alone would have made every lane read as "no lane",
  which `planAttach` then turns into a silent misattachment. One definition
  removes that by construction.

**Alternatives rejected.**

- *Nested `values[namespace][key]`.* Loses a writer's value when a namespace is
  created concurrently (S18, 0/40). pi's namespace set is open, since plugins
  add their own, so namespaces cannot be fixed struct fields created up front.
- *Rows with an opaque generated id.* Two writers of one address would create
  two rows and need conflict resolution the substrate already provides for a
  single key.
- *Pre-create every namespace at document creation.* Works only for a closed
  set, and pi's is open.
