# Spikes

**Rule:** every spike states a *question*, a *kill criterion*, and what gets
*thrown away*. A spike without a decision output is piecemealing with better
branding. Code written in a spike is disposable by default.

When a spike resolves → write the ADR, strike it from this list.

## Priority

Order by information gained per unit cost, weighted by blast radius if wrong:

> ~~S1~~ ~~S2~~ ~~S3~~ ~~S5~~ ~~S7~~ ~~S8~~ ~~S11~~ ~~S12~~ ~~S13~~ ~~S14~~ ✅
> **ALL TWELVE RESOLVED. No blocker, nothing in flight.**
> Remaining, none blocking: **S15 → S10 → S6** (S16 moot since ADR-0023)
>
> The gate is fully discharged. **The walking skeleton is unblocked.**

> ✅ **Evidence base re-validated (S14).** All prior spikes ran on
> `loro-crdt@1.10.8` + npm `@kyneta/*` 3.0.0 — both below the supported floor.
> Re-run against local fixed Kyneta + `loro-crdt@1.16.1`: **every correctness
> suite passes with byte-identical entry totals**, and performance improves a
> further ~20× beyond S11's projection. Nothing regressed.

**S1 is now the single remaining storage-level blocker.** S3 promoted it from
theory to a reproducible defect: 3 `seq` collisions per 6 partitioned writes,
and an entry present in the document made **silently unreachable** through the
paginated read path. Lane-per-writer (ADR-0011) does **not** help.

- **S5** is the cheapest and de-risks the *product*, not the plumbing. Product
  risk cannot be engineered away later. Run it first.
- **S2 and S3** are the assumption-killers — the only two that can invalidate
  ADR-0001/0003.
- **S7** is ~an hour and directly validates ADR-0008.

---

## ~~S5~~ — RESOLVED ✅ → `findings/S5-fold-quality.md`, ADR-0010

**Size:** S · **Depends on:** nothing

**Question.** Given base/`ours`/`theirs`, does a strong model produce a summary
of `theirs` that is genuinely useful at the destination — specific, non-redundant,
and correctly scoped?

**Method.** Generate a real branched session in pi's TUI (`/tree`, Esc-Esc).
Hand-construct the three-way prompt. No infrastructure. Vary: short aside vs
long scout; related vs unrelated tangent; contradictory branches.

**Kill criterion.** If output is generic mush, or reliably smuggles in
irrelevant context, or cannot tell common ground from divergence, the product
thesis needs rework before any architecture is committed.

**Throw away.** Everything. Keep the prompt and a written judgement.

---

## ~~S2~~ — RESOLVED ✅ → `findings/S2-storage-conformance.md`, spawned S11

**Size:** M · **Depends on:** nothing

**Question.** Can `Storage`'s 10 methods be satisfied over a Kyneta/Loro
document? Single-writer, in-memory is fine for this spike.

**Method.** Stub `KynetaStorage`, point
`pi-agent-core/harness/session/testing/conformance/storage.js` at it, count
failures and classify them.

**Kill criterion.** Binary. Systematic failure ⇒ ADR-0003 is wrong and the plan
changes shape.

**Throw away.** The implementation. Keep the failure taxonomy — it *is* the
implementation plan.

---

## ~~S7~~ — RESOLVED ✅ → see `findings/S7-branch-convergence.md`, ADR-0009

**Size:** S · **Depends on:** nothing

**Question.** Two peers, one Kyneta document, concurrent entry appends under
*different* parents. Do both branches survive as distinct siblings and converge
as a tree — with no interleaving and no auto-merge?

**Method.** Direct `@kyneta/schema` + Loro test. No pi involved.

**Kill criterion.** Any interleaving or collapse means our document shape is
wrong (not that ADR-0008 is wrong — that would mean we modelled the tree in a
substrate-merged container by mistake).

**Throw away.** The harness; promote the assertion into the permanent
convergence property test.

---

## ~~S3~~ — RESOLVED ✅ → `findings/S3-harness-foreign-writes.md`, ADR-0011

**Size:** M · **Depends on:** S2

**Question.** Two harness instances against one Kyneta doc, appending on
different tips. Does the harness cope with `scanBranch`/`getEntries` returning
entries that appeared from another peer mid-run?

**Why it matters.** `SessionMutation` is documented as an *"exclusive keyless
mutation barrier for one Session"* — a per-process mutex. It may assume a
private world. Measured behaviour today: two clients on one lane **serialize**.

**Kill criterion.** If the harness caches, assumes monotonic local growth, or
corrupts on foreign entries, multi-writer needs *harness* changes, not just
storage — a materially larger project.

**Throw away.** The driver. Keep a written list of every assumption violated.

---

## ~~S1~~ — RESOLVED ✅ → `findings/S1-seq-dissolution.md`, ADR-0013

**Size:** S · **Depends on:** S2's failure taxonomy

**Question.** `EntryScan{fromSeq,toSeq}` requires **range scans**, and
`EntryCursor`/`ListCursor` require stable pagination. Can these be served by
Lamport+peer ordering plus a local index, without a dense global counter?

**Kill criterion.** If range scans genuinely require density, we need a
materialized local index per replica — acceptable, but it must be designed, and
it means `seq` becomes a *derived local view*, not stored state.

**Output.** If the answer is clean, write it as an **upstream proposal**, not a
private workaround: *"replace a global commit counter with per-op causal
metadata so the log can merge."*

---

## ~~S4~~ — RESOLVED ✅ → `findings/S4-browser-transport.md`, ADR-0014

**Size:** M · **Depends on:** nothing (cheap now that ADR-0007 fixes the design)

**Question.** Does a Line over `@kyneta/websocket-transport` carry command
traffic and replicated transcript state to a browser at streaming rates
(~50 token-deltas/sec)?

**Sub-question.** Should token deltas ride ephemeral presence or the durable
doc? pi already separates these (`message_update` vs `entry_appended`;
`pi.pending.assistant_frame` list ops are appended then deleted on commit).

**Kill criterion.** If delta rates saturate the doc layer, streaming moves to
presence and the durable doc only receives committed entries.

---

## S6 — Do `file-range` references survive a jj change?

**Size:** S · **Depends on:** nothing · **Lowest priority** (v1 has no Worktree branches)

**Question.** Is content addressing (blob hash / jj change ID) sufficient to
keep file references valid — or at least *knowably stale* — across edits?

**Kill criterion.** If references cannot reliably detect staleness, file
references must be advisory-only in the UI.

---

## ~~S8~~ — RESOLVED ✅ → `findings/S8-branch-tip-contention.md`, ADR-0011

