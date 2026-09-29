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

**Status:** Accepted (from S5). Applied to files by ADR-0033: resolving a
merge's conflicts gets labelled sides, and never loses the destination's.

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
ADR-0020 (people own no lanes, so there are no conversation lanes), and by
ADR-0032 (every lane has a workspace; no line of work is on the main working
copy).

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

**Status:** Accepted. Amends ADR-0018 and ADR-0020. Amended by ADR-0029
(Start Chat and Start Agent become the add tab), and by ADR-0032 (a workspace
is created with the lane, not as its own step).

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
the session is compacted, on `json.bind`. Amended by ADR-0032: the agent's
tools run in its lane's workspace, never in the repo the host runs from.

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

**Status:** Accepted. Implemented by `PLAN-2026-09-27-presence`. Amended by
ADR-0029: only the columns of the root tab you are on report.

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

## ADR-0027 — Open columns are kept per tab, with the device's latest as a fallback, and never in the document

**Status:** Accepted. Evidence: S29. Implemented by `PLAN-2026-09-26-persist-columns`.
Amended by ADR-0028, proposed (a stored layout holds the focused piece of
work), and by ADR-0029, which replaces that: a stored layout holds
the active root tab and each root's columns; and by ADR-0030: it
also holds your open roots.

**Context.** Which columns are open is view state, never written (ADR-0024's
reasoning: which paths a person reads is theirs). Nothing else kept it either,
so a reload closed every column but one, and a new tab started from one.

**Decision.**
- **Two slots under one key** (`packages/client/tab-state.ts`): the tab's, in
  `sessionStorage`, which survives a reload; and the device's, in
  `localStorage`, which a new tab starts from. Every save writes both. This is
  the shape of Kyneta's `persistentPeerId` without its lease, since columns
  need no uniqueness.
- **Every change is saved,** `sync` moving a column on included. A column
  restored from an older anchor could follow a newer branch below it.
- **A stored layout decodes whole or not at all,** through a TypeBox schema
  with a version. An older one is dropped, not migrated.
- **A message waiting to be sent is never stored.** Restoring it would send it
  again; a "Branch here" column comes back empty.
- **Anchors the document lacks are dropped once, after `whenSettled`.** Before
  then a missing anchor may only not have arrived yet. Entries are immutable
  and compaction keeps them, so an anchor can only be missing at load.

**Consequences.** Two tabs open at once keep their own layouts across reloads.
A new tab, or the browser reopened, gets the layout of the tab that last
changed, and with two tabs open that can be either, since both move their
columns as messages arrive. Duplicate Tab copies a layout, and, until Kyneta
fixes `persistentPeerId`, the writer too (S29). A layout does not follow a
person to another device: a writer is a tab, and people have no identity
across devices yet.

**Alternatives rejected.** `localStorage` alone (two tabs overwrite each
other). `sessionStorage` alone (a new tab starts empty). The session document,
per writer (it breaks "which paths a person reads is theirs", the host refuses
client writes, and a writer is a tab). The URL (long, noisy, and nothing for a
new tab). Saving only a person's own changes (stored anchors lag). Salvaging
the good columns of a malformed layout (only this build writes it). Pruning
at `"populated"` or `useDocReady` (both come with the first data).

## ADR-0028 — Pieces of work: any message can start one, and everyone sees the same boundaries

**Status:** Proposed. Amends ADR-0027 (what a stored layout holds). Builds on
ADR-0021 (threads are topics inside a session), and ADR-0023 and ADR-0025
(host-written records, and Yjs where people type together). Amended by
ADR-0029: marks stay inside a root, and focus, its breadcrumb and
the whole-session rail sections are withdrawn, along with this ADR's change
to ADR-0027.

