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

**Realised by ADR-0017:** the dedicated namespace is pi's `pineta.reference`
value namespace.

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
decision stands on the remaining two. Amended by ADR-0023: the accepted residue
per message is gone, since the session is compacted when every run ends.

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

**Status:** Accepted. Amended by ADR-0023: the session document is no longer on
Loro. The tree stays explicit; replication and convergence need no CRDT history
when one host writes.

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

**Status:** Superseded by ADR-0020 (lanes belong to threads; people own none). Accepted (from S3 **and** S8, independently)

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
  `readRenderableEntries` in `packages/client/projection.ts`.

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
Same family as ADR-0009: a per-key register whose violation is silent. Amended by
ADR-0023: the session document has one writer, so the race cannot arise there;
the rule still binds any collaborative document.

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

---

## ADR-0017 — References are pi values in a Pineta namespace

**Status:** Accepted. Realises ADR-0006. Roadmap step 4.

**Context.** ADR-0006 fixed a reference as a semantic pointer, stored apart
from the causal `parentId` graph. The question was where. pi has no reference
concept, but it has two extensible places: custom entries and namespaced values.
Checked in pi's source: namespaces are open (only empty or NUL is rejected);
`Session.setValue` is public and usable outside a turn; JSONL storage appends
every write, values included; and only custom entries can enter a model's
context, through a registered `entryProjectors[customType]`.

**Decision.** A reference is a pi **value** in `pineta.reference`, keyed by its
own id, written only through `Agent.addReference`.

- **Values, not custom entries.** A custom entry has a `parentId`, so it would
  join the causal graph, contradicting ADR-0006, and appending one would move
  the author's lane tip. Values stay out of the causal graph and out of every
  model's context.
- **One schema, TypeBox, in `packages/marginalia`** (named `packages/references`
  when this was decided). Pineta owns the reference
  shape, so this schema is the single authority, not a mirror of pi's. It is
  the TypeBox version pi pins, so one copy is installed. Decoding is total: a
  malformed value is dropped, never thrown.
- **Backlinks are derived** by `indexReferences`, one pass in both directions.
  A stored backlink list per target is the S18 shape.
- **Attached where the author is reading, authored by the transport's peer
  id.** *Amended by ADR-0018:* this was "the author's lane tip", but once people
  chat, someone who only ever asks the agent has no lane. The reference names
  the entry being read, or the author's tip. Refused while the author's turn
  runs.
- **Spans are UTF-16 code units over `messageText`.** Only committed entries
  are citable. *Amended by S27:* this said "which is what the client renders".
  The client now renders it as markdown, so `**bold**` shows as "bold" and a
  selection's DOM offsets are not source offsets. Each rendered run of text
  carries the source range it came from, and a selection reaches the source
  through them (`packages/client/markdown.ts`). The offsets themselves are
  unchanged.

**Consequences.** References travel in pi's JSONL. A pi extension can reach
them once Pineta supplies an API through the embedder-provided `toolContext`;
that is added with the first extension that needs it. TypeBox ships to the
browser: +42 kB raw, +12 kB gzipped. Proven: two writers citing one entry
concurrently both survive, and keying by target id instead loses one.