**Size:** S · **Depends on:** nothing · **Raised by:** S7 residual #4

**Question.** S7 only modelled the `entries` collection. `pi.branch.tip` is a
**genuinely contended** LWW register — two peers moving the same lane tip
concurrently is exactly the silent-clobber case S7 §3.4 demonstrated. What are
the correct semantics?

**Hypothesis to test.** Per `00-vision.md`, tips should be **per-peer presence**,
not shared session state — which would dissolve the contention entirely. But pi
models `pi.branch.tip` as keyed-by-lane *shared* state, and `AgentLane.getTipId`
assumes it. Do these reconcile, or does per-peer tip require a lane per peer?

**Kill criterion.** If per-peer tips cannot be reconciled with pi's lane model,
concurrent branch navigation needs a design we do not have, and it lands on the
critical path for the v1 demo.

**Priority.** High — this is the one unexamined case that is *known* to be
contended, and the v1 demo depends on it.

---

## ~~S9~~ — RESOLVED ✅ → `findings/S9-idgenerator-collisions.md`

**Size:** S · **Depends on:** nothing · **Raised by:** S7 residual #7

**Question.** ADR-0009 makes id uniqueness safety-critical. S7 used its *own*
UUIDv7 implementation. pi ships an injectable `IdGenerator`. Does pi's produce
collisions across peers — same millisecond, same process, forked processes?

**Kill criterion.** Any collision path means we must supply our own generator
rather than use pi's default. Cheap to check, expensive to discover later:
failure is *silent data loss*.

---

## S10 — Does the document shape scale?

**Size:** M · **Depends on:** S2 · **Raised by:** S7 residual #2

**Question.** S7's largest trial was ~40 entries. Real sessions run to tens of
thousands. How do `exportSince` size, snapshot time, and memory behave for a
`Schema.record` with 10k+ entries and large tool-result blobs?

**Kill criterion.** If snapshots or sync payloads grow unacceptably, we need
per-entry document granularity or shallow snapshots — a document-shape change,
so better known before the adapter is built on the current shape.

---

## ~~S11~~ — RESOLVED ✅ → `findings/S11-schema-write-perf.md`

**Size:** M · **Depends on:** nothing · **Raised by:** S2 §3.4

**Question.** S2 measured `@kyneta/schema` write throughput as **O(n²) in
container size**, against raw `loro-crdt`'s O(n) — **~650× slower at n=8000**.
Independently reproduced: 138 / 515 / 1965 / 7743 ms for 1k/2k/4k/8k (≈ 4× per
doubling) vs raw Loro 2 / 3 / 6 / 12 ms (≈ 2×). Why?

**What is already ruled out.** Batch size (chunking into 100-write batches
changes nothing — it is quadratic in *container* size). The Loro binding (the
plain-JS substrate shows the same curve, so it is **`@kyneta/schema` core**).
`.at()` navigation overhead (hoisting it out of the loop changes nothing).

**Suspects, unverified:** changefeed materialisation per op; per-op path/address
construction.

**Why this is top priority.** It is *first-party code you own and can fix*, and
it sits directly under Pineta's two unbounded containers — the session entry
record and `pi.pending.assistant_frame`. Every later design decision about
document granularity depends on whether this is a bug or a law.

**Mitigating fact:** the realistic streaming shape is fine *today* — 1 000
separate single-append commits took 247ms (≈0.25ms/commit). Reads are also cheap
(42ms to materialise 10 001 elements). This bites on bulk load, replay, and
long sessions, not on interactive use.

**Kill criterion.** If it is inherent to the schema algebra rather than an
implementation defect, Pineta needs per-entry document granularity — a
document-shape change, so it must be known **before** the production adapter is
built on the current shape. (Supersedes part of S10.)

---

## ~~S12~~ — RESOLVED ✅ → `findings/S12-trunk-semantics.md`, ADR-0012

**Size:** S · **Depends on:** nothing · **Raised by:** S8 residual #1 + ADR-0011

**Question.** Under ADR-0011 every writer owns a lane, so no lane is canonical.
But the product has a *trunk* — `00-vision.md` is built on "fold an exploration
back into the trunk." What represents it?

**Candidates (none evaluated):** a designated lane name; a label on an entry; a
separate `pi.session.*` pointer; simply the path to a designated leaf.

**Why it matters beyond naming.** It interacts directly with fold: ADR-0010
establishes a fold is **destination-relative** — so "fold into the trunk" needs
a well-defined destination *tip*. If the trunk is a lane, whose lane is it, and
who may write it? If it is a pointer, it is a contended LWW register and
ADR-0011's reasoning applies to it too.

**Kill criterion.** If the trunk cannot be expressed without reintroducing a
shared-writer register, we have moved the ADR-0011 hazard rather than removed
it.

---

## ~~S13~~ — RESOLVED ✅ CONFIRMED by S14 §4.3

**It was not the Kyneta→Loro binding.** Kyneta `da978ec` attributes it to
`loro-crdt` itself: *"`loro-crdt` built a commit's event in O(keys²) whenever a
subscriber was attached, which for this substrate is always — bisected to 1.13.3,
fixed in 1.13.4, hence the peer floor."* S11 correctly localised it to wasm frames
and correctly declined to guess further. **S14 must confirm the residual ×3.5 is
gone on `>=1.13.4`.**

**Size:** S–M · **Depends on:** S11 · **Raised by:** S11 §3.9

**Question.** After both S11 fixes, Loro `record.set` remains superlinear (×3.5–3.6
per doubling) while raw `loro-crdt` map-set is linear. Profiling puts the cost in
**wasm frames**, and it is shape-independent (`record(any)`, `record(struct.json)`,
and `record(struct)` all behave alike) — so it is something the Kyneta→Loro
**binding** does per key, not a `LoroMap` limitation.

**Why not urgent.** ~20× smaller than the two defects already fixed, and it does
not threaten any kill criterion. This is the next lever only if 10k-entry bulk
writes need to drop below ~2 s.

---

## S15 — Should the trunk winner rule be causal rather than wall-clock?

**Size:** S · **Depends on:** S12 · **Raised by:** S12 residual #1

> ⚠️ **S12's hope that this shares S1's Lamport work is DEAD.** S1 deliberately
> built **no** causal clock — it refuted convergent ordering for cursors and
> chose replica-local arrival order instead. S15 would introduce one from
> scratch. The two uses are unrelated: S15 needs a *total order over promotions*
> (convergent is exactly right there); S1 needed *cursor stability* (where
> convergent is exactly wrong).