**Context.** People use one session for several separate pieces of work, and
start each one where it belongs: a new thread at the root, or a branch off any
message. The rail draws every tree in one column, one after another, with
nothing between them. `projectRail` starts each tree's tracks again at 0, so
every root thread's trunk has the same colour, and colour is the only link
between the rail and the columns (`docs/06-interface.md`). Nothing on screen
says which tree a column belongs to. Grouping by root thread would not fix
this. A branch off message 40 can be as separate a piece of work as a new root
thread, and a root thread is not special (ADR-0021). The steps that cost
something, asking the agent and later a workspace (ADR-0021's table), do not
mark where one piece of work ends and another begins. Nothing records that
boundary, and collaborators need to see the same one.

**Decision.**
- **A mark starts a piece of work at a message, and the piece of work holds
  that message's subtree.** Any message can carry a mark. A message belongs to
  the piece of work of its nearest marked ancestor, itself included. That
  change of membership at a mark is the piece of work's boundary: focus, the
  rail's sections, presence and lanes all follow it. A pure function in
  `packages/core` derives membership when it is read; it is never stored.
- **Marking and branching are independent.** Starting a branch does not start
  a piece of work, and marking a message does not start a branch. An unmarked
  branch belongs to the piece of work above it.
- **Pieces of work nest.** A mark inside a piece of work starts a new one
  there, and that message's subtree leaves the outer one. The session is the
  outermost piece of work: a message with no marked ancestor belongs to it, so
  a thread at the root is no different from one anywhere else.
- **A mark has two optional fields, a name and a description.** Every column
  header holds a place for the mark of the column's first message, filled or
  not. An empty mark is only that place: it is not stored and draws no
  boundary. Typing into either field for the first time makes the mark real.
- **Inside a column, a mark is a section header, and needs a name.** Between
  two messages, a rule appears on hover. Naming it marks the message below it,
  and the rule becomes a section header that sticks to the top of the column
  while its section scrolls. Without a name, a section header would show
  nothing. Which message is a column's first depends on the columns to its
  left, so one mark can be a header in one layout and a section header in
  another; the host checks no position, and the record's name stays optional.
- **A label with no name is computed when drawn,** from the description's
  first line, else the opening words of the marked message. Nothing is stored.
- **The record is a host-written `pineta.work` value, keyed by its own id,** as
  a note's is (ADR-0025). It holds the marked message, the name if any, its
  state (`marked` or `unmarked`), who marked it, and when. Clients mark,
  rename and unmark with commands over the Line, and the host writes the
  record. A message carries at most one mark: marking it again returns the
  existing record. The last rename wins; nobody types a name together, so it
  needs no CRDT (ADR-0023).
- **The description is a Yjs document per mark (`work:<id>`).** People edit it
  together, with edits attributed from their `clientID`s and `editing`
  presence as for notes (ADR-0025). The column header shows its first line;
  the whole editor opens over the columns, as the notes index does. The host
  accepts writes to it while a record names it, whatever the record's state,
  because a refused write cannot be recovered from (S28). This is its own case
  in `acceptsWrite`, apart from notes. A description is not a note: a note is
  a message opened for editing or a draft of the next one, and a description
  is neither.
- **Unmarking is its own action, and removes only the boundary.** Emptying
  both fields does not unmark: the boundary would then depend on the
  description document's text, and drawing the rail would mean opening every
  description (ADR-0025 turned down that cost for notes). The record stays, in
  state `unmarked`, with its name and description; marking the same message
  again brings them back. The tree is untouched.
- **A fresh column's header can be filled before its first send.** A fresh
  column writes nothing until then (ADR-0021), so what was typed waits in the
  column. Once its first message is written, the column marks it with the
  name and then writes the description into its document, so the description
  is attributed to its writer as any edit is.
- **Marking is free, and is not a step up.** It spends nothing and stores only
  the record. A piece of work shows the lanes in it, and later their
  workspaces (ADR-0019), but does not own them. A lane is in the piece of work
  that holds its tip.
- **Which piece of work you look at is yours.** Focusing on a piece of work is
  view state, never in the document. It is not the focused column ADR-0024
  rejected: every open column still reports its thread. ADR-0027's stored
  layout gains the focused piece of work, under a new version, so layouts
  stored before this are dropped once. With nothing stored, you see the whole
  session: no focus, every open column whole, and marks shown as headers and
  section headers. A stored focus whose mark is gone, or unmarked, falls back
  to the whole session, checked after `whenSettled`, as missing anchors are.
- **A focus shows every column with messages in its piece of work, cut at the
  piece's boundaries.** Past a boundary, a column shows one labelled line:
  above, the path it reads ("reads 3 messages above"); below, where it goes
  ("continues in: Refactor"). A nested piece of work that starts at a branch
  shows as its fork dot and a collapsed row on the rail. The open columns are
  one list: a focus filters it, so focusing on another piece of work hides
  columns rather than closing them, and the whole session shows them all
  again.

**Consequences.** The rail's whole-session view draws each top-level piece of
work as a labelled section. Focused on a piece of work, the rail draws its
subtree, each nested piece of work collapsed to one labelled row, and one line
above for the path it reads, which opens on demand. `docs/06-interface.md`
needs rewriting for the rail, the column header, section headers and focus.
Who is in a piece of work follows from presence's `reading` keys (ADR-0024),
with no new field. Marking a message moves every lane whose tip is below it
into the new piece of work, and unmarking moves them back; neither writes to a
lane (ADR-0020). Every description is a Yjs document, never compacted
(S24); descriptions are short, so the cost is small beside queued
notes (ADR-0026). The agent reads neither the name nor the description. An
agent updating a description later needs no change to the record or the
document, since the host can write the document as it seeds a note; when the
agent does so, and how its edit meets people typing, is left for later. The
hover rule and the description editor are reachable only by pointer for now;
keyboard access and touch are a later step. Reusing track colours across trees
is a separate fix, and this ADR does not depend on it.

**Alternatives rejected.** Root threads as the unit (a branch can be as
separate, and roots are not special). Marks kept in the browser (collaborators
would each draw their own boundaries). A piece of work per lane or per
workspace (a conversation can be a piece of work, one piece of work can hold
several lanes, and a tidy screen would cost disk). Separate sessions (a
session is who is in it, ADR-0021, and a branch reads the messages above it).
One rail per root thread, side by side (the gutter widens with every root
thread, and the rails still sit apart from their columns). Every thread its
own piece of work (every aside would split off, and a piece of work could not
span a thread and its branches). Marks only at a thread's first message (work
that drifted partway down a thread could not be marked where it began). A name
required on every mark (someone who would rather describe than label must
invent a title). A stored default name (it would read as chosen). Unmarking by
emptying both fields (the boundary would live in the description's text). The
description as a note (a description is not a message, and is never sent).
The name in the Yjs document (nobody types it together). Deleting the record
on unmark (the description would be lost).

## ADR-0029 — A tab per root, an archive shared by everyone

**Status:** Accepted. Implemented by `PLAN-2026-09-27-root-tabs`. Evidence:
S30, S31. Amended by ADR-0030: the tab bar is each person's, and a
tab closes for you. Amends ADR-0027 (a stored layout holds a
tab and columns per root), ADR-0028 (marks stay inside a root; focus is
withdrawn), ADR-0021 (where Start Chat and Start Agent live) and ADR-0024
(which columns report presence).

**Context.** The rail draws every tree in one strip, one after another, and
columns from different trees sit side by side. `projectRail` starts each
tree's tracks again at 0, so trunks share a colour, and a column on another
root has no fork dot and no header stripe: nothing on screen says which tree
it belongs to. ADR-0028 answered with marks and a focus. A root is a stronger
boundary than a mark, though. A column's context is its path to its root, so
nothing in one root is ever in the context of another, while a branch off
message 40 reads the 39 above it. Roots also only accumulate. Nothing marks a
root as finished, so the rail grows with every thread anyone has started, and
there is no way to put one aside, or to take it back.

**Decision.**
- **Each root has a tab, which shows only that root's tree:** its rail, and its
  columns. Every column in a tab shares the root, so each column after the
  first has a fork point, and colour always links a branch to its parent.
  Tracks start at 0 in each rail. An orphan counts as a root, as it does on
  the rail today.
- **The tab bar is the same for everyone:** every root that is not archived,
  in creation order (id order, S9). Which tab you are looking at is yours.
  A root someone else starts appears as a tab and does not take you there.
- **Archiving hides a root for everyone, and deletes nothing.** The record is
  a host-written `pineta.archive` value keyed by the root's entry id: its
  state (`archived` or `restored`), who changed it and when. Clients archive
  and restore with a command over the Line. Anyone can do either. Entries are
  immutable (ADR-0004), so archiving touches no entry.
- **An archived root is read-only until it is restored.** The host refuses
  commands that would write in it: a message attached there, a note opened,
  drafted, sent, marked done or reopened there, a reference written there, a
  mark (ADR-0028). A reference is written where its author reads, so one
  written in an open root that cites an archived message is accepted. The host does
  not refuse writes to Yjs documents (notes, descriptions) because their
  message is in an archived root: a refused write cannot be recovered from
  (S28). The screen offers no editor there.
- **Archiving is refused while any lane in the root runs or has messages
  waiting** (ADR-0020, and queued notes, ADR-0026). A lane is in the root that
  holds its tip. Stopping the run or holding the queue instead would do work
  nobody asked for. Refusing leaves the choice with the person.
- **Commands race in the host's serial executor.** A message that arrives
  after the root was archived is refused, naming who archived it, and its
  composer keeps the text, as it does after a conflict.
- **The Archive tab is the leftmost tab,** and it works differently: a list,
  not a rail with columns. It lists every root, open or archived, with its
  label, last activity, who wrote in it, its message and note counts, and its
  state. It filters by state and to roots you wrote in, and searches message
  text. Selecting a row shows that root's rail and one read-only column.
  **Restore** puts the root back in the tab bar and switches to it.
- **The add tab is the rightmost tab,** a split button: **＋ agent** as its
  main action, and **conversation** in its menu, since a conversation at the
  root is the rarer start. It replaces the rail's `+` and the Start Chat and
  Start Agent buttons; what each does is ADR-0021's, unchanged. A new tab is
  local until its first send, like any fresh column: only its opener sees it,
  it sits beside ＋, and closing it leaves no trace. Its first send makes the
  root, and the tab joins everyone's bar.
- **Marks and branches stay inside their root** (amends ADR-0028). A marked
  branch never becomes its own tab: it reads the messages above it, and a tab
  of its own would hide them. ADR-0028's focus, its breadcrumb and its
  whole-session rail sections are withdrawn. Tabs split the session where
  context splits, and marks name the work inside a root. There is no view of
  the whole session.
- **A tab shows what a whole-session rail would have shown:** a pulse while a
  lane in the root runs, and who else is reading there (presence `reading`,
  ADR-0024, resolved to its root). Unread marks follow when presence has a
  last-read position.
- **Only the tab you are on reports presence** (amends ADR-0024): its columns
  report the threads they follow, and switching tabs clears the last tab's
  reports. Columns in other tabs are kept, not read, so reporting them would
  put you in every tab you have ever opened.
- **The layout is kept per browser tab, with one layout per root** (amends
  ADR-0027): the active tab, and each root's columns. Archived roots' layouts
  are kept, so restoring a root brings its columns back. A layout stored before
  this change fails to decode and is dropped once.
- **"Root tab" in docs and code.** "Tab" alone already means a browser tab
  (`tab-state.ts`, ADR-0027). On screen, a root tab shows only its label.

**Consequences.** `docs/06-interface.md` gains a tab bar, the Archive tab and
the add tab, and its rail becomes one root's. The special case of a column on
another root goes, and so does the colour repeat between trees that ADR-0028
cites; colours can still shift inside a tree as it grows. The notes index
counts the tab's root; searching across roots is the Archive tab's job. A
root's label is its first message's text until a mark names it (ADR-0028). If
someone archives the root you are looking at, the tab stays while you are on
it, read-only, saying who archived it, with **Restore**; it leaves the bar when
you switch away, and after a reload you land on the newest open root, or on
the Archive tab if there is none. References show only as counts: the link
between columns that `docs/06-interface.md` describes was never built, and
this ADR adds none across roots. What carries something from one root to
another is the inventory planned with fold (`PLAN-2026-09-27-fold`). Picking
up writes nothing, so it will work in the Archive tab's preview too, and what
is picked up there is cited or folded into an open root. A fold from another
root cannot be drawn as a rail edge, since each rail is one root's, so its
fold row will have to name and link its source instead. With many roots open, the tab bar scrolls; Archive and
＋ stay put. On a narrow screen, the tab bar becomes a switcher above the
stacked columns. The Line gains a command and two outcomes, which changes the
schema of stored Lines; a store written before still opens and serves (S31).
Clients and host ship together.

**Alternatives rejected.** Tabs each person opens and closes (a collaborator's
new root would not reach you, and the Archive tab would become an inbox).
Every root always a tab (the bar grows forever). A per-person archive (people
sharing a session would each tidy their own bar, and would disagree about what
is current). Replying in an archived root to restore it (work would come back
without anyone deciding it should). Archiving that stops the agent or holds its
queue (it does work nobody asked for). Suggesting, or automatically archiving,
roots idle for a long time (not now: a person decides what is finished).
Deleting archived roots (entries are immutable, and archiving by mistake must
be undoable). Archiving a branch inside a root (closing its column already
hides it from one reader, and it stays on the rail). A marked branch as its own
tab (it would hide the context it reads). A whole-session view beside the tabs
(the tabs carry its signals). One rail per root, side by side (ADR-0028: the
gutter widens with every root, and the rails sit apart from their columns).
A separate session per root (a session is who is in it, ADR-0021).

## ADR-0030 — Your tabs are yours; the header shows who is here, and your inbox of mentions

**Status:** Accepted. Implemented by `PLAN-2026-09-27-your-tabs-inbox`.
Amends ADR-0029 (the tab bar is each person's; closing
a tab is yours) and ADR-0027 (a stored layout holds your open roots, and the
device keeps which mentions you have seen).

**Context.** ADR-0029 gave everyone the same tab bar, every root not archived,
and rejected tabs each person opens and closes: a collaborator's new root would
not reach you, and the Archive tab would become an inbox. In use, the shared
bar has no way to close a tab for yourself: a root leaves it only when someone
archives it for everyone, and the bar grows with every thread anyone starts.
What a person wants from the whole session is not every root at once, but what
is happening now: who else is here and where, and what the agent is doing.
Shown in the header, that is how a collaborator's work reaches you, and the
bar can be yours.

**Decision.**
- **Your tabs are the roots you have open.** `×` on a root tab closes it for
  you and writes nothing, as closing a column does. Closing keeps the root's
  columns, so opening it again brings them back. A root you start opens as
  your tab (it began as your new tab); a root someone else starts does not.
  Tabs keep the order you opened them in, new ones at the right beside ＋.
- **You open a root from wherever it is shown:** a person or the agent in the
  header, a mention, a reference, or the Archive tab (**Open**). Opening shows
  it, never behind your back: nothing opens or switches a tab on its own.
- **The header shows who is here, from live data only**, as a document editor
  shows avatars of the people in it:
  - **people:** an avatar per person with a live presence entry (ADR-0024), in
    their colour. Hovering names them and the thread they are in; a click
    opens that thread as your tab, with a column on their path. You are never
    shown;
  - **the agent:** one avatar while any lane runs, pulsing, with the number of
    threads it is working in. A click lists those threads, and a row opens
    one. Idle, it is not shown.
- **A mention is a notification, not a tab.** `@` in the header is your
  inbox: the messages that mention you, newest first, each with who, the
  thread, and the start of the message. A message mentions you when its
  mentions resolve to you, by the same `address` the send button uses. A row
  opens that thread as your tab, with a column on the message; in an archived
  root, it opens the root's preview in the Archive tab. The items are derived
  from the tree; only what you have seen is stored.
- **The count on `@` is the mentions you have not seen.** One is seen when you
  open it from the inbox, when it is drawn in a column of the tab you are on,
  or when you mark all seen. Seen is the only state: a mention seen stays in
  the inbox, which can show only the unseen.
- **Seen is kept per device** (`localStorage`), shared by every tab on it, and
  never leaves the browser: `{ since, seen }`. `since` is an entry id: every
  mention at or before it is seen, and `seen` holds the ids of mentions after
  it that you have seen. "Mark all seen" moves `since` to the newest mention
  and empties `seen`, so the set stays small. With nothing stored, `since` is
  the newest entry at the first load, so a device starts with no backlog. The
  stored form decodes whole or not at all, and a version it does not know
  starts afresh.
- **Archiving stays a shared "done"** (ADR-0029): the host-written record,
  read-only until restored, refused while the agent works there or messages
  wait. Archiving takes the root out of every tab bar; the tab you are on
  stays while you are there, as before. Restoring opens it as a tab only for
  whoever restores it.
- **Tabs keep their signals** (ADR-0029): a pulse while the agent works in
  that root, and avatars of the others on it. Only the tab you are on reports
  presence.
- **The stored layout holds your open roots, in order**, beside the tab you
  are on and each root's columns (amends ADR-0027). A layout stored before
  this change is dropped once. Neither the open roots nor what you have seen
  is ever written to the document.

**Consequences.** Nothing new is stored in the document, the host and the Line
are unchanged, and archiving works as built. The inbox is a pass over every
chat at each change, which is O(entries), as every view is. A mention made
while you were away counts on your return, on the same device. What is left:
- **another device, or a cleared browser, starts afresh** from its first load:
  a person has no identity across devices yet, so the inbox is a device's;
- **"you" is a name:** a mention resolves to a handle, and a handle to your
  display name, so renaming yourself changes which mentions are yours, and
  two writers with one name share them;
- **a root someone starts without mentioning you, and then leaves,** reaches
  you only through the Archive tab;
- **someone whose only view is the Archive tab** reports no presence, so the
  header does not show them.

Presence is untrusted (ADR-0024), so an avatar is only as honest as the client
that wrote it.

**Alternatives rejected.** A shared tab bar (ADR-0029: nobody could close a
tab for themselves, and the bar grew with everyone's roots). Opening a tab
when you are mentioned (nothing on screen may appear by itself, principle 6 of
`docs/06-interface.md`; the notification leaves the choice to you). A count
kept in page memory (a reload lost it, and a mention made while you were away
never counted). Seen state in the session document (everyone replicates it,
so it would tell everyone what you have read, and the host refuses client
writes to it). An inbox per person, stored by the host (deferred until a
person has an identity across devices; the device's inbox is shaped to move
there). "Done" beside "seen", to take a handled mention off the list
(deferred: one state is enough while mentions are few, and done is one more
flag on the same item). A last-read position per root, for unread marks on
tabs, an "N new" count and a "what's happening" panel (deferred: it needs a
rule for "seen" over every message, not a few, and one position per root
misreads branches; it can reuse the inbox's storage and rule). Mentions of
other kinds, such as the agent finishing what you asked (deferred). Browser
or system notifications (deferred: they need permission, and the header
serves a person with the page open). Storing notifications in the document (a
notification is its reader's, and the mentions are already in the tree).
Showing the agent while idle (it is not doing anything; the header shows
what is happening).

## ADR-0031 — The rail compacts uneventful stretches, and never compacts structure

**Status:** Accepted. Implemented by `PLAN-2026-09-27-rail-runs`. Evidence:
S33. Amends `docs/06-interface.md` (the rail is no longer a dot per message).

**Context.** The rail drew a dot per message on a 16 px row. Tool results get
no row, but each step of an agent's work does, so a loop of 200 steps was
about 3,200 px of identical dots. Forks, branches, notes, others' rings, a
running tip and the ends of open columns were lost among them. A long
conversation between people has the same problem. Clicking a dot is also how a
reader gets to a message, and that did not always bring it into view (S33).

**Decision.**
- **A message is a landmark if it is any of:** the root's first message, a
  branch's first message, a fork, a thread end, a note's message, a thread end
  someone else follows, a running lane's tip, or the end of a column you have
  open. Every other message is uneventful.
- **A stretch of three or more consecutive uneventful messages is one run,**
  whatever their kind: people's messages and the agent's alike. An uneventful
  message has exactly one child, on its own track, so a run holds no structure
  and the compacted rail has every branch the full one has.
- **A run is a capsule on its track, one row long plus one per digit of its
  size:** 3–9 messages take 2 rows, 10–99 take 3, 100–999 take 4. Its length
  shows roughly how much is inside it. Its fill says who wrote it: hollow for
  the agent's work alone, solid for people alone, and filled at half strength
  for both.
  Hovering gives the exact figures: "12
  messages from Ada and Bea · 143 agent messages · 211 tool calls · 2 failed".
- **Clicking a capsule opens the message at that point of the run,** in view:
  a click a quarter of the way down opens the message a quarter of the way
  through. The capsule is far shorter than its messages, so this is
  approximate. A click from the keyboard opens the first message. The column
  is where a run is read; the rail does not expand it.
- **A pick from the rail lands in view:** the message is scrolled to if it is
  not already visible, and its column is told it was placed, so it holds there
  rather than following its end.

**Consequences.** Which messages are landmarks depends on the reader's open
columns and on who else is here, so two people can see the same root's rail
compacted differently, and a rail changes as columns open and close. The rail
was already each reader's (which paths are marked, the rings). While the agent
works, each step joins the run behind the running tip; the count rises every
step, but the capsule grows only at 10, 100 and 1,000. A message inside a run
is reached through its column. `projectRail` still returns a row per message,
so tab summaries, the Archive tab's search and branch colours are unchanged;
the compaction is a second step that only drawing reads. If marks (ADR-0028)
land, a marked message is a landmark.

**Alternatives rejected.** A fill in proportion to the share people wrote (a small share filled only
the capsule's rounded end, and read as a drawing fault). The bottom half filled for a mixed run (it read as a gauge, half full of
something). A larger circle with a digit inside, capped at 9 and
then a symbol for "many" (a circle that fits a digit is wider than the 12 px
between tracks, and the cap hides the difference between 12 and 400). Separate
runs for agent work and for conversation (the kinds alternate every turn, so a
session of many short turns would still cost three rows a turn). Expanding a
run in place on click (a run has no structure inside it, so it would show only
identical dots, and a click on the rail would mean two things). Always opening
a run's first message (a long run's middle could only be reached by scrolling
the column). Returning runs
from `projectRail` (every reader of rows would have to learn about them).
Collapsing runs in the columns too (a separate decision; the column is where a
run is read). A red mark on a capsule holding a failed tool call (tried: nothing
said what it meant, and it did not lead to the failure; the label counts
failures instead).

## ADR-0032 — A lane works in its own jj workspace, and each turn that changes files is a revision

**Status:** Accepted. Evidence: S36. Implemented by
`PLAN-2026-09-27-workspaces`. Amends ADR-0019 (the trunk is no longer
a line of work on the main working copy), ADR-0021 (a workspace is no longer
its own step) and ADR-0022 (the agent no longer works in the repo the host
runs from). Changes the vision's branch kinds (`docs/00-vision.md`): every
agent lane is a Worktree. **Amended by ADR-0034:** its workspaces, the
rewrite of the history the model is sent, the refusal of other lanes' paths,
and dependency setup are replaced by a container per lane on its own disk.

**Context.** The agent's tools run in the repo the host runs from, so two
threads running tools at once share one directory and can collide. ADR-0022
accepted that until each lane had a workspace. ADR-0019 said a work lane would
own a jj workspace, created with the lane. ADR-0021 then made the workspace
its own step, taken deliberately, because it spends disk and CPU.

S36 measured that cost. `jj workspace add` takes 0.2 s for this repo. The
expensive part is dependencies: `pnpm install --offline` from pnpm's store
takes 2–3 s and about 7 MB, and a copy-on-write clone of every `node_modules`
about 6 s and 11 MB on APFS. Creating the workspace at
the agent's first write instead would save that for read-only threads. But
writes through `bash` cannot be detected without a sandbox, and the agent
would see its directory change mid-run: a symlink swap cannot hide the real
path (S36 item 8).

A branch reads everything above it, so a lane forked from an agent's message
should also start with the files as they were at that message. jj already
records file states as revisions, and a jj merge takes only what is new, as a
fold does (S36 items 11 and 12).

**Decision.**
- **Every lane has its own jj workspace, created with the lane.** The
  directory is `workspace/<lane>` in the repo, and the jj workspace has the
  lane's name. The host lists `/workspace/` in `.git/info/exclude`, so no
  tracked file changes (S36 item 16). Nothing stored maps a lane to its
  workspace. Setup runs alongside the model's first turn, and a tool call that
  arrives first waits for it. A conversation thread has no lane, so it has no
  workspace. A host started without tools creates none. A lane that works
  directly (below) has none either.
- **Where repos are is asked of jj, never inferred from the file system.**
  A secondary workspace's `.jj/repo` is a file, not a directory, and from
  inside a jj workspace nested in another repo, git names the outer repo
  (S36 item 17). Every lane's workspace has that shape. So:
  - the project is `jj workspace root --ignore-working-copy`, run from the
    host's directory;
  - the lanes' directories come from `jj workspace list`;
  - "your working copy" is the workspace the host runs from, which need not
    be `default`.

  No code looks for `.jj` or `.git` itself. Every jj command the host runs
  takes `-R <root>`, never relying on its own working directory, since a
  command run from the wrong directory acts on whatever repo surrounds it.
  The host acts on each command's exit status, never on its printed output
  (S36 item 28). `jj git init` is the one exception: it runs with the
  directory as its working directory, because `-R` needs an existing repo
  (S36 item 24).
- **A project with no jj repo is initialized.** Only when jj finds no repo
  does the host ask git (`git rev-parse --show-toplevel`):
  - **git names a repo:** `jj git init --colocate` at its top level. git keeps
    working, and removing `.jj` undoes it.
  - **git finds none:** `jj git init` in the host's directory, which creates
    both (S36 item 15).
  - **your home directory or `/`:** never initialized, whichever step would
    initialize there. A home directory that is a dotfiles repo would
    otherwise be what git names; lanes then work directly.

  jj's own init is the last word: if it refuses, the host reports why, and
  lanes work directly. In a git worktree it refuses to colocate (S36
  item 24). The host says at startup what it found and what it
  did. A directory that a lane names to work in is never initialized.
- **A lane can instead work directly in a directory.** A lane's workspace
  setting is either:
  - **own copy** (the default): the workspace this ADR describes;
  - **directly in a directory**: the tools run in a directory you name, your
    working copy by default, repo or not, with no workspace and no revisions.

  The setting is chosen when the lane is created, at the send that first asks
  the agent (ADR-0021). The send button says where, as it says what: "send ·
  agent will reply · in its own copy ▾". A new lane inherits the setting, and
  the directory, from the lane above its fork point. A root lane takes the
  host's default: own copy, unless `PINETA_WORKSPACES=0` or the project could
  not be initialized. The setting never changes on an existing lane, since
  the files and the conversation would then disagree (the reason lanes never
  move, ADR-0020): to work differently, branch and choose again. So it is
  stored, in a host-written value per lane, written once. A lane that works
  directly records its prompts with no commit, so a lane of its own copy
  branched below it starts from the nearest revision above, or `@-`.
- **Your working copy is yours.** No agent writes to it, except a lane you set
  to work directly there. Otherwise the host's code and the page it serves
  never change under a run, so hot reload comes back on (off while a lane
  works directly in your working copy), and "run `jj new` first" is no
  longer needed. Context
  files and skills are still read from your working copy (ADR-0022), not the
  lane's.
- **A lane starts with the files at its fork point.** A revision is recorded
  against every run's prompt (the files the run starts with) and against
  every message whose tool calls changed files (below). A lane created at
  entry E starts its workspace from the nearest revision at or above E. The
  nearest record above E also names the lane E belongs to, which is where a
  new lane inherits its setting from. With no revision above, a lane starts
  from `@-`, resolved when the lane is created: everything
  you have committed, not what you are still editing. After `jj new`, that is
  exactly your files. When your working copy has changes, the composer says
  the agent will not see them.
- **A turn revision per assistant message whose tool calls changed files.**
  pi calls an assistant message and its tool results a turn. When a message's
  tool calls finish, the host snapshots the lane's workspace. If anything
  changed, the host commits it (`jj commit`), described with the message's
  first line, with the entry id and lane as trailers. It records the commit id
  against the message's entry in a host-written `pineta.revision` value, keyed
  by the entry's id. A message whose calls changed nothing gets no revision; a
  branch from it starts from the nearest one above. A run's prompt always gets
  a record: changes made in the lane's directory between runs are committed
  as their own revision, and otherwise the prompt records the lane's newest
  revision.
- **Revisions a lane builds on are immutable.** The host keeps a local
  bookmark per lane, `pineta/<lane>`, at its newest revision (the only place
  that revision is stored), and extends
  `immutable_heads()` in the repo's config with `bookmarks(glob:"pineta/*")`.
  jj treats every ancestor of an immutable head as immutable. So no agent,
  and not you without `--ignore-immutable`, can rewrite a revision a lane
  builds on, including the `@-` a lane started from. Workspace-level config
  would protect only from commands run in that workspace (S36 item 10).
- **Staleness is prevented, not repaired.** A workspace goes stale only when
  something outside it rewrites its history. Immutability covers what is
  committed, and folds and landing are merges, which rewrite nothing (S36
  item 11). `jj workspace update-stale` runs only as a guard at a run's start,
  after the previous run's end committed everything. It is a no-op unless
  someone overrode immutability. Repairing a stale workspace mid-run can take
  uncommitted edits off its disk (S36 item 7).
- **A lane's tools see only its workspace.** The run's `Context` carries the
  lane's workspace. pi's `toolContext` and system prompt are functions of it
  (`harness/runtime/drive/tools.js`), so the tools run there and the prompt
  names it (S36 item 18). Every call that drives a lane carries it, `resume`
  as well as `prompt`: after a crash, a lane is `LaneBusy` until resumed, and
  the resumed run's tools use the directory in `resume`'s `Context`. The host
  resumes such a lane itself. `packages/pi/agent.ts` currently assumes
  `LaneBusy` cannot arise. As a backstop to the rewrite below, pi's file
  tools refuse a path in your working copy or in another lane's workspace, and
  the error names the same path in the lane's own. Paths elsewhere are
  allowed. `bash` is not covered until it is sandboxed (ADR-0022). The lane's
  environment sets `JJ_EDITOR`, `VISUAL` and `EDITOR` to a command that fails:
  a jj command that opens an editor would otherwise hang a shell with no
  terminal until its timeout. With it, such a command fails in under a
  second (S36 items 13 and 21).
- **The model sees its history as if it had always worked in its own
  workspace.** A branch reads everything above it, and the parent's messages
  name the parent's paths (`read …/workspace/t-A/packages/core/index.ts`),
  while the branch works in `…/workspace/t-B`. pi's `transform_context`
  hook runs before every model request, on pi's messages before they are
  converted for the provider, and its event names the lane
  (`harness/runtime/drive/generation.js`). There the host replaces every other
  lane's workspace root, and your working copy's root, with this lane's root,
  in everything the model is sent: its text, tool-call arguments, tool
  results and summaries.
  - **The rewrite is true.** A lane starts from the revision at its fork
    point, so each path the parent named had, at that point, the content the
    same relative path has in the branch. The model is not told of a switch:
    as far as it can see, there was none.
  - **The tree keeps what happened.** Entries are immutable (ADR-0004), so
    the column shows the paths as they were written. Only what the model is
    sent changes.
  - **Only lanes with their own copy are rewritten.** A lane that works
    directly does not start from its fork point's files, so the rewrite would
    be false there; its history is sent as written.
- **Setup installs dependencies, then re-points links that leave the
  workspace.** After `jj workspace add`:
  - **A pnpm repo** (a `pnpm-lock.yaml`) gets
    `pnpm install --offline --frozen-lockfile` from the store
    `pnpm store path` names in your working copy. It takes 2–3 s here,
    installs from the lane's own lockfile, and imports copy-on-write where
    the platform can (S36 item 27). If the store lacks a package, the offline
    install fails at once, and the host installs online.
  - **Any other repo** gets a clone of every `node_modules` from your working
    copy. Only `cloneTree(src, dst)` differs by platform: `/bin/cp -c -R` on
    macOS, and `cp -R --reflink=auto` on Linux, which clones on btrfs or XFS
    and copies in full on ext4. The host checks at startup whether cloning
    is copy-on-write and says so.

  Either way, the host then re-points each symlink whose relative target
  leaves the workspace, resolved from your working copy's matching location
  (S36 items 5 and 27). What to install or clone and which links to re-point
  are planned purely; only the commands are effects.
- **A fold merges files too.** Beside ADR-0010's fold of the tree, folding a
  source into a target runs `jj new <target's newest revision> <source's
  revision at the folded tip>` in the target's workspace. It runs at the start
  of the fold's run, so the target is idle and ADR-0020's queueing applies.
  jj records conflicts in the merge rather than failing, and ADR-0033
  resolves them.
- **Landing: the lane merges your work in, and you take the result.** To bring
  a lane's work into your working copy, the lane merges your `@-` into itself
  (`jj new <lane's newest revision> <your @->`), in its own workspace, and
  resolves any conflicts there (ADR-0033). Only a resolved merge is offered
  to you. Taking it is one action, `jj rebase -r @ -d <merge>` in your working
  copy: your uncommitted changes stay in `@`, now on top of the lane's work.
  It is the only time the host writes to your working copy, and only when you
  ask.
- **A workspace exists whenever its lane runs.** Before every run, the host
  makes sure the workspace is there. It recreates a missing directory at the
  lane's newest revision and runs setup. Crashes, restarts and deleted
  directories take this one path.
- **Archiving a root removes its lanes' workspaces** (ADR-0029): `jj
  workspace forget`, the directory, and the lane's bookmark, so its revisions
  become ordinary commits again. Nothing in the repo is lost. Restoring sets
  each bookmark again, and a lane's next run recreates its workspace.

**Consequences.**
- **Branching from any message of agent work also branches its files.** Every
  message whose tool calls changed files has a revision, so it can show its
  own diff (`jj diff -r`).
- **ADR-0022's collision is gone for pi's file tools.** `bash` can still reach
  outside its workspace until it is sandboxed.
- **The vision's branch kinds collapse.** Aside is a conversation thread,
  which has no lane; every agent lane is a Worktree, and Scout's shared
  read-only workspace is not needed. The vision's third merge problem, effect
  merge, becomes a jj merge and ADR-0033.
- **`jj log` holds every lane's revisions**, one per file-changing message,
  under `pineta/<lane>` bookmarks. `jj git push --all` would push those
  bookmarks too (S36 item 23); push by name.
- **A turn revision costs about a tenth of a second** per message: 84 ms when
  nothing changed, 144 ms with a commit (S36 item 26).
- **While a lane builds on your `@-`, jj refuses to rewrite it.** A `squash`
  into it, or a `describe` of it, is refused; `jj new` and editing `@` are
  not affected (S36 item 19). After landing, the merge under your `@` is
  immutable in the same way (S36 item 20). Overriding with `--ignore-immutable` while that lane runs is
  exactly the hazard of S36 item 7.
- **A lane costs 2–3 s and about 7 MB with pnpm's store.** A clone costs
  about 6 s and 11 MB on APFS, and a full copy of `node_modules` on ext4. A
  cloned lane has your installed dependencies, which may not match its base's
  lockfile until it installs.
- **Lanes can run the test suites at once:** the whole `verify` gate passed
  in a workspace, and e2e ran in a workspace and in your working copy at the
  same moment without a port collision, since its host takes `port: 0` (S36
  item 25). A lane starting the development host needs `PINETA_PORT=0`, or
  it collides on 7391.
- **Taking a landing changes the host's own files.** Host code needs a restart
  to take effect, as today.
- **Pineta's own `link:` dependencies on Kyneta** are relative, so they need
  the re-pointing step. That step handles any repo's links that leave it.
- **A host started from one of its own lanes' workspaces finds the right repo
  and workspace,** because jj answers, not a directory check.
  `.git/info/exclude` applies in a secondary workspace too (S36 item 22).
- **Initializing changes a project that had no jj**, once, and says so. In a
  git repo, git keeps working beside jj.
- **A lane that works directly gives up what a workspace gives:** branching
  does not branch its files, a fold does not merge them, there is nothing to
  land, and two such lanes in one directory can collide, as before this ADR.
  Its column header says where it works and that the directory is shared. In
  your working copy, it turns hot reload off while it works, for ADR-0022's
  reason: its edits to the client would reach an open page mid-run.
- **An isolated lane already works outside its workspace** wherever that is
  not your working copy or another lane's workspace (for example
  `~/halecraft/kyneta`). Working directly is for tasks that must change your
  working copy, or that happen where no repo is.
- **A message that means another lane's workspace is rewritten too,** for
  example one comparing two branches' files. That is rare. A lane can still
  reach another lane's files through its revisions (`jj file show -r`).
- **Not measured:**
  - the browser suite inside a workspace (it needs a Playwright server
    outside the sandbox);
  - installing or cloning on Linux;
  - the `transform_context` rewrite reaching the model (read in pi's
    source, not run).

**Alternatives rejected.**
- A workspace as its own step (ADR-0021): a person would have to decide at send
  time whether the agent will write, for a cost S36 put at seconds and
  megabytes.
- Creating the workspace at the agent's first write (`bash` writes cannot be
  detected without a sandbox, and the switch is visible mid-run).
- A symlink swapped from the repo to a workspace (the agent sees the real path
  at its first command, S36 item 8).
- Symlinking `node_modules` back to your working copy (pnpm's relative links
  resolve to your packages, so a lane would test your code, not its own; S36
  item 3).
- Node's `fs.cp` as the portable clone (a full copy on macOS, S36 item 14).
- Cloning `node_modules` in a pnpm repo (slower than pnpm's offline install,
  and the dependencies would be yours rather than the lane's lockfile's; S36
  item 27).
- Forking root lanes from `trunk()` (here `main` is nine commits behind your
  work).
- A frozen copy of your working copy (landing conflicts wherever you keep
  editing the changes it copied).
- Your live `@` (every snapshot of your working copy rewrites it and would
  rebase every lane on it).
- One revision per run (a branch from a message mid-run would get the files
  from the previous run's end).
- Snapshots recorded without committing (the commit ids are rewritten on the
  next snapshot, and old ones survive only until `jj util gc`).
- Immutability in each workspace's config (it protects only from that
  workspace, and it outlives the workspace).
- `update-stale` as a routine sync (it can take uncommitted edits off the
  disk).
- Merging a lane into your working copy directly (its conflicts would land
  where agents never write).
- Landing by rebasing or squashing a live lane (it rewrites the lane's history
  and stales it).
- Mapping a foreign path in a new tool call silently to the lane's own (a
  refusal that names the right path is visible, and the agent corrects it).
  Rewriting the history the model is sent differs: it states what was true
  at the fork point, and it prevents the wrong path rather than catching it.
- Telling the model at a branch's start that it has moved workspaces (the
  note puts the old path back in front of the model, which copies what it
  sees, and it relies on the model's understanding where a rewrite does
  not).
- Only the refusal, without the rewrite (each inherited path costs a failed
  call before the agent corrects it, and `bash` is not covered).
- Finding repos by looking for `.jj` or `.git` in each ancestor (wrong in a
  secondary workspace, and wrong again for git inside a nested one; S36
  item 17).
- Adding `/workspace` to the project's `.gitignore` (a tracked change the
  person did not make; `.git/info/exclude` is local).
- Initializing any directory a lane names (a lane asked to work in `/tmp/x`
  should not leave a repo there).
- Switching an existing lane between its own copy and working directly (its
  files would stop matching its conversation).
- Turning workspaces off only for the whole host (a task outside the repo
  would force every thread to give them up).

## ADR-0033 — Conflicts are resolved by the agent in its lane, by a policy you can replace, and the repository decides the outcome

**Status:** Accepted. Implemented by `PLAN-2026-09-27-workspaces` (landing;
the fold's merge comes with `PLAN-2026-09-27-fold`). Builds on ADR-0032 (folds
and landing are jj merges in a
lane's workspace) and ADR-0010 (labelled legs, and the destination's is
mandatory).

**Context.** A fold of files and a landing are jj merges in a lane's
workspace (ADR-0032). jj records conflicts rather than failing, so a merge
always completes and may leave conflicts on disk (S36 item 11). A merge tool
sees only text. Pineta also knows why each side changed a line: a conflicting
hunk traces through turn revisions to the messages that produced it. ADR-0010
showed that a fold without labelled sides is confidently wrong. Merges also
conflict without touching the same lines: both sides can merge cleanly and
still break each other. How cautious to be varies by person and by repo.

**Decision.**
- **Resolution is a run on the lane that holds the merge.** For a fold, it is
  the fold's own run on the target: its prompt carries the synthesis and,
  when the merge conflicts, the conflicts. For a landing, it is a run on the
  lane being landed. Every landing runs, conflicts or not, because a clean
  merge can still break. It queues behind a running lane, shows in the
  column, and can be stopped, as any run (ADR-0020).
- **The host fixes what the agent is given.** For each conflicted file, the
  run is given:
  - the base, ours and theirs, labelled: ours is the lane holding the merge
    (the destination), and theirs is what comes in;
  - each side's hunks;
  - for each side, the messages behind the revisions that touched those lines,
    attributed as a fold sends them. In a landing, theirs is your committed
    work, which has no messages, so its revision descriptions stand in.

  ADR-0010 holds: the labels are always present, and the destination's side
  is never dropped. Under a budget, the messages are compacted first, never
  the hunks.
- **The policy is a skill, `resolve-conflicts`.** Pineta ships a `SKILL.md`
  and loads it as an extra skill path. pi loads your skills, then the repo's
  (`.pi/skills`), then extra paths, and the first of a name wins. So a
  `resolve-conflicts` of yours or the repo's replaces Pineta's with no
  configuration. Its frontmatter sets `disable-model-invocation: true`, so the
  agent never picks it from its list, and only the host invokes it. The skill
  says:
  - how to judge whether the two sides meant the same thing;
  - when to stop and ask;
  - which checks to run;
  - how to word the question;
  - any rules for the repo ("regenerate lockfiles"; "never resolve ADR
    text").

  It is read from your working copy, never from the lane's, so a branch cannot
  change the rules that judge its own merge.
- **The prompt is Pineta's message, not the skill's text.** The column shows a
  short resolution message ("3 conflicts merging 'aside' into this thread")
  whose details record the skill's path and a hash of its content. The model
  sees the skill's content and the conflict material. pi's `lane.skill` is not
  used: it would write the whole skill into the tree as a `user` message.
- **The agent can always stop; it can never claim a success the repository
  contradicts.** A resolution run may call a Pineta tool, `ask_for_guidance`,
  with its question, to end as "needs you" whatever the files say. The skill
  tells it to leave a conflict it should ask about unresolved rather than
  pick a side. When the run ends, the host decides:
  - **needs you** if the agent asked, or if `jj resolve --list` in the
    workspace still shows conflicts. The agent's question names the two
    intents that differ. The conflicts stay in the lane's workspace, and
    nothing is offered to you. Your answer is a message in the thread, which
    compels the agent (the thread is agent work), and it continues from there.
  - **resolved** otherwise. The resolution is committed as a turn revision,
    and for a landing, the merge is offered to you to take (ADR-0032).
- **Partial resolution is allowed.** The agent resolves what both sides agree
  on and asks about the rest; the outcome is still "needs you".

**Consequences.**
- Every landing costs a run, and a fold that conflicts costs a larger one.
- Conflict material can be large, so it needs the budget ladder of ADR-0005
  and ADR-0010.
- Changing the skill changes the policy without changing code. Someone whose
  skill says "always resolve" gets that: the skill is theirs. It cannot remove
  the labels, the destination's side, or the host's check of the outcome.
- `setUpModel` loads Pineta's skill directory as an extra path, and the
  harness never needs the skill in its `resources`.
- Fold's synthesis can later become a skill, `fold`, in the same way.

**Alternatives rejected.**
- jj's merge tools or an external merge tool (they see text, not intent).
- Resolving in your working copy (ADR-0032: agents never write there).
- Trusting the agent's report of success (the repository can check it).
- A policy written into Pineta (it cannot differ by person or by repo).
- The policy in `AGENTS.md` (always in context, and not replaceable as one
  unit).
- pi's `lane.skill` (it writes the whole skill into the tree).
- Loading the skill from the lane's workspace (a branch could rewrite the rules
  that judge it).
- Landing a clean merge without a run (lines that merge cleanly can still
  break each other).
- Stopping at the first conflict (the agent can resolve what agrees and ask
  about the rest).

## ADR-0034 — A lane is a Linux container on its own disk, and a branch clones that disk

**Status:** Accepted. Implemented by `PLAN-2026-09-28-lane-containers`.
Evidence: S38, S39, S40, S41, S42, S43, S44. Amends ADR-0032:
replaces its jj workspace per lane, the rewrite of the history the model is
sent, the refusal of other lanes' paths, and dependency setup. Keeps its turn
revisions, its fork-point rule, landing, working directly, and your working
copy being yours.

**Context.** ADR-0032 gave each lane a jj workspace on the host and made a
branch's inherited history read as if it had always worked there, by
rewriting other roots' paths to the lane's before every model request. S38
found the rewrite cannot be made true:
- it points paths at things the workspace does not carry (`.jj/`, ignored
  files, your uncommitted changes), and it misses paths in forms it does not
  recognize;
- state that is not files (a server on a port, a database, a process) is the
  host's, shared by every lane;
- it rewrote a root lane's own reads of your working copy, which had nothing
  inherited, so the lane's history contradicted itself;
- left out for people's messages, it sent a real model to write your working
  copy through `bash`, which the refusal does not cover.

A lane can only have its own files, ports and processes in a VM: macOS has no
per-process mounts or network namespaces. Apple's `container` runs each
container in its own lightweight VM with its own IP address (S39):
- it starts in under a second; `exec` into a running one takes 50–70 ms;
- two lanes served `:5173` at once;
- a read-only mount refused writes in the kernel, `bash` included;
- every lane saw its directory at the same path, and nothing of the host's;
- the unit suite ran at host speed once dependencies were on the lane's own
  disk (3.2–3.6 s; 15.6 s with them on a virtiofs mount).

A lane's disk is one sparse file on APFS, so cloning it is copy-on-write
(S40): 0.3–0.6 s, stable at any depth, sharing every unchanged block. A fork
then inherits everything in the directory at that moment, whatever the
language: tracked files, dependencies, caches, build output.
- A clone taken while the lane writes is consistent only on a journaled
  filesystem. `container`'s default volume has none: 0 of 70 mid-write
  clones were consistent, with shared blocks and corrupt directories. With
  `--opt journal=ordered`, 687 of 687 were (S41).
- Without a `sync` first, files the lane wrote but had not flushed come out
  empty in the clone (S41 item 1).

A clone also carries the lane's jj state. With one repo shared by every lane
over virtiofs and a workspace per lane (S41), a clone claims to be its
parent's workspace, must be re-registered before jj runs in it, and several
VMs write one jj operation log over a shared mount. With the whole repo on
the lane's disk (S42), a clone is a complete fork of repo and working copy,
and lanes exchange commits the way separate clones do.

**Decision.**
- **A lane is a Linux container with its own disk.** The disk is a
  journaled ext4 volume (`container volume create --opt journal=ordered`)
  holding the lane's whole directory: a jj repo (a `jj git clone` of yours,
  colocated), its working copy, and everything ignored. It is mounted at the
  same path in every lane, `/workspace`, so every path any lane's history names
  is a path in every lane that inherits it. Nothing is rewritten.
- **Your working copy is mounted read-only at `/mnt/host-working-copy`.** A lane can read it
  and cannot write it, by any tool. Directories that links leave the project
  for (Pineta's `link:` dependencies on Kyneta) are mounted read-only where
  the links resolve. Nothing else of the host is mounted.
- **The lane's tools run in its container.** The host cannot read an ext4
  disk, so pi's `read`, `write`, `edit` and `bash` run in the lane: pi's own
  `NodeExecutionEnv`, in a helper process the host starts with one
  `container exec -i` per running lane, answers the host's proxy
  environment. Calls take 0.3–1 ms; `bash` output streams; a timeout or an
  abort kills the command's process group in the guest (S43 items 1 and 2).
  The container runs with `--init`, so killed processes are reaped (S39 item
  6). The system prompt names `/workspace` and `/mnt/host-working-copy`. Context files and
  skills are still read from your working copy on the host (ADR-0022,
  ADR-0033).
- **A turn: commit, sync, snapshot, fetch.** At the boundary where ADR-0032
  records a turn, the lane:
  1. commits the turn if tracked files changed (`jj commit`, as ADR-0032);
  2. runs `sync`, so what the tools wrote is on the disk;
  3. is cloned, copy-on-write, into a snapshot.

  The host then fetches the lane's commit into your repo as `pineta/<lane>`,
  and the turn's `pineta.revision` record names both the commit (null when
  nothing tracked changed) and the snapshot. Every turn with tool calls gets a
  snapshot, because ignored state changes without a commit. A turn's
  snapshot runs alongside the next model request; the next tool call waits
  for it. A turn is pi's unit, not a tool call: pi runs a turn's calls in
  parallel unless told otherwise (`toolExecution` defaults to `"parallel"`
  in `harness/runtime/harness.js`), so there is no state between them.
- **A branch clones the snapshot at its fork point.** A lane created at entry
  E takes the nearest record at or above E (ADR-0032's rule), clones its
  snapshot into a new disk, and starts a container on it. Before anything else
  runs there, the lane:
  1. runs `jj new <the record's commit>`, so it has its own working-copy change;
  2. marks everything at or above its fork point immutable in its own config,
     a file on its disk (`JJ_CONFIG`), so forks inherit it.

  A clone always carries someone else's working-copy change; without step 1,
  its first turn is that change, divergent from its parent's (S42 item 2).
  Branches of branches are the same operation.
- **A root lane clones the project's base disk.** The host keeps one disk per
  project: your repo cloned and its dependencies installed in Linux. A root
  lane clones it, fetches your `@-` from `/mnt/host-working-copy` by commit id, and runs
  `jj new` on it; it installs only if its lockfile differs from the base
  disk's. That is the only install; a branch never installs. The id is
  given, not looked up: your `@-` is on no bookmark, and a colocated repo's
  git `HEAD` is detached, so a clone alone checks out nothing (S43 item 5).
- **Work moves between repos as commits.** The host fetches from a lane by
  bundle: the lane writes `git bundle create -` to the host through
  `container exec`, and the host fetches from it (about 0.1 s, S43 item 3).
  No lane can write your repo, and your repo's configuration is unchanged. A
  lane fetches your `@-`, or another lane's commits, from `/mnt/host-working-copy`, which is
  read-only and gains nothing (S43 item 4). Landing is ADR-0032's: the lane
  merges your `@-` into itself, ADR-0033 resolves, and you take the merge with
  `jj rebase -r @ -d <merge>`. A fold's file merge is a merge in the target
  lane of commits it fetched. `bookmarks(glob:"pineta/*")` stays in your
  repo's `immutable_heads()`.
- **A container runs only while its lane runs.** A VM keeps the most memory
  its guest ever touched until it stops (S39 item 7), so the host stops a
  lane's container when its run ends and starts it for the next (0.3 s and
  0.7 s; the disk keeps everything). After it stops, the host trims its disk
  in a separate short-lived container with `CAP_SYS_ADMIN`, so the disk gives
  back space the lane deleted (S40 item 8); the lane's own container never
  has that capability.
- **Snapshots last as long as their root.** Any visible turn of an open root
  can be branched from, so its snapshot is kept. Archiving a root (ADR-0029)
  deletes its lanes' disks and every snapshot but each lane's newest, in the
  background (deleting a clone takes about 280 ms, S40 item 4). Restoring a
  lane clones its newest snapshot.
- **The image is the project's.** A lane runs the project's `Containerfile`
  if it has one, else Pineta's default image: Debian trixie, Node, git (2.41
  or later: jj's push and fetch need it, S42 item 7), and jj. `container build`
  makes it once per change.
- **One interface for lanes' disks and containers,** with operations: create
  from the base disk, snapshot, fork, exec, stop, trim, delete. It has one
  implementation, Apple's `container`, which needs macOS 26 on Apple silicon.
  Where it is missing, lanes work directly (ADR-0032) and the host says so at
  startup.
- **The container is the boundary, and what crosses it is a grant.** Your
  home directory is not mounted, so pi's `auth.json`, your git and npm
  credentials and your ssh keys are out of a lane's reach (S43 item 7). A
  project declares its grants, and a lane gets nothing else:
  - forwarding your ssh agent (`--ssh`), for git over ssh;
  - named environment variables;
  - further read-only mounts;
  - shared directories, read-write, from the project or the person's own
    config (ADR-0035);
  - tools that run on the host (an MCP server, an extension's tool). Pineta
    exposes none today; a tool that runs on the host acts outside the lane,
    with your access, so it runs in the lane unless declared.

  `/mnt/host-working-copy` includes your repo's `.git/` and `.jj/`, read-only:
  a token in a remote's URL in `.git/config` is readable in a lane.

  The network is not yet a grant: a lane reaches the internet and every
  host service bound to all interfaces, at the gateway (`192.168.64.1`); your
  Playwright server on `:3100` answered. Services bound to the host's
  loopback are unreachable.
- **A person's path to your working copy is shown as `/mnt/host-working-copy`.** When a
  message is sent, a path under your working copy's root becomes the same
  path under `/mnt/host-working-copy`, in the text everyone then sees, before the model reads
  it. What people see and what the model reads are the same text.

**Consequences.**
- **A lane's history is true in every lane that inherits it.** The
  `transform_context` rewrite, the refusal of other lanes' paths, and S38's
  question of what to rewrite are gone.
- **No agent can write your working copy**, through any tool, except a lane
  set to work directly there. Hot reload stays on.
- **No agent can read your credentials** unless the project grants them, and
  a lane cannot use the network to anything but the internet and the host's
  services on all interfaces. Those stay open until the network is a grant.
- **Branching from any visible turn branches everything in the directory**:
  a branch's `node_modules` and `.vite` are its parent's at that turn, byte
  for byte, and its writes never reach its parent (S40 item 1, S42).
- **Each lane has its own ports and processes.** A lane's dev server is at
  the lane's IP; the host proxies it for browsers that cannot reach it.
- **The host sees a lane's work once per turn,** when it fetches, not live.
  People see a lane's files through its revisions (`jj diff`, `jj file show`)
  or through the host, not in their own editor.
- **Costs per turn: 250–300 ms** on Pineta's own repository (S43 item 6): a
  commit (84–110 ms), a `sync` (52–73 ms), a clone (5–9 ms on a fresh disk,
  up to 0.6 s on one churned for minutes, S40), and a fetch (98–131 ms). The
  clone overlaps the next model request. **Per branch:** a clone, a container start (under 1 s), and `jj new`
  (93 ms, S42). **Memory:** about 1.2 GiB per running lane (S40 item 6), none
  for a stopped one.
- **Disk grows only with what lanes write**; a lane that reinstalls its
  dependencies pays their full size (S40 item 7).
- **A clone is a disk image written into a volume `container` created.** That
  is not an API of `container` at 1.4.1: a volume is its `entity.json` and an
  image, read by path (S40, "Not measured"). A contract test runs the S41 soak
  in small (clones taken mid-write, then `e2fsck` and content checks) on every
  upgrade of `container`, with a deliberate bug that drops the journal.
- **Pineta needs `container` for lanes of their own.** Other hosts, and Linux,
  work directly until the interface has another implementation (reflinked
  images on btrfs or XFS, S40 discussion).
- **ADR-0032's host-side jj workspaces, `workspace/` in the repo, its
  dependency setup and its re-pointing of links are removed.** Nothing in
  your working copy's tree is created for a lane.
- **Not measured:**
  - the helper under a turn's parallel tool calls;
  - restricting a lane's network;
  - a large repository: the base disk's clone (1.2 s for this one), and
    `git gc` on disks forks keep cloning;
  - clone time against a disk's fragmentation;
  - tens of thousands of snapshots over a long session;
  - the e2e and browser suites in a lane;
  - a project `Containerfile`, or `devcontainer.json`;
  - the host proxying a lane's ports.

**Alternatives rejected.**
- Rewriting paths in the history the model is sent (ADR-0032; S38: untrue
  wherever the workspace does not carry a path, blind to forms it does not
  match, and silent to the people reading the same thread).
- Rewriting only inherited messages (S38: people's paths reached the model
  literally, and it wrote your working copy through `bash`).
- A virtual root translated at the tool boundary on the host (servers, ports
  and processes stay shared, and a path computed in `bash` escapes it).
- Seatbelt (`sandbox-exec`) alone (it can refuse writes, but gives a lane
  neither its own paths nor its own ports).
- macOS VMs (Tart, Virtualization.framework guests: at most two at once per
  host).
- Colima, OrbStack or Docker Desktop (every lane shares one VM's kernel;
  `container` gives each its own VM and address).
- Dependencies on a virtiofs mount (4.5 times slower, S39 item 4).
- A shared pnpm store on a named volume (a volume attaches to one running VM
  at a time, S39 item 4), or any per-tool cache (a disk clone needs none).
- `container`'s default volumes (no journal: mid-write clones corrupt, S40
  item 2, S41 item 2).
- Overlay layers per turn or per tool call (a small change to a large file
  copies it whole, lookups slow with depth, and sealing a layer means
  remounting under running processes; layers remain the export format for
  moving a lane to another machine).
- A snapshot per tool call (pi runs a turn's calls in parallel) or per run (a
  branch from mid-run would get the wrong files).
- One repo shared over virtiofs with a jj workspace per lane (S41: a clone
  must be re-registered before any jj command, `jj workspace update-stale`
  in an unregistered clone makes its parent's change divergent, and several
  VMs share one operation log).
- Cloning ahead of a fork to avoid `jj new` (a clone always carries a
  working-copy change someone else has).
- Lanes pushing into your repo (a lane could write any ref there; the host
  fetches instead).
- Fetching over git's `ext::` transport (it works, S43 item 3, but needs
  `protocol.ext.allow` in your repo, which lets any `ext::` remote URL there
  run a command).
- A `container exec` per tool call (50–70 ms each, S39; a helper answers in
  under a millisecond).
- Driving Virtualization.framework directly, or waiting for a clone command in
  `container` (months; the contract test guards the image swap meanwhile).

**As implemented** (`PLAN-2026-09-28-lane-containers`). Where the build adds
to or differs from the text above:
- **The paths are `/workspace` and `/mnt/host-working-copy`** (`WORKSPACE_ROOT`
  and `HOST_WORKING_COPY` in core). They are named for what they hold: the
  lane's own copy, and the person's working copy on the host. The findings
  (S39–S44) measured them as `/project` and `/yours`.
- **A project's image** is `pineta.Containerfile` at its root. It needs only
  a POSIX `sh` and git 2.41 or later; the host refuses to start lanes on an
  image without them, naming what it lacks. Pineta's default image is Debian
  trixie with Node 24, git 2.47, pnpm through corepack, and jj pinned to the
  host's version.
- **The lane runtime.** Node, with its libraries and glibc's loader, and a
  static jj, copied out of Pineta's default image into
  `.pineta/runtime/<image tag>/` and mounted read-only at `/pineta-runtime` in
  every lane. The helper runs on that Node through that loader, so it needs
  nothing of the project's image (S44).
- **Grants** are `pineta.json`'s `lanes` key: `ssh`, `env` (names), `mounts`
  (read-only). The same key's `install` and `installWhen` name the base
  snapshot's install command and its lockfile; a repo with `pnpm-lock.yaml`
  installs with pnpm by default.
- **Snapshots** are files, `.pineta/snapshots/<entry id>.img`, one per
  revision record; the base snapshot is `base.img`, with `base.json` naming
  its commit and lockfile hash. `/.pineta/` is added to git's exclude file.
- **A fetch by id** puts the commit on a branch, and every git fetch into a
  colocated repo ends with `jj --ignore-working-copy git import` (S44 items 7
  and 8). A new base disk is `git init` and `jj git init --colocate`, not
  `jj git clone`, which refuses a volume's `lost+found`.
- **A lane from before lane containers**, with a record and neither a disk
  nor a snapshot, is retired: its tools fail, saying so and to branch from it.
  A branch from it starts from the base snapshot at its nearest commit.
- **Commands the host runs carry `PINETA_GIT=1`**, which a git shim that
  refuses writes in a jj repo when an agent is driving lets through: fetching
  lanes' bundles into your repo is a git write.
- **Skills** listed by path from your home directory were not readable in a
  lane, since your home directory is not mounted. ADR-0036 mounts their
  files read-only at `/mnt/host` and their host path.

## ADR-0035 — Chosen directories are shared read-write with every lane, and never branched

**Status:** Accepted. Implemented by `PLAN-2026-09-28-shared-directories`.
Evidence: S45. Amends ADR-0034: a new kind of grant.

**Context.** ADR-0034 gives each lane its own disk, and a branch clones it.
That is right for a project's files, and wrong for the person's own working
notes, above all plans. An agent must always be able to create a plan and
usually update it, and a plan is the person's, not a branch's: every thread,
and the person, should see one copy, live. Under ADR-0034 a lane could only
read plans, through `/mnt/host-working-copy`, at a path its instructions
don't name. And a change to a lane's container never reached an existing
lane: its mounts, grants and image were fixed when the container was made.

**Decision.**
- **A shared directory** is a directory of your working copy, named relative
  to the project's root. It is mounted read-write at the same relative path
  under `/workspace` in every lane of its own, so paths in `AGENTS.md` work
  the same there and in your working copy. It is a mount, not part of the
  lane's disk, so it is never snapshotted, cloned, committed or landed (S45
  items 1 and 5). What a lane writes there is yours on the host, visible at
  once (S45 items 2 and 3).