**Alternatives rejected.** A Pineta-owned document field (invisible to pi); pi
custom entries (causal graph, lane tip); a stored backlink list (S18); Zod
(TypeBox matches pi's tool parameters). Deferred: routing the namespace to a
typed Kyneta row inside `KynetaStorage`, the ADR-0015 pattern, until references
need more than backlinks.

## ADR-0018 — Humans in the tree: chat is a pi `CustomMessage`, and only an agent can be compelled

**Status:** Accepted. Roadmap step 5. Evidence: S19. Amended by ADR-0020 (lanes
belong to threads) and ADR-0021 (a thread's mode is its lane; a mention picks
the addressee).

**Context.** People working with an agent also talk to each other, and that
talk is part of the work: an invited agent needs it, in order and by speaker.
A transcript cannot hold it without every message becoming a prompt. The
question was how human messages enter pi's tree without each one costing a run,
and what decides when the agent answers.

**Decision.**
- **Obligation, not identity, is the distinction.** A *collaborator* may reply
  at their discretion, human or bot. A *compelled responder* must reply, which
  is a run, and only an agent can be one. Every human message records who it
  compels (`Responder`): usually nobody.
- **A human message is a pi `CustomMessage`** (`role: "custom"`,
  `customType: "pineta.chat"`). `content` is what the model reads, with the
  speaker ("Alice: …"), copied at write time; `details` holds the author lane,
  display name, text and responder. pi's default conversion sends it to the
  model as a `user` message, so there is no projector.
- **A compelled message IS the agent's prompt**, run on the agent's lane
  (`a-agent`). A message that compels nobody is appended on its author's lane
  with no run. Both attach where the author is reading.
- **Appended through the pi `Lane`, never the session.** A `Lane` plans against
  its cached tip; a write through `session.mutate` is stored but drops out of
  the next turn's path, silently (S19).
- **Threads carry a default.** A *working session* compels the agent on every
  message; a *conversation* compels nobody, so `@agent` does. Set at an entry
  as a `pineta.thread` value and inherited below it; the session's root is a
  working session. `@name` notifies a person and never compels. *Superseded by
  ADR-0021:* the default is derived from whether the thread has a lane, nothing
  is stored, and a message naming only people does not compel the agent.
- **The composer states the obligation before sending**, using the same
  `compelledResponder` the host runs.
- **pi's data is written only by the host.** Shared drafts, a later plan, will
  extend this to "tabs write only draft text".

**Consequences.** One shape for all human messages; a run exactly when an agent
is compelled. The agent's lane is shared, so the agent answers one message at a
time, and a second compelled message is refused (`busy`), not queued. Views
follow leaves, not lane tips, because the agent's lane leaves a thread whenever
another thread compels it. `prompt` and `branch` become redundant and are
removed.

**Alternatives rejected.** Chat outside the tree (a second record; the agent
would need it re-assembled). A custom entry with an `entryProjectors` projector
(a run must start with `prompt`, so compelling the agent would add a synthetic
second message; S19). Chat written directly by browser tabs (leaves pi's tree).
People versus agents as the distinction (a bot can collaborate; only an agent
can be compelled). A separate "note" type (a note is a message that compels
nobody). Discretionary agents that may speak unprompted: deferred until there is
a policy for when to speak.

## ADR-0019 — A lane is a line of work, not a unit of parallelism

**Status:** Accepted. Refines ADR-0011 and ADR-0018; shapes ADR-0010. Amended by
ADR-0020 (people own no lanes, so there are no conversation lanes).

**Context.** A pi lane is a named cursor into the session tree: a tip where the
next entry attaches, and its own run state, one model turn at a time
(`LaneBusy` otherwise). ADR-0011 gave every writer a lane so no two writers
contend for a tip. ADR-0018 then put every model turn on one agent lane, so the
agent answers one message at a time. The obvious way to answer two people at
once is more agent lanes. That treats a lane as a unit of parallelism, and it is
not one: agent work will change files, and a line of agent work needs its own
state on disk.

**Decision.**
- **Two kinds of lane.** A *conversation lane* carries messages, notes and
  citations. It never touches disk; a person's lane is one, and exists only
  because pi needs a single writer per tip (ADR-0011). A *work lane* carries
  agent work, and will own a **jj workspace**, created with the lane. The
  trunk is a line of work too, on the main working copy.
- **Creating a work lane is deliberate.** It forks the conversation and the
  state on disk at one point, and both must later be folded back. It is never
  a way around a race or a busy agent.
- **Fold is a tree merge and a workspace merge, both agent-assisted.** ADR-0010's
  fold, widened: bringing a line of work back merges its branch of the tree and
  its jj workspace into the destination's.
- **Conversation never forks by accident.** When two people reply at the end of
  a thread at the same moment, the later message is placed after the earlier,
  as any chat does. Forks in the tree are made on purpose.
- **A busy agent queues; it does not multiply.** A compelled message that finds
  the agent answering someone else waits its turn on the same line of work, and
  its sender is told. Starting a separate line of work instead is a deliberate
  act, designed with workspaces.
- **Moving an agent lane across branches is valid only while its runs do not
  touch disk.** Today the host moves the one agent lane wherever it is
  compelled; that is harmless because the agent has no tools. Once it has
  tools, it answers on a branch only through that branch's own work lane, or
  its files would no longer match its conversation.

**Consequences.** Removing `prompt` (the per-writer run path) removes the
ability of two writers' turns to run at once, and that is intended: concurrency
returns only as deliberate lines of work, each with its workspace. The race at
the end of a thread is handled by a send that carries what its sender saw
(`at`, and whether the agent was free): plain chat moves after the other
message; a compelled message queues, and the sender learns the state changed.

**Alternatives rejected.** A pool of agent lanes grown on demand for
parallelism: it creates lines of work nobody chose, and with workspaces would
fork disk state as a side effect of a race. An agent lane per thread: the same,
at a coarser grain. Refusing a compelled message when the agent is busy: it
breaks the promise the composer made ("agent will reply").

## ADR-0020 — Lanes belong to threads and never move; people own none

**Status:** Accepted. Supersedes ADR-0011. Amends ADR-0018 and ADR-0019.
Evidence: S19, S20, S21. Amended by ADR-0021 (the lane is also the thread's
mode) and by ADR-0026 (what waits is a note, not an outbox entry).

**Context.** ADR-0011 gave every writer a lane, so two writers never contend for
a tip; ADR-0018 then ran every model turn on one agent lane that travelled to
wherever it was compelled. ADR-0019 settled that a lane is a line of work, and
will own a jj workspace, so a lane that travels between branches drags the
wrong state with it: its queue, its context, later its files. And once people
chat, a person's lane only carries their messages, which the message itself
already attributes.

**Decision.**
- **A lane belongs to a thread.** It is created where agent work is first
  wanted in that thread (the first compelled message), named `t-…`, and never
  navigated: it advances only by its own appends and runs. *Amended by
  ADR-0021:* having a lane is also what makes a thread agent work.
- **Invariant: a lane's tip is always its thread's end.** Every rule keeps it:
  lanes never move; everything in a lane's thread goes through that lane; a
  branch never reuses a lane. So the thread's lane is found from the thread's
  end, with no stored mapping (`threadOf`). *Amended by ADR-0021:* a
  compelled branch at a lane's tip creates a new lane there, and until its
  prompt commits the two share a tip. In that moment the end names neither
  lane: nothing binds to either, and a send that does not name its lane is a
  `conflict`.
- **People own no lanes.** A message records its writer (`WriterId`, from the
  transport). The host is every lane's only writer, and one serial executor
  runs every command's gather, plan and execute, so no two contend.
- **Conversation threads have no lane.** Their messages are appended with no
  lane, parented at the thread's end (S21 Q1). With one host, the serial
  executor makes that parent right when it is written; S21 Q2's read inside
  `session.mutate` is what a second host would need.
- **A running lane is never written** (S21 Q3). Every message for a busy thread
  (running, or with messages already waiting) waits in `pineta.outbox`, in send
  order, and is drained when the lane is idle: a plain message appended, a
  compelled one run to completion before the next.
- **A race is another writer's compelled message** below what the sender saw.
  A compelled `reply` that was raced, or that finds its lane busy, is a
  `conflict`: nothing is written, and the sender chooses `queue` (serial) or
  `branch` (a separate line of work where they were reading). Plain chat never
  conflicts; a late message goes after the earlier one (ADR-0019).

**Consequences.** `navigate`, `prompt` and `branch` commands, per-writer turn
state, `laneNameForWriter` and `planAttach` are gone. Threads run concurrently,
each one message at a time. The host and the client read the facts behind every
decision through one package (`@pineta/reads`), so the composer's promise and
the host's decision cannot drift apart.

**Alternatives rejected.** A lane for every thread, conversation included (two
meanings of "lane", and pi records for every conversation; S21 Q1 shows none is
needed). One travelling agent lane (ADR-0019). A pool of agent lanes (lines of
work nobody chose). pi's `followUp` as the queue (S20: correct for compelled
messages alone, but a plain message written to a running lane lands by timing,
S21 Q3). Two mechanisms for "a late message goes after" (with both, a test could
not show either works).

## ADR-0021 — A thread's mode is its lane; a mention picks the addressee

**Status:** Accepted. Amends ADR-0018 and ADR-0020.

**Context.** ADR-0018 stored a default at an entry (`pineta.thread`): below a
*working session* entry the agent answers every message, below a
*conversation* entry only `@agent`. It was changed by an action on a message
("from here, …"), beside another action, "branch from here". Both asked a
person to decide where the agent will answer while they were reading, not
while they were sending, which is when anything is spent. And after ADR-0020 a
thread has a lane exactly where agent work was wanted, so the stored default
was a second record of a fact the lanes already held.

The actions differ in cost, and in how far they can be undone:

| step | costs | undone by |
|---|---|---|
| a message (a note, or conversation) | nothing | deleting it |
| asking the agent | time and money | nothing: it is spent |
| a workspace for the agent (ADR-0019) | disk and CPU | tearing it down |

**Decision.**
- **Each step up is deliberate, taken once per thread, at send time.** Reading,
  opening a branch and closing a column never step up.
- **A thread's mode is derived: a thread with a lane is agent work; a thread
  without one is a conversation.** Nothing is stored. The first message that
  asks the agent in a conversation creates the lane (ADR-0020), and from then
  on the thread is agent work.
- **Mentions pick the addressee; the thread's mode fills in when there are
  none.** `@agent` asks the agent. A message naming only people goes to them
  and does not ask the agent, in agent work too. A message with no mention
  asks the agent in agent work, and nobody in a conversation. This reverses
  ADR-0018's "a mention can add an obligation but never remove one".
- **A branch starts as a conversation.** One action on any past message opens
  an empty column to the right, forked there; nothing is written until the
  first send, and that message decides what the thread is.
- **At an agent thread's end, the same action steps back down.** It opens a
  conversation that continues from the end: a new thread with no lane, which
  reads everything above it. The agent thread's lane stays where it is, idle,
  and its column keeps following that lane, not the new branch. `@agent` in
  the conversation later creates the new thread's own lane. At a
  conversation's end the action is hidden: there it would be the same as
  replying. A brief aside in agent work needs no branch: name the people.
- **At the root, two actions: Start Chat and Start Agent.** Both open an empty
  column at the root. In a Start Agent column, a message with no mention asks
  the agent, as if `@agent` had been written, and so creates the lane. That
  default is the unsent column's view state until then; closing the column
  writes nothing. No lane is created empty, so ADR-0020's invariant, *a lane's
  tip is its thread's end*, holds.
- **The send button is the one place that says what a message will do** ("send
  · agent will reply"). There is no mode toggle: a toggle and a button would be
  two statements of one fact.
- **A workspace is its own step**, an explicit action on a thread that is
  already agent work, never implied by `@agent`. Designed with workspaces.
- **A session is its participants.** A session is one document, and the
  boundary of who is in it: sharing, and later presence. Threads, root threads
  included, are topics inside it, so starting a thread at the root is not
  starting a session. Creating sessions is a later step.

**Consequences.** The stored thread rules, the `thread` command,
`setThreadDefault`, `effectiveDefault`, `readThreadRules`, `rulesAlong`,
`ROOT_DEFAULT`, the "from here, …" action and the separate "branch from here"
are gone; `pineta.thread` values already in a session are no longer read. The
host decides a message's addressee from its mentions, the thread's lane, and,
for a Start Agent column's first message, the column's default, which the send
carries. Someone working alone clicks Start Agent once per thread. In agent
work, speaking to people without the agent answering means naming them, or
continuing as a conversation from the end. A branch at a lane's tip is no
longer a reply on that lane: it starts a thread with no lane, parented at the
tip.

**Alternatives rejected.** A stored default per entry (ADR-0018: decided while
reading, and a second record of the lanes). A mode toggle in the composer (it
restates the send button, and the two could disagree). New sessions, or new
branches, starting as agent work (a step up nobody chose; for a branch, a
retry from an old point now needs `@agent`, which is cheap to type and visible
on the button). Creating the lane when Start Agent is clicked (an empty lane
breaks ADR-0020's invariant and creates a pi record for nothing). Keeping
"add, never remove" (to say anything to one person in agent work, you would
have to branch). Switching an agent thread back to a conversation in place (a
lane never moves, and the mode is the lane; a stored switch would restore the
second record this ADR removes).

## ADR-0022 — The agent works in its own repo, visibly, with the person's models

**Status:** Accepted. Evidence: S22, S23. Implemented by
`PLAN-2026-09-27-agent-tools`. Amended by ADR-0023:
the session is compacted, on `json.bind`.

**Context.** To use Pineta to build Pineta, its agent needs pi's editing
abilities: read, write, edit, and run commands. Pineta is shared, streamed and
now persisted, so those abilities must be safe to expose, visible while they
work, and cheap to store. The agent's model should be the person's own, which
for a Claude subscription works only through a pi extension (S23).

**Decision.**
- **The agent works in the repo it runs from.** pi-agent-core's `read`,
  `write`, `edit` and `bash` run in the repo root through `NodeExecutionEnv`.
  The development host gives them by default, since an agent without them
  cannot do the work it is asked for; `PINETA_TOOLS=0` turns them off. A host
  started from code (`startHost`) has none unless given a directory, so no
  suite runs commands by accident. There is no second
  checkout: Node loads the host's code once, jj keeps the agent's edits in a
  reviewable change, and hot reload is off, so the agent's edits to the client
  never reach an open page mid-run.
- **Loopback by default; an invite key anywhere else.** The host binds to
  `127.0.0.1` unless `PINETA_BIND` says otherwise. Off loopback, nothing gets
  in without the key: no page, no file, no WebSocket. The key comes as an
  invite link (`?key=`), which sets an `HttpOnly` cookie and redirects to the
  page without it. Hot reload runs on loopback only, because Vite's socket
  would bypass admission. Two limits:
  - The key decides who gets in, not who is who. Peer ids are chosen by
    clients, so a collaborator can pose as another. Per-person invites are for
    the presence work.
  - The key crosses a network in the clear. That is fine on a trusted network
    or a tunnel; the open internet needs a TLS-terminating proxy.
  - With tools on, anyone with the link can run commands on the machine as the
    host's user. The host says so at startup.
- **Models come from the person's pi setup.** pi's own `SettingsManager` and
  `DefaultResourceLoader` load the person's packages, and only the extensions'
  provider registrations are applied to Pineta's `ModelRuntime`. The settings'
  default model is used unless `PINETA_PROVIDER`/`PINETA_MODEL` override it.
  The system prompt is pi's `buildSystemPrompt`, with the repo's `AGENTS.md`
  and the person's skills. Suites never use this: they name their model, or
  script one.
- **Replies and tool output are one kind of stream, written as text edits.** A
  stream is a record (`streams`) and a text (`streamText`), keyed by a fresh id.
  A reply stream opens on its message's first text and closes when the message
  ends; a tool's opens and closes with the tool. A tool's output arrives as
  snapshots of a view that keeps only the tail, and is written with `tailEdit`:
  cut the front, append the end. pi's own tool-output checkpoints are stored the
  same way (`checkpointText`).
- **A stop control** ends a thread's running turn (`lane.abort`); messages
  waiting for the lane are then taken as usual.
- **The session persists** in a Kyneta SQLite store over `node:sqlite`
  (`.pineta/pineta.db` by default). A starting host clears every stream and run,
  then drains held messages. A later change to the document's root schema
  cannot open an existing store: migrate it, or start a new file.

**Consequences.**
- While a tool runs, its output is in the document twice: as the live stream,
  and as pi's checkpoint; compaction clears both when the run ends (ADR-0023).
  The two could share one text if pi's `tool_update` carried the checkpoint's
  key (`operationId`/`invocationId`); that is an upstream request.
- Kyneta's store repeated bytes when a commit landed while another was being
  written (S22 addendum: 133 KB of 345 KB in one run). Fixed in Kyneta and
  verified from Pineta; until `compact()` works on a live Loro substrate, every
  tool run still grows the store for good.
- Two threads running tools at once share the repo and can collide. Accepted
  until a workspace per lane (ADR-0019). A sandbox for `bash` is a later step.

**Alternatives rejected.** pi-coding-agent's tools and `AgentSession` (they
bring the coding agent's session and extension runtime). A second checkout
(turning hot reload off gives the same safety with one). Whole-value streams
(S22: 45× the bytes). Loading extensions fully (only providers are needed).
Suppressing pi's checkpoints (they are its crash recovery). Loopback only, with
tunnels for sharing (a collaborator on the network should need only a link).

## ADR-0023 — The session is authoritative JSON, compacted; CRDTs only where people type together

**Status:** Accepted. Evidence: S24, S25. Amends ADR-0008, ADR-0016, ADR-0022.

**Context.** The session document was on Loro, a CRDT: every replica could write
it and merge. None does. The host alone writes the session document (pi's
entries, values and lists, streams, lanes, the outbox), and clients send
commands over the Line (ADR-0007, ADR-0018). Meanwhile the document only grew:
Loro keeps every operation, compacting it means either keeping all history or
refusing peers that fell behind (S24), and Kyneta cannot yet compact a live Loro
document. A tool run adds its output many times over (S22). And the browser
loads 3.2 MB of Loro wasm to read it.

**Decision.**
- **The session document is on `json.bind`,** Kyneta's authoritative target:
  plain JSON with serialized writes. The host is its only writer, which is
  already true and is now a rule. A second host for a session would be a
  replica, not a co-writer.
- **It is compacted:** when a run ends, and when the host starts. Compaction
  replaces the store's records with the document as it stands, and trims the
  in-memory operation log, which otherwise grows with every edit (S25). A client
  behind the compacted point receives the whole document once.
- **What is kept is what matters.** The tree is explicit and immutable (ADR-0004,
  ADR-0008), so no conversation is lost; what compaction discards is the history
  of edits to transient state: streams, cleared values, the outbox.
- **Collaborative documents are Yjs, one per document, when they exist.** Notes
  anchored in the tree and shared drafts are written by people at the same time,
  and need merging. Yjs compacts without refusing peers that fell behind (S24).
  Presence is `ephemeral`. Nothing uses Loro.

**Consequences.**
- The browser loads 142 kB gzipped, not about 1,235 kB (S25). The host and
  browser drop `loro-crdt`, and the environment gate its Loro floor.
- The store and the host's memory are bounded by the session's current state
  plus what one run adds, not by its history.
- ADR-0016's rule is moot for the session document, and binds Yjs documents.
- An existing Loro store cannot be opened; a session starts a new file.
- Live Yjs compaction needs Kyneta support before collaborative documents grow
  large.

**Alternatives rejected.** Loro with shallow snapshots: it refuses late peers'
edits, Kyneta cannot yet compact it live, and the wasm stays. Yjs for the session:
a CRDT's merging is unneeded with one writer, and live compaction is also
missing. Loro without compaction: the store and memory grow for good.


## ADR-0024 — Presence is ephemeral, per open column, written by each client

**Status:** Accepted. Implemented by `PLAN-2026-09-27-presence`.

**Context.** Several people share a session, each with their own columns, and
nothing showed who else was there. The composer's "seen by" was removed because,
without presence, any list was a guess. Notes will need "who is editing this".

**Decision.**
- **Presence is a Kyneta `ephemeral` document** (`pineta:presence`): never
  stored, last writer wins per field, and every field decays to `null` without a
  fresh write. Leaving needs no message: a person's entries go quiet and decay,
  which is also what a crashed tab does.
- **Thread-level, and per open column.** Pineta has no focused column: every
  open column reports the end of the thread it follows (`reading`, keyed
  `${writer}:${columnKey}`), refreshed every 10 s while the page is visible and
  deleted when the column closes. `typing` and `editing` are one per writer.
  What is on screen, message by message, waits until thread-level proves too
  coarse.
- **Written by each client, and untrusted.** A client writes only its own keys,
  but nothing can enforce that, just as peer ids are self-chosen.
- **The host refuses client writes to the session document.** A policy
  (`host/policy.ts`) accepts presence and refuses the session; until now nothing
  stopped a client writing the session directly.
- **Shown where there is room.** The rail's 8 px dots take a ring in the
  person's colour, with a count when several share one; the column header
  names others following that thread (the "seen by" that returned); the
  composer says who is typing. You never see yourself.

**Consequences.** A decayed key stays in the record holding `null` (Kyneta
keeps it), so readers skip nulls: fields are nullable, so absence is never a
sentinel string; a crashed tab's keys stay empty until the host
restarts. Documents bound with different decays still sync, so a suite runs
presence with a short decay.

**Alternatives rejected.** Presence in the session document (stored and
compacted for data that lasts seconds, and clients cannot write the session).
Heartbeats with explicit leave messages (the leave is what a crash never sends).
Initials on the rail's dots (no room). A focused column (Pineta has none).

## ADR-0025 — Notes: a message opened for everyone's editing, or a draft of the next one

**Status:** Accepted. Implemented by `PLAN-2026-09-27-notes`. Amended by
ADR-0026 (a queued state; the host refuses no write to a note that
has a record).

**Context.** People could only append messages. There was no shared text to work
on together (a spec, a plan, the next instruction written jointly), no way to
take up an agent's reply and refine it, and nothing marked work as finished.
The roadmap's "shared composition" was the same want, started earlier.

**Decision.**
- **A note is a message opened for editing, or a draft of a thread's next
  message.** Anyone in the session can open any message, the agent's replies
  included; opening it again gives the same note. "Compose together" at a
  column's composer starts its thread's draft, or joins the one it has.
- **Entries stay immutable (ADR-0004), and the model reads them as sent.** A
  note's living text is its own document; it reaches the agent only when sent
  (a draft) or folded (`PLAN-2026-09-27-fold`).
- **Where each part lives (ADR-0023).** The text is a Yjs document per note
  (`note:<id>`), the one place people type together. The record (state, what it
  is the text of, contributors) is a host-written `pineta.note` session value.
  Who is editing now is presence (ADR-0024).
- **The lifecycle: draft, open, done.** A draft is sent through the one send
  path, so a busy lane queues it and a raced reply is a conflict that keeps the
  draft; sent, it is done and linked to its message by the send's id. Mark done
  and reopen are deliberate; a reopened note, once edited, reads "changed since
  done".
- **One draft per thread end.** A draft keeps its place as a send carries it
  (where it started, and its column's lane) and is resolved by `threadOf`
  whenever it is needed, so it follows its thread as the thread grows. Each
  person's own composer stays private.
- **Authorship from the operations.** Kyneta gives each peer's Yjs `clientID`
  from its peer id (S26 addendum), so the host attributes each edit by matching
  the `clientID`s whose clocks moved against the writers it knows. A sent draft
  is its sender's message, "with" its other contributors. This is as
  trustworthy as peer ids, which are self-chosen.
- **Done is enforced by the host.** Its write policy accepts a note's document
  while the note is a draft or open, and refuses it once done or when no record
  names it. With presence, that keeps clients to note and presence documents.

**Consequences.** A note's Yjs document is never compacted: Kyneta cannot
compact a live Yjs document (S24). At note sizes its history is small; it is
recorded as an upstream item. A write the host refused stays in that client's
replica, and that client's later edits to the note build on it, so they do not
reach the host either, even after the note is reopened (measured; S26 addendum
2). The screen never offers a done note for editing, so only a client writing
directly can do this. Pineta's `clientIdOf` copies Kyneta's
`hashPeerId`, which it does not export; a test pins the two together. Yjs adds
about 36 kB gzipped to the page.

**Alternatives rejected.** A note as a separate record anchored beside a message
(a note *is* the message, opened; the conversation about it is its branch).
Editing the entry itself (breaks ADR-0004 and the model's reproducible view).
Contributors reported by the client (the operations already carry their
authors, correctly under relays). Several drafts per thread end (a second draft
is a split; each person has their private composer). Deriving "changed since
done" when read (it would open every note's document to filter the index).

## ADR-0026 — Everything queued is a note; the queue waits at a note someone has open

**Status:** Accepted. Amends ADR-0020 (the outbox) and ADR-0025 (the
lifecycle, and how done is enforced). Evidence: S20, S21, S26, S28. To be
implemented by `PLAN-2026-09-26-queued-notes`.

**Context.** A message waiting for a busy lane sits in `pineta.outbox` as a
frozen copy of its text. It cannot be cancelled or changed, and someone who
wants a waiting instruction to take something into account can only send
another message, whose place relative to that instruction depends on timing.
People are also to leave work queued and walk away: a series of instructions,
shaped together, later with conditions ("if the tests pass, write the plan").
That calls for a queue whose items can be edited while they wait.

**Decision.**
- **Everything that waits is a note.** A message that must wait for its
  thread's lane (the lane runs, or already has messages waiting; ADR-0020)
  becomes a note in state `queued`, with its lane and its sender. This holds for
  plain and compelled messages alike, whether sent from a composer or as a
  draft. Its text is the note's Yjs document, which anyone can edit while it
  waits, with edits attributed as in ADR-0025. `pineta.outbox` is removed. A
  message sent to an idle thread is written at once, as today, and is not a
  note. A queued note is not a draft, so a lane may have many queued notes, and
  "one draft per thread end" still holds.
- **To inform a waiting instruction, edit it.** Items are taken in queue order.
  Someone who wants a step to see something edits that step; a new message
  joins the end of the queue.
- **The queue order is stored,** not derived from ids, so steps can later be
  reordered.
- **Taking.** When the lane is idle, the host takes queued notes in order. It
  reads each note's text at that moment and sends it: appended if it is plain,
  run if it is compelled. The message is the sender's, with the note's
  contributors (ADR-0025). The note is then done, linked to its message by the
  send's id, as a sent draft is.
- **The queue stops at a note someone has open.** The host does not take a note
  that anyone is editing (presence `editing`, ADR-0024), nor anything queued
  behind it. The host cannot know that a note was left open by mistake.
  Besides the end of a run, a change to `editing` also triggers a drain step;
  presence changes, decay included, reach the host as events (S28).
- **Anyone can release the hold.** A release is written to the note's record,
  with who made it, not to presence. It lasts until the note is taken, and until
  then the host ignores presence for that note. The person editing is told
  who released it, and may keep typing until the note is taken.
- **Anyone can cancel a queued note.** It leaves the queue, keeps its text, and
  records who cancelled it (state `cancelled`). Cancel and take both run in the
  host's serial executor, so a cancel that arrives after the take is told the
  note was already sent.
- **The host refuses no write to a note that has a record.** Taking a note
  freezes its message, not the note itself. A write that arrives after the take
  is accepted, stays in the note, and marks it changed since done. The same
  holds for a write that crosses a "mark done" in flight. The screen offers no
  editor for a done note, but the host no longer refuses such a write. A write
  to a `note:` document with no record is still refused. Reason: a refused
  write cannot be recovered from. The writer's later writes wait on the host,
  never integrated, and a fresh replica under the same peer id collides with
  them and corrupts the text (S28).

**Consequences.** The lifecycle becomes: draft, then queued, then done; queued,
then cancelled; open, then done, then reopened. Draining has a third trigger,
presence, and a lane can now be idle while its queue waits on someone editing.
The composer's "queue" promise (running, or with messages waiting) still holds.
A hold is only as reliable as presence. Today the client refreshes `editing`
only on focus and input, so a focused note left untouched lapses after the
decay (30 s). The client must refresh it for as long as the editor has focus.
Browsers throttle timers in hidden tabs beyond that decay, so a hold kept only
by a hidden tab still lapses. Presence is empty when the host starts, so the
host waits one presence refresh (10 s) before taking anything, which gives
someone still in a note time to be seen. Presence is untrusted: any client can
claim to be editing and so hold a lane, which a release undoes. Every queued
message now has a Yjs document, which is never compacted (S24) and which the
host holds for as long as it runs. The storage cost grows with use of the
queue until Kyneta can compact live Yjs. A note's editor must accept no input
until the note has synced, or a reload followed by fast typing corrupts it
(S28); this was already true of every note. ADR-0025's "done is enforced by the
host" becomes "done is shown, and writes after it are marked". A client
that writes directly can change a done note's text, and the note then reads
"changed since done". What these notes make possible, but does not decide: a
condition as a field on a queued note, checked by a run in the lane that ends
with a structured verdict, with both runs in the tree; and Stop pausing an
unattended queue rather than letting it drain.

**Alternatives rejected.** Cancel as removal from `pineta.outbox` (the text
stays frozen at send, and it would be replaced at once). Two lists, one for
ordering and one for a plan of steps (the order between them would have to be
chosen, while editing a step is the direct way to inform it). Returning a
cancelled message to the canceller's composer (anyone can cancel, so it may be
someone else's message). Taking an open note after an idle timeout (a person,
not a clock, decides that it was left open by mistake). Taking the notes
behind an open one (later steps may depend on earlier ones). Refusing writes
once a note is taken and having the client recover by fetching the note again
(S28: this corrupts the text).