**Question.** ADR-0012 resolves a trunk fork with a total order `(ts, peer, id)`.
Convergence does **not** depend on the rule — only on it being *total*. But
*which* fold wins does, and `ts` is wall-clock: **clock skew across devices is
adversarial**, and the "winner" may not be the causally later fold.

**Evaluate:** Lamport / causal-length ordering instead. **Plausibly shares
S1's Lamport work** — if S1 lands a causal clock for `seq`, S15 is nearly free.

**Not urgent:** replicas converge either way; this is about picking the *right*
winner, not a correct one.

## ~~S16~~ — MOOT ✅ → ADR-0023 (compaction removes the residue)

> **Resolved without the spike.** The residue was Loro keeping each finished
> stream's history. Since ADR-0023 the session is `json.bind` and is compacted
> when every run ends, which drops that history (S25). The original question is
> kept below for the record.

### S16 — Can a disposable per-message doc remove the streaming residue?

**Size:** S–M · **Depends on:** S4 · **Raised by:** ADR-0014's accepted tradeoff

> **Motivation reduced.** The original premise bundled two costs: history
> residue *and* a 6.9× wire cost. **The wire cost is gone** — it was our use of
> `Schema.string()`, not a substrate property; durable `Schema.text()` is linear
> (18 131 B vs 144 582 B). Re-measured residue is **~5.6 KB per message**
> (late-joiner 11 436 B vs 5 834 B control), not 9.6 KB. S16 is now purely about
> residue, and is **lower priority** than when filed.

**Question.** ADR-0014 streams deltas through the durable doc and accepts
**~5.6 KB of unreclaimable history per message**, paid by every future late
joiner. `exchange.compact()` **throws on a live Loro substrate** (still open,
re-verified), so it cannot be reclaimed.

**Hypothesis.** Keep pending assistant frames in a **separate, disposable Loro
doc per message**, destroyed on commit — residue never enters the session doc.
Preserves ADR-0014's correctness with none of its cost.

**Method.** S4 §3.5's control-vs-streamed byte accounting is a ready-made
measurement: late-joiner download for never-streamed / streamed /
streamed-with-disposable-doc.

**Also test:** does a mid-stream joiner still hydrate exactly when pending frames
live in a doc it must *discover and subscribe to*? That is the correctness risk
the split introduces.

**Kill criterion:** if a per-message doc cannot be discovered and subscribed fast
enough for a late joiner to hydrate exactly, ADR-0014's residue stands and the
answer is to await Loro compaction.

---

## Resolved

### S89 — Where a take waits, and what a refresh costs ✅ PASS

`findings/S89-waits-on-your-repo.md`. On a clone of Pineta's repo, with
six offers and one thread working, a take waited 13–18 s in the offers'
queue (52–59 deep), and another person's chat waited as long behind it on
the host's `Serial`. The host's own writes and imports fed the poll
without you. About half the refreshes were duplicates, and about half the
poll ticks overlapped an earlier one. A refresh that wrote nothing ran 18
jj processes. After ADR-0065, on the same scenario: a take 0.44 s, the chat 0.01 s, and
a refresh that wrote nothing 3 jj processes.

### S88 — rg, fd and sd for every lane, and how they behave as tools ✅ PASS

`findings/S88-lane-search-programs.md`. Static musl builds of ripgrep
15.2.0, fd 10.5.0 and sd 1.1.0 run on any Linux image; Debian's link glibc.
rg exits 1 when nothing matches and fd exits 0 with no output; fd matches a
glob against the basename unless `--full-path`; both skip gitignored paths
unless the path is named. pi's `ensureTool` finds or downloads rg and fd for
the host. Basis of ADR-0064.

### S83 — An update's sides in one `jj log`, and a fetch by id ✅ PASS

`findings/S83-jj-update-reads.md`. `self.diff("<fileset>").files()` in a
`jj log` template, with the same fileset as its paths, names which of
several files each revision touched, from the repo's root, as JSON per line.
`fork_point(a | b)..b` is `a..b`, even with several fork points. And
`git fetch` skips a wanted commit the repo already holds, so `fetchById`
naming one of the lane's own commits never failed.

### S82 — Kyneta undo stacks on the host, one per seat ✅ PASS

`findings/S82-host-undo-stacks.md`. One stack per seat over a places
document only the host writes, on Yjs: `undo({ whole: true })` refuses a
move when someone moved the card since, the row's placer catching a move
away and back, and undoes a gesture over three cards whole or not at all.
Without `whole` a dead step is skipped and an older one undone, out of
sight. `rev` must be raised outside the gesture, `top` names the card but
not its target, and Yjs places grew about 25 bytes a move, against `json`'s
none.

### S81 — An offer conflicted where its lane had resolved a catch-up ✅ PASS

`findings/S81-offer-start-after-a-catch-up.md`. A source taken, then
changed on the line, then merged back by the lane's catch-up, was a second
head of the offer's start; the offer's rebase subtracted it from a line that
already held it. Taken sources are now read only above the commit the lane's
`Pineta-Base` names, which holds them: S51 item 3, carried by the base where
it was carried by a copy.

### S80 — "Update my files": which rebase, a preview, and conflicts ✅ PASS

`findings/S80-update-my-files.md`. `jj rebase -b @ -d <onto>` moves your
work above the line, other heads on it included; `-r '<onto>..@'` would
strip those heads of the commits under them. `git merge-tree` previews the
files that change and conflict in `@` without writing anything jj or jjui
sees. A conflict does not stop the rebase: the lowest conflicted commit and
everything above it are marked, and the markers land in `@`'s files only.

### S79 — A second tab's repair cleared a slot just taken into ✅ PASS

`findings/S79-the-repair-races-the-record.md`. The host's record of a
take and the taking tab's slot write reach another tab apart, in either
order, so S76's repair acting at once cleared the slot, or placed the card
before the slot arrived. Acting on a card only once it has been held, or
not, for 2 s kept every card in its slot.

### S76 — A card's place with one owner, and what a card's document costs ✅ PASS

`findings/S76-a-place-with-one-owner.md`. Places written only by the host,
through handoffs it applies or refuses, and an inventory per person that
only that person's tabs hold and write: the first handoff to arrive wins,
the loser is told where the card went, and each tab's repair of its
inventory from the host's places converges. A client that writes the
host's places document diverges for good. A card's own Yjs document costs
about 17 KB in an Exchange, and Kyneta's `destroy` frees none of it.

### S75 — Where an inventory card's place lives, and undoing moves ✅ PASS