- **Two levels, merged:** the person's lane config,
  `$XDG_CONFIG_HOME/pineta/config.json` (only its `lanes.shared`), for
  habits that follow them into every project; and the project's
  `pineta.json`, for directories everyone on it needs. The person's come
  first.
- **Refused, with the reason logged:** absolute paths; paths that leave the
  project; anything in `.git`, `.jj`, `.pineta` or `node_modules`; a path
  holding files jj tracks. The rest still apply. A missing directory is
  created.
- **No repo tracks a shared directory.**
  - In a lane, the host names a generated ignore file, listing each shared
    directory, as git's `core.excludesFile`, through `GIT_CONFIG_*`
    variables on the container. jj reads it too, so every repo in the lane
    ignores it from the container's first moment (S45 item 7).
  - In your repo, one nothing already ignores is added to
    `.git/info/exclude`. Your global git ignore counts.
- **A container is disposable; the disk is the lane.** Each container is
  labelled with a hash of its arguments. A container made from another
  spec is recreated on the same disk at its next start (S45 item 6). So
  changed shared directories, grants or links, and a rebuilt image, reach
  existing lanes.
- **The system prompt** names each shared directory as shared with the
  person and every other thread, live, and never part of a branch.

**Consequences.**
- With `.plans` shared, agents create and update plans in
  `/workspace/.plans`, and you see them at once. This repo's plans live in
  `.plans/`.
