# ADR-0009 — Entry id uniqueness is a safety invariant, not a convenience

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
convention — add it to the fitness functions in `docs/04-roadmap.md`.

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