`findings/S75-inventory-places-and-moves.md`. An inventory card's place is
fields on its record in the cards document: a document per person put one
card in two inventories under concurrent takes. Every move writes the whole
place, or concurrent moves mix two places' fields. Two tabs can fill one
slot, so a read settles it. A second Kyneta stack for moves keeps them apart
from text; its steps name the cards they moved. An undo can report `true`
and change nothing.

### S69 — The take/stop race over the host's exchange ✅ PASS

`findings/S69-the-take-stop-race.md`. A take that reads the top queued card
and deletes its record in one synchronous step wins against every stop it
has not yet seen, and respects every stop it has. The stopper's client sees
the card spent and can say "already sent". A refused send must write the
card back below the line, or a stop that was lost comes back queued. A
field on each card orders a queue; a list per thread duplicates cards under
concurrent moves.

### S64 — A spent card's undo, and how a client knows a card was spent ✅ PASS

`findings/S64-spent-card-undo.md`. Kyneta now redoes a run of typing in
order, and skips an undo step whose document is not held, but a host's
destroy leaves each client's copy. Only a spend makes the host leave a
card's document while still connected; its `dismiss` can reach a client
before the record's delete. Superseded for undo by ADR-0052: a history per
card.

### S61 — Menus closed by the session, not by the person ✅ PASS

`findings/S61-menus-closed-by-the-session.md`. A column following its end
scrolls itself as entries arrive, and `Popover` closed on any scroll outside
its box, so every open menu closed. Only a scroll of an element holding the
trigger moves it. A trigger drawn from live data took its open box with it
when it unmounted, and a removed row left focus on `<body>`, out of Escape's
reach.

### S60 — A wide image for a column's header ✅ PASS

`findings/S60-column-banner-aspect.md`. OpenRouter honours
`image_config.aspect_ratio`, which pi-ai sends only through `onPayload`.
Nano Banana 2's preview makes 8:1, close to a header's shape; the released
model refuses anything wider than 21:9. About 9 s and half a cent an image.
A light image made the header's name unreadable; a dark, low-key brief kept
it legible without a scrim. Produced ADR-0050.

### S59 — A tool's image through pi, the session and the store ✅ PASS

`findings/S59-tool-images.md`. An image processor in `read` runs before pi
writes anything, so it can store the image first. pi writes the result as a
`pi.pending.entry` value, then as the entry, both with the base64, and a
deleted value stays in the history (S22). pi rejoins every entry on the
branch about twice a model request; rejoining an image costs 0.65 ms, so it
needs no cache.

### S57 — Reading an offer's revisions and diffs from jj ✅ PASS

`findings/S57-offer-review-reads.md`. A template prints a revision's
description and per-file stats as JSON, `json()` quoting every path; a
`root-file:` pattern gives one file's diff, where `root:` would match a
prefix. Both take milliseconds. A read of a repo with divergent operation
heads reconciles them, writing an operation, so the host's reads share its
queue. Produced ADR-0047.

### S55 — The order a turn's streams and entries are written in ✅ PASS

`findings/S55-live-work-handover.md`. A message's entry is written before its
tools start, its tool results before the next reply, and a run's entries
before `endRun`. From a reply's first text to its entry the lane's tip does
not move, and the entry moves it. So a reply is current while its lane's tip
is where it opened, and a client that holds the entry holds a tip that says
so. A stopped reply's partial message is written as an entry. Produced
ADR-0044.

### S54 — Why the page's memory grew, and what re-rendered ✅ PASS

`findings/S54-render-cascade.md`. 96% of a session's heap growth (255 MB in
about 3.4 minutes) was React 19.2's dev-build `performance.measure` entries,
one per component render with changed props. Every `App` render re-rendered
every message on screen: `App`'s inline `useTracked` thunks re-ran on every
render and rebuilt the tree index. Kyneta tracked precisely (streaming never
rendered `App`) and keeps an unchanged row's object, which the reads now cache
by. Produced PLAN-2026-09-29-render-cascade.

### S53 — Pasted images: pi's image path, and the model's seam ✅ PASS

`findings/S53-pasted-images.md`. pi's `detectSupportedImageMimeType` reads
the type from the bytes, and `resizeImage`, in a worker thread that loads
here, fits a 3000×2000 PNG to a 2000×1333 JPEG in 1.4 s, with its
dimensions as numbers. `toProviderMessages` runs once per request, and pi's
summaries bypass it. Reading 20 MB of blobs and encoding them takes about
20 ms a request, so there is no cache. Produced ADR-0042.

### S49 — An offer updated in place while its thread works ✅ PASS

`findings/S49-offer-in-place.md`. Rebuilding an offer after every lane commit
cost six operations in your repo and a new change id each time. Three
operations update it in place instead (back onto its start, restore the new
tip into it, onto the target again), keeping its change id and bookmark; the
result has the tree a fresh build has, from a moved start as from a moved tip,
conflicts included, and your `@` is untouched.

### S48 — Offers: a thread's work as one commit in your repo ✅ PASS

`findings/S48-offers.md`. An offer is four host operations with
`--ignore-working-copy`, by change id, and never touches your working copy.
It previews conflicts with your committed work; take is `jj rebase -r
<offer> -B @`, and a conflict with your uncommitted edits lands in `@`. The
host tells your edit of an offer from jj's rebase by comparing it with its
own earlier version (description, `jj interdiff`, and whether its parent is
an ancestor of the target); a racing rewrite makes it divergent, and is
repaired by who made each commit (`operation.user()`), never by description.
An addendum answered the plan's questions first: where an offer starts is one
revset (copies of your `@` count as yours), a stack is rebuilt rather than
duplicated, and retiring the old layout moves lane history before deleting
bookmarks. A lane
can start from your `@` only through a copy with its own change id. Lane
history as remote bookmarks is immutable and out of your default log with
no config.

### S47 — Owning a SQLite file through `node:sqlite` ✅ PASS

`findings/S47-sqlite-ownership.md`. Exclusive locking mode after `BEGIN
EXCLUSIVE; COMMIT` refuses every other connection, readers included, even on
an empty file. `node:sqlite` reports it as `errcode` 5, not Kyneta's
`code === "SQLITE_BUSY"`. The constructor's `timeout` is the busy timeout.
Closing releases the file at once. A missing named import refuses the module
at load, so the host's environment gate could never fail.

### S46 — Skill files in a lane, under `/mnt/host` ✅ PASS

`findings/S46-skill-files-in-lanes.md`. A read-only mount at `/mnt/host`
followed by a host path works at any depth the image lacks, beside
`/mnt/host-working-copy`, with spaces in the path, and a skill's own script
runs from it. A comma in a source path breaks `--mount`'s syntax; `-v` takes
it, but not a colon.