- A shared directory is a channel between lanes, and from lanes to your
  machine. Grant only data you want every thread to write.
- Two lanes writing one file at the same moment: the last write wins. No
  merge.
- Recreating a container costs about a second, once per spec change. Every
  lane made before labels is recreated once.
- Storing a plan in the plans tool's refs (`refs/plans/`) still happens on
  your side: a lane's refs never reach your repo.

**Alternatives rejected.**
- Keeping plans read-only at `/mnt/host-working-copy`: agents must create
  them.
- A symlink from `/workspace/.jj` or `.git` to your repo: S41's problems with
  one repo across lanes, and a way for a lane to write your repo.
- A host-side plans tool: it covers plans only. A directory is general, and
  the agent's own tools work in it.
- Tracking plans in the repo: a plan would fork with a branch and need
  merging back.
- Each lane repo's `.git/info/exclude`: it works only if written before jj
  first snapshots with the mount present (S45 item 4), so every start, fork
  and base would need a step in the right order, and a mistake commits
  shared files silently.
- `XDG_CONFIG_HOME` for the whole lane: it would move every tool's
  configuration to a read-only place.
- Inferring shared directories from `.gitignore`: `node_modules` is ignored
  and must stay per lane.
- Marker files in the directory: invisible, and easy to create by accident.
- One configuration level: project level alone makes every repo configure a
  person's habit; user level alone gives a project no way to share.