### S45 — A host directory shared read-write into every lane ✅ PASS

`findings/S45-a-shared-directory-in-lanes.md`. A bind mount at
`/workspace/.plans`, inside the lane's volume, works. What a lane writes
there is yours on the host, and changes are visible at once between the host
and every lane. A snapshot holds only the empty mount point. The lane's jj
keeps the directory out of `@` only if `.git/info/exclude` names it before jj
first snapshots. But `core.excludesFile`, set through `GIT_CONFIG_*`
variables on the container, keeps it out of both git and jj from the first
moment, in every repo: no step order has to hold. A container's labels read
back, so a lane whose spec changed can be recreated on the same disk.

### S44 — The lane runtime on any image, and fetching your `@-` by id ✅ PASS

`findings/S44-a-lane-runtime-on-any-image.md`. Node from Pineta's image,
started through its bundled glibc loader and libraries, ran pi's
`NodeExecutionEnv` on Alpine, which has musl and no Node. It wrote, read and
streamed, a timeout killed the command's grandchildren, and `/yours` refused
writes. `process.execPath` is then the loader. A commit fetched by id is
invisible to jj unless the fetch puts it on a branch ref. After any git
fetch into a colocated repo, `jj --ignore-working-copy git import` (12–47 ms)
imports the refs without snapshotting the working copy. A fresh volume's
`lost+found` makes `jj git clone` refuse `/project`.

### S43 — pi's tools in a lane, moving commits, a turn's cost, the lane boundary ✅ ANSWERED

`findings/S43-tools-fetches-and-the-lane-boundary.md`. pi's own
`NodeExecutionEnv`, run in the lane behind one `container exec -i` stream,
served pi's tools unchanged at 0.3–1 ms a call, streaming `bash` and
killing process groups on timeout and abort. A lane's commits reach the host
by bundle or `ext::` in about 0.1 s; your `@-` must be fetched by id. A whole
turn costs 250–300 ms. Host services on all interfaces, and the internet,
are reachable from a lane; your credentials are not, unless granted.

### S42 — A jj repo per lane disk ✅ PASS

`findings/S42-a-repo-per-lane-disk.md`. With the whole repo on a lane's disk,
a fork is a disk clone plus `jj new T` (93 ms); without that `jj new`, the
host saw a divergent change. Change ids crossed repos in git headers, three
lanes pushing into one repo at once left it consistent, inherited history
could be made immutable, and landing and folding were ordinary merges. jj
needs git 2.41 or later in the lane image.

### S41 — A soak of mid-write clones, and forking a lane's jj workspace ✅ PASS

`findings/S41-clone-soak-and-jj-forks.md`. 687 of 687 clones taken mid-write
from a journaled volume were consistent; without a journal, 0 of 70 were. A
fork of a lane's disk becomes its own jj workspace in about 150 ms by
swapping in a fresh workspace's state; forks of forks then never reached
their parents. An unregistered clone is refused as stale, and
`jj workspace update-stale` there makes the parent's change divergent.

### S40 — Forking a lane's whole disk, copy-on-write ✅ PASS

`findings/S40-forking-a-lane-disk.md`. A clone of a running lane's disk image
at a turn boundary gave a fork byte-identical to that moment, whose inherited
`node_modules` and `.vite` cache worked unchanged. `container`'s volumes have
no journal, and clones taken mid-write were corrupt; on a journaled image
(made with `mke2fs`) all were consistent. Clones take about half a second at
any depth and share blocks; deleting them is slow; guest deletes free host
space only after `fstrim`.

### S39 — A Linux container per lane, with Apple's `container` ✅ PASS

`findings/S39-a-container-per-lane.md`. A container starts in under a second
with its own VM and IP address: two lanes served `:5173` at once, a read-only
mount refused writes from `bash`, and every lane saw its workspace at the same
path with `jj` working inside. The unit suite passed at host speed once
`node_modules` was off the virtiofs mount. A VM keeps what memory it used
until it stops; stopping and starting take under a second.

### S38 — Can the path rewrite be limited to what a lane inherited? ✅ ANSWERED

`findings/S38-rewriting-only-inherited-messages.md`. Mechanically yes: every
message pi's `transform_context` receives is the object `scanBranch` returned
in an entry, and compaction can be done in `before_compaction`, after a
restart too. But a person's message left verbatim sent a real model to write
your working copy through `bash`. So only the lane's own agent turns should
be left verbatim, and ownership should come from the lane's creation point:
a failed revision record misattributes a whole run.

### S37 — Why a column changes width ✅ ANSWERED

`findings/S37-column-width.md`. A flex item's automatic minimum width is its
widest unbreakable line, so a long line in a code block, a tool's output or a
tool's label widened its column; the viewport's width never did. `.column`
now sets `min-width: 0` and `.tool-label` wraps anywhere. The browser e2e
checks that a column holds at 28rem.

### S36 — What a jj workspace per lane costs ✅ ANSWERED

`findings/S36-a-workspace-per-lane.md`. `jj workspace add` takes 0.2 s; an
APFS clone of every `node_modules` takes about 6 s and 11 MB, and runs the
workspace's own code once links leaving the repo are re-pointed. Symlinking
`node_modules` back would import your packages instead. Rewriting a lane's
ancestor while it has edits not yet snapshotted diverges its change and takes
those edits off its disk. A symlink swap cannot hide the real directory.
Addendum: immutable run revisions keep one lane from staling another, a fold as
a merge rewrites nothing and repeats take only what is new, so `update-stale`
is only a guard; a jj command wanting an editor hangs an agent's shell.
Addendum 2: pi takes each lane's directory from the run's `Context`, resumed
runs included; landing works end to end; the whole gate passes in a workspace
and e2e runs do not collide; `pnpm install --offline` sets a workspace up in
2–3 s; a jj command run from the wrong directory acts on the repo around it.

### S35 — Why an agent's column jumps while it works ✅ ANSWERED

`findings/S35-agent-work-jumps.md`. A tool call changes the column's height
five or six times, and each shrink slides the whole column down. Live work
closes before its entry arrives. The column's anchor follows the new tip one
render later, and that render shows a `⑂ 0 messages` chip and no live panel.
When rendering is slow, as in a long session, each of these states is painted.
With S55, produced ADR-0044.

### S34 — Links to a thread, off loopback ✅ PASS

`findings/S34-links-off-loopback.md`. A fragment survives the invite link's
redirect, so `?key=…#e=…` lands on the thread. A key-less link clicked on
another site is refused even with the key cookie set (`SameSite=Strict`), and
the page cannot read the `HttpOnly` cookie: a link to share must be one of the
host's invite links, which the host gives the page.

### S33 — Picking a message from the rail ✅ PASS

`findings/S33-picking-a-message-from-the-rail.md`. A pick from the rail
brought its message into view in none of three cases. On the tab you are on,
a pick causes no render, so an effect waiting for one never ran; a new column
aligned to its fork point; and the Archive preview did not scroll. Scrolling
at once when the message is drawn, and dispatching `PLACED` so the column
stops following, lands every case in view and keeps it there.

### S32 — Following a column's end ✅ PASS

`findings/S32-following-the-end.md`. A column did not follow a reply being
written: its follow ran on new messages, not on growth. Chromium dispatches
scroll events before ResizeObserver callbacks in each frame, so a column that
follows its size in a ResizeObserver can tell the reader's scroll up (a scroll
event above where it last left the scroll) from its own follow, with no wheel,
key or touch listeners.

### S31 — A new command kind, and a store holding the old Lines ✅ PASS

`findings/S31-line-kinds-and-stored-lines.md`. Adding a kind to
`COMMAND_KINDS` and `OUTCOME_KINDS` changes the stored Line's schema, and a
store written before the change still opens and serves. No migration is
needed. A new Reply field was not tested.

### S30 — What a root is ✅ PASS

`findings/S30-what-a-root-is.md`. A thread started at the root, whether it is a
conversation or agent work, is rooted at its first message, and pi writes no
entry above it. So a root tab (ADR-0029) is keyed by the root entry's id and
labelled by its first message.

### S29 — State per tab, and Kyneta's peer-id lease ✅ PASS

`findings/S29-tab-state-and-peer-lease.md`. Kyneta keeps a peer id in a tab
slot and a device slot, with a lease in `localStorage`; Pineta's open columns
take the same shape without the lease (ADR-0027).

- **Duplicate Tab gives two live tabs one peer id**, because browsers copy
  `sessionStorage`. A Kyneta bug: the fix, probably Web Locks, needs a probe in
  a real browser first.
- **A reload is safe only because the lease is written while gathering**,
  before the decision.
- **After `whenSettled`, a late client reads every entry** (50 of 50 trials);
  at `connectSession`, none had them. `"populated"` and `useDocReady` are not
  that signal.

### S27 — Markdown that still cites its source ✅ PASS

`findings/S27-markdown-rendering.md`. Over 3 592 real messages, 0 of 28 734
rendered characters traced to the wrong source; no HTML or `javascript:` let
through; 5.8 ms per streaming frame for the largest message.

- **Each rendered run of text carries its source range**, and an alignment
  maps its characters to the literal, escape or reference that produced them.
- **Code needs its own handling:** past the fence line, past inline code's
  backticks, and literal only (no escapes or references in code).
- **remend only while streaming**, with the two handlers that escape mid-text
  off.
- **The spike's sampling missed two mapping errors** that exhaustive checking
  of its edge cases found in the implementation: an escape or reference losing
  to its first character, and code indented in a list. Kept as unit tests.

### S9 — pi's `IdGenerator` ✅ PASS — safe *structurally*, not statistically

`findings/S9-idgenerator-collisions.md`. 41 assertions, zero failures.
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

### S4 — Browser ↔ host over a Kyneta Line ✅ PASS (and it inverted the hypothesis)

`findings/S4-browser-transport.md` → **ADR-0014**. Re-verified: E2's table and
E3's 2701/2702 reproduce exactly.

- **ADR-0007 confirmed** over a real websocket: 7 command kinds in order,
  p50 **1.67 ms**, ~1 050 cmd/s, 2 000 commands at **1.01×** outbox growth.
- **Used a REAL captured pi stream**, not a synthetic one — and found the real
  rate is **202.6 deltas/sec, 4× the 50/s** the brief assumed.
- **The design question resolved AGAINST the brief's hypothesis** — durable, not
  presence. See ADR-0014.
- **Honest about scope:** the browser *module* was exercised under Node over a
  real socket; **no browser runtime was run**, and it says so unambiguously.
  Host and client share a process, so latencies are a floor, not a forecast.
- **Explained its own outlier** instead of just reporting it: the p99 157 ms was
  sample #0 only — a one-time post-burst outbox prune; a clean run has no tail.
- Spawned **S16**; gave **S10** a concrete measurement method.

### S1 — `seq` dissolution ✅ SOLVED, no upstream renegotiation needed

`findings/S1-seq-dissolution.md` → **ADR-0013**. The top blocker is cleared.
Independently re-verified: conformance 21/21 (+ `memory` control), fresh-seed
property 100/100, control 0/40, S3's reproduction showing 0 collisions and 0
skipped entries.

- **Refuted the architecture doc's own plan.** "Replay order → Lamport + peer
  tiebreak, inherited free from Loro" cannot work: **a convergent order and
  stable integer cursors are mutually exclusive.** Only arrival order — where
  new observations always land at the end — keeps `cursor.seq + 1` sound.
- **Also refuted the S2/T7 "API-visible break."** `ListReadOptions` is unchanged;
  no Loro `Cursor` required.
- **Found pi's own proof that density was never required:** a conformance fixture
  named `"sequence gap"` (`conformance/storage.js:522`).
- **Wrote its own property wrong first and let the test correct it** — an initial
  "seq is gapless" assertion failed immediately, correctly.
- **Instrumented its own dead code:** the causal-delivery fallback was made to
  `throw` and never fired across 400 trials + conformance — so it reports that
  path as *untested* rather than claiming coverage.
- Cost: cold index rebuild **57 ms @ n=10 000**; incremental reconcile **O(δ),
  0 ms** at both 10 000 and 50 000 entries. Linear to n=50 000.
- **Supersedes the roadmap's deliberately-failing fitness function** — "no two
  entries share a `seq` after a partition heal" now **passes**.

### S12 — Trunk semantics ✅ kill criterion NOT met

`findings/S12-trunk-semantics.md`. The trunk **can** be expressed without a
shared-writer register → **ADR-0012**. 1000/1000 property trials; **0/600** on
two independent controls; re-verified at a fresh seed.

- **Reframed the question.** Two concurrent folds onto one trunk tip are a
  *semantic* conflict in every representation — a linear path holds one of two
  siblings. All five candidates scored 1/2 or 0/2 on "folds on the trunk path."
  The real question is **loud vs. silent failure**, not contention avoidance.
- **The idiomatic-looking option fails.** Candidate (c), a keyless
  `pi.session.trunk` register, has real precedent — pi ships
  `sessionName = value("pi.session.name")` at `values.js:79`. It loses folds
  silently, 0/600. Exactly why it needed measuring rather than reasoning about.