## ADR-0036 — Your pi skills and prompts are commands, qualified by package, expanded at send

**Status:** Accepted. Implemented by `PLAN-2026-09-28-commands`. Evidence:
S46. Amends ADR-0034: skill files are a grant every lane of its own gets.

**Context.** Pineta loads your pi configuration (ADR-0022, S23), and pi's
loader finds your skills and prompt templates: yours, the project's, and
those of every pi package your settings list. In pi's terminal, `/skill:plan`
expands a skill into a `<skill …>` block and `/review` a template. Pineta
drives pi's harness, not pi's session, so nothing expanded a command: it
reached the model as typed. pi keeps one skill or template per name, so a
second package's `plan` was unreachable. And under ADR-0034 a lane could read
no skill file: pi lists skills by host paths, and your home directory is not
mounted.

**Decision.**
- **Every command is qualified by its package**, in pi's own form: a prompt
  template is `/<package>:<name>`, a skill `/<package>:skill:<name>`. So a
  skill and a template of the same name never collide, and installing a
  package never changes what a name meant. Completion in the composer finds
  a command by any part: typing `/plan` offers every command named `plan`.
- **A package's label** is its `.claude-plugin/plugin.json` `name`, as Claude
  names plugins; else its `package.json` name without the scope; else pi's
  scope (`user`, `project`) for a loose skill or template; `pineta` for
  Pineta's own. The user config's `commands.names` renames one, keyed by pi's
  `source`. Two packages with one label are refused, both named, until one is
  renamed: a person decides, never load order.