- **The experiment corrected the design.** Single-`prev` promotions leave losers
  as permanent leaves ⇒ permanent false-positive fork detection. `prev` must be
  a **list** (merge-commit shaped). Caught by `refold.mjs` failing, then passing.
- **ADR-0010 pays off twice:** fold destination-relativity makes fork repair
  *free* — re-fold the source at the new tip; the stale merge node survives as
  immutable provenance.
- **Wiring note:** `link:` is a pnpm/yarn protocol — npm rejects it
  (`EUNSUPPORTEDPROTOCOL`), and `pnpm --ignore-workspace` couldn't reach the
  registry. The agent **symlinked the local packages into `node_modules/@kyneta/`**
  instead, which is a *truer* link than S14's dist overlay: the real local
  `package.json` and its `exports` are used. `workspace:^` never has to resolve
  because npm is never asked to install those packages.
- **Noticed a concurrent rebuild** of `~/halecraft/kyneta` mid-spike (not its own
  doing — your team's), and **re-ran the entire scorecard afterwards**; results
  identical before and after.
- Spawned **S15**.

### S14 — Re-validation on fixed Kyneta + new loro floor ✅ NOTHING REGRESSED

`findings/S14-revalidate-fixed-kyneta.md`. A 2×2 factorial (kyneta npm/local ×
loro 1.10.8/1.16.1) — the agent added config D itself, correctly noting the
factorial was incomplete without it and that S13 could not otherwise be answered.

- **Correctness invariant across all four configs.** S2 21/21; S7 900/900; S8
  1000/1000; S3 step1 12/12, step7 10/10. **Every entry total byte-identical to
  published figures** — behaviour unperturbed, not merely "still passing." Both
  negative controls still fail as designed.
- **Performance, Pineta shape n=10 000:** entries **38 444 → 93 ms (413×)**,
  lists **12 731 → 92 ms (138×)**. Linear to **n=50 000**. Independently
  re-verified at n=8 000: entries `26 234 → 75 ms`, ×4.54 → ×1.75.
- **The factorial is the interesting part.** Lists need only the Kyneta fix
  (loro version irrelevant). **Maps need BOTH**: Kyneta alone takes 24 316 →
  1 159 ms but leaves ×3.77; the loro bump then takes it to 67 ms and ×1.83.
  **The loro fix alone buys ~4%** — the Kyneta defects mask it entirely.
- **S10 partially discharged** — linearity confirmed to n=50 000. Snapshot-size
  and sync-payload questions remain.
- **Flagged for you:** `da978ec` is **not an ancestor of git `HEAD`** in the
  colocated repo (`HEAD` = `c84a5ca`, a datalog line). The *working copy* carries
  the fix and the dist is built from it, but anyone rebuilding from git `HEAD`
  would not get it. A jj/git bookkeeping question, not a code one.

### S13 — Loro map-write superlinearity ✅ CONFIRMED: upstream, not Kyneta

Demonstrated in **raw `loro-crdt` with zero Kyneta imports**, toggling one no-op
`doc.subscribe(() => {})` (independently re-run):

| loro | no subscriber @ n=8 000 | subscriber attached | penalty |
|---|---|---|---|
| **1.10.8** | 19 ms (×1.82) | **1 166 ms (×3.80)** | **61×** |
| **1.16.1** | 17 ms (×1.75) | 28 ms (×1.98) | 1.6× |

Subscriber-gated, superlinear when attached, fixed by the version bump — every
part of the commit message's claim confirmed as a black box.

> **Why S11 missed it, and the lesson.** S11's raw-loro control ran **without a
> subscriber**, so it measured a different code path from the one the substrate
> uses — the Kyneta Loro substrate *always* attaches one. S11 §3.9's conclusion
> (*"something the Kyneta→Loro binding does per key"*) is **wrong**, and the
> report should be corrected in place. **A control must exercise the same
> configuration as the subject.**

> Not verified: that the mechanism is literally an O(keys²) event build, or that
> the boundary is exactly 1.13.3/1.13.4. Effect verified; mechanism taken from
> the commit message.

### S11 — Quadratic writes ✅ DEFECT, not inherent — both causes fixed

> **✅ FIXED UPSTREAM — `da978ec perf(schema,machine)!: writes cost O(δ), not O(σ)`
> (2026-09-19).** Kyneta took the *systematic* route S11 raised as §6 item 4
> rather than its call-site patch: `step` is now `copy ∘ core`, `stepInPlace` is
> the core, `applyChange` uses the dual. S11's `fixB-reader.patch` is **superseded**.
>
> **Three further causes S11 did not find**, per the commit message:
> 1. `createDispatcher` walked the stack on every write to decorate an error —
>    now late and lazy (`@kyneta/machine`).
> 2. **`loro-crdt` built a commit's event in O(keys²)** when a subscriber is
>    attached — always, for this substrate. Bisected to 1.13.3, fixed in 1.13.4.
>    **This is the S13 residual.**
> 3. `stepSequence` silently dropped `undefined` elements — the exact hazard S11
>    guarded against in its fast path. Now fixed, so the guard is unnecessary.
>
> S11's cause-A finding stands and is called out in the commit as still
> actionable: *"the published `@kyneta/schema@3.0.0` dist predates `a5e2c8f` …
> Republishing is most of the win for anyone installing from npm."*

`findings/S11-schema-write-perf.md`. **Kill criterion not met: Pineta does not
need per-entry document granularity for write-throughput reasons.** The shape S7
settled stands.

- **Cause A — already fixed in your source, never published.** The published dist
  does `deepClonePlain(path.read(doc))` on *every* write; `path.read` resolves to
  the **whole container**, so it is O(n) per op ⇒ O(n²) per batch. Kyneta `main`
  replaced it with "Read, don't copy" in **`a5e2c8f` (2026-09-06)** — but
  `@kyneta/schema@3.0.0` was published **2026-08-18**. *Independently verified:
  the clone is present in the pristine published dist of both `@kyneta/schema`
  and `@kyneta/loro-schema`, and absent from source.* **Every measurement in S2
  was taken against code `main` had already fixed.**
- **Cause B — `step` rebuilds the whole container per op.** `step` is a pure
  arrow, which is right for the algebra; but `applyChange` materialises every
  intermediate state. Fixed with in-place fast paths for map set/delete and pure
  append; everything else falls through to the existing path. Argued safe from
  the documented liveness invariant plus `invert`-before-`applyChange` ordering.
- **Verification:** Kyneta's own **2062 tests pass unchanged** (84 files, patched
  and unpatched); S2's conformance **21/21** on the patched build; S7's
  convergence property **400 trials with entry counts byte-identical** to S7's
  published figures; negative control still fails.
- **Measured (re-verified independently):** n=8000 list `7793 → 142 ms`,
  record `18976 → 1205 ms`. Pineta shape at n=10 000: entries
  `41 270 → 1 904 ms` (22×), pending list `13 106 → 185 ms` (71×). S2's slowest
  conformance case dropped `12 198 → 267 ms`.
- **Methodological note worth keeping:** the first CPU profile was *misleading* —
  92.8% self-time collapsed into `prepare` with `applyChange` absent entirely.
  The agent stopped trusting it and bisected instead. On bundled ESM builds V8
  attribution localised the statement group correctly but named the wrong
  function.
- **Not verified:** `tsc --noEmit` OOM'd, so the patch's two `as` casts are
  type-unchecked. `@kyneta/react` and `@kyneta/devtools` were never exercised —
  they are the most likely holders of an object-identity assumption that in-place
  mutation could break.
- Spawned **S13**.

### S3 — Harness tolerance of foreign writes ✅ (kill criterion met; mitigated by design)

`findings/S3-harness-foreign-writes.md`. **Closed S2 residual #5: a real
`AgentHarness` runs over `KynetaStorage`** (step1 12/12, re-verified).

- **Confirmed:** the harness **caches** and **assumes monotonic local growth**.
  It does **not** crash or corrupt. `StorageBackedSession` does *not* cache —
  **`Lane` does** (`lane.js:128-131`, `getTipId` ignores its context param).
- **Mitigation proven:** lane-per-writer → 10/10, re-verified, zero orphans,
  producing exactly the branched tree Pineta wants from two partitioned writers
  with zero coordination.
- **T5 answered: yes, the mutex can be per-replica.** The question was aimed at
  the wrong object — no probe produced a `Storage`-contract violation. The real
  coupling is the shared `branchTip` register and the global `seq`.
- **Itemised 10 exclusive-ownership assumptions (A1–A10) with file:line
  evidence**, plus 5 escape hatches (P1–P5) — notably `MutationLine` is
  *injectable*, so a distributed barrier is possible without forking.
- **Net: multi-writer Pineta stays a STORAGE project**, conditional on ADR-0011.
- Model layer was **stubbed**; the drive/inference loop is untested (residual #1).

### S8 — `pi.branch.tip` contention ✅ PASS

`findings/S8-branch-tip-contention.md`. 1000/1000 property trials for
lane-per-writer across 5 seeds; **0/300 for the shared-lane control**; both
re-verified at a fresh seed.

- **It is not one register, it is three.** `pi.lane.state` carries the steering
  **inbox**, so a clobber drops queued user messages too.
- 12 non-test `setValue(branchTip(...))` sites — the tip is rewritten on
  essentially **every commit in the drive loop**, not once per turn.
- Evaluated 4 designs under one workload; (b) key-rewriting **leaks** through
  pi's prefix scan; (d) `Schema.set` **rejected at runtime**.
- **v1 is not exposed** — the hazard needs ≥2 harness processes.
- **Caught its own bad invariant.** Its first property was "every entry is
  reachable from some tip" — which failed 169/200 *even for the correct design*,
  because `navigateTree` **intentionally** orphans entries. Abandoning a branch
  is what branching *is* (ADR-0004). See the fitness-function correction below.
- Spawned **S12**.

### S5 — Destination-aware three-way fold ✅ PASS

`findings/S5-fold-quality.md`. Four scenarios (aside / scout / contradict /
irrelevant control) plus a three-way ablation, on a genuinely branched session
(verified: all four `theirs` files share real entry-id `lca=7ffc796c`).

- **The ablation is the result.** Labelled three-way (254 words, finds a
  cross-leg implication) > `theirs`-only (221 words, confidently recommends a
  design the destination already rejected) > **same bytes unlabelled (167 words,
  *worst* — state confusion).** The lift comes from the *partition*, not the
  model.
- Irrelevant control dismissed in one line — directly refutes the
  "smuggles in irrelevant context" kill condition.
- Naive concatenate-and-summarise is 2–4× longer and is the **wrong artifact**
  (a whole-conversation summary, not a fold).
- Token saving is exactly one base leg (16–27%) — real but **secondary**; the
  semantic argument carries the design.
- Produced **ADR-0010**. Prompt kept at `out/*.foldprompt.txt`.
- **Incidental pi finding:** `get_last_assistant_text` returns `{"data":{}}`
  despite `docs/rpc.md` documenting `{"text": "..."}`. Read `message_end` events
  instead.
- **Method note:** pi RPC has *no* in-place tree navigation (no `navigate_tree`,
  `branch`, or `set_leaf`); `/tree` is TUI-only. Branching headlessly required
  snapshotting the session file and extending copies.

### S2 — `KynetaStorage` conformance ✅ PASS (21/21)

`findings/S2-storage-conformance.md`. Passed **first execution**, stable over
three runs, independently re-verified. `MemoryStorage` control also 21/21.
Adapter is ~305 lines.

- **ADR-0003 confirmed.** Third-party `Storage` backends are a genuinely
  supported extension point.
- **ADR-0002 supported:** full export → fresh replica → re-read with byte
  fidelity, including `\u0000`-separated and astral-plane keys.
- **No shadow index** — every read materialises from the Loro doc, so the
  document really is the source of truth.
- pi supplies far more than the interface: `prepareStorageCommit`,
  `validateCommittedWrites`, `resolveListReadOptions`, `addUsage`, and
  `MemoryStorage` as a reference state machine. This is why it passed first try.
- **Spawned S11** (the quadratic-write finding).

### S7 — Divergent branches persist distinctly ✅ PASS

`findings/S7-branch-convergence.md`. 34/34 assertions, 900 property trials,
~15.9k entries, zero failures. Independently re-verified at a fresh seed.

- Settled the document shape: `Schema.record(Schema.struct.json({...}))`
- Produced **ADR-0009** (id uniqueness as a safety invariant)
- Reproduced the ADR-0008 failure mode locally (§3.5)
- Delivered `convergence.property.mjs` + `negative-control.mjs`, ready to promote
  to a permanent fitness function
- Spawned S8, S9, S10 from its residuals

**One claim in the report is wrong:** it states it is "correcting"
`01-architecture.md` regarding `Schema.set` type-level rejection. Our docs never
mentioned `Schema.set`. The underlying finding (runtime rejection) is retained;
the attribution was invented and no correction was applied.