- **Every command pi loaded is reachable,** those its collision handling
  drops included: the host loads them again by file. The model's own list of
  skills keeps pi's precedence.
- **A command is expanded on the host at send, and frozen.** The message
  stores what was typed, for people, and the command's file, its hash and
  its expansion, which the model reads. A later edit or install never
  changes what a message meant. A skill expands to pi's block, byte for byte
  (`_expandSkillCommand` in pi-coding-agent's `agent-session.js`); a
  template, with its arguments. A command is for the agent, as `@agent` is.
  An unknown `/a:b` is refused; a first word not of that form is text.
- **Skill files are read-only in every lane of its own at `/mnt/host` and
  their host path** (S46). One rule, so no granted path can shadow the
  image's own. What is mounted is each command's package root, else its own
  directory, never one that is or holds your home directory, `/` or pi's
  agent directory (`auth.json`). A skill that cannot be mounted still
  expands, and is logged as not readable in lanes.
- **Lane paths only where Pineta writes them:** the skill list in a lane's
  system prompt, and an expanded skill's header. Skills refer to their own
  files by relative path and to other skills by name (pi's `docs/skills.md`),
  so nothing in their text is translated.
- **Every mount a lane gets is one list**, rendered by one function that
  handles the separators `container` gives `--mount` and `-v` (S46 item 4).

**Consequences.**
- Your skills and prompts work in Pineta as in pi, with the package in front,
  and are found by typing.
- A branch that works directly, from a thread of its own, inherits command
  messages whose headers name `/mnt/host/…` paths. That is the same exposure
  as `/workspace` paths in inherited history (ADR-0034), not a new one.
- A new or changed skill package changes every lane's mounts, so each lane's
  container is recreated once at its next start (ADR-0035).
- Suites give the host a fixture pi directory (`agentDir`), and never read
  the person's own.

**Alternatives rejected.**
- Unqualified names resolved when unique: installing a package would make a
  name ambiguous, or silently change what it runs.
- Claude's `/duane:plan` for a skill: a skill and a template of one name
  would collide within a package, as `comments` and `comments.md` do.
- pi's list as it is: a second package's `plan` would be unreachable.
- Mounting skill directories at their own host paths: a skill under `/root`
  or `/usr` would shadow the image's.
- Rewriting paths inside skills' text: skills refer relatively and by name.
- Expanding when the model reads a message: a later edit would change what
  an old message meant.
- Storing only the expansion: people would read a whole skill in the thread.
