# ADR-0162 — A root is reached only through a keeper step's documents or a lease, and one upkeep step lets go of every root neither holds

Numbered 0156 until 2026-10-17, when two files held that number.

- **Status:** Accepted (Duane, 2026-10-17)
- **Area:** `apps/pinetrie/host/TECHNICAL.md`, `packages/rules/TECHNICAL.md`,
  `packages/keeper/TECHNICAL.md`, `packages/pi/TECHNICAL.md`,
  `docs/01-architecture.md`
- **Evidence:** S84, S86, S91, S199, S216
- **Amends:**
  - ADR-0063: the host no longer holds every root that is not archived. A root
    is loaded while a keeper step or a lease holds it, and a starting host
    opens only the roots of lanes a crash interrupted a run in.
  - ADR-0029: a late write still lands only in a thread at a live place, but
    that rule no longer says what is loaded: the late step loads the root once
    the thread passes.
- **Amended by:**
  - ADR-0188: the upkeep compacts a document only once its stored changes
    outweigh its whole record, never because a run settled or a root leaves
    memory; it destroys a root's scratch document once no run needs it.

**Context.**

- **A starting host opens every live root.** That is every started root
  with a thread on an open task's canvas or in an inventory (`rootsHeld`,
  `packages/rules/task.ts`). On 2026-10-16 that was 115 of Duane's 195
  roots, most of them in the backlog.
- **Each one costs about its stored size in heap**, and about 4.4 ms per
  stored MB to load. Loading them in parallel is no faster (S216). In S84,
  Duane's 57 roots were 124 MB stored and held 186 MB of heap.
- **Host code relies on that rule, and nothing checks it.**
  - `HostDocuments` answers `view(root)` and `docOfLane(lane)` with `null`
    for a root that is not loaded, and any module can ask, at any time.
  - S216 read all 24 such reads. Six can run with no lane running: an
    offer's tip and WIP line, a review's revisions, a description's
    messages, a card's thread end in `Places`, `appendLaneless`, and every
    late step.
  - On an unloaded root, each of these goes on with an empty value instead
    of failing. Only "every live root is held" (S199) keeps them right.
- **Any module can also hold a handle across awaits.** A handle Kyneta has
  unloaded reads its last value and refuses writes. Nothing says how long
  a handle stays good.
- **Kyneta does not need the host to hold a root a tab shows** (S216, P1
  and P2):
  - When the host unloads it, the tab keeps its copy.
  - When the host loads it again, the tab syncs again and gets the host's
    next write.
  - When a tab asks for a root the host has let go, the host loads it and
    reports `doc-promoted`.
- **Unloading a root a tab holds makes the tab ask again** (S216, P5).
  Doing that at every load never ends. P5 saw a tab that had synced stay
  quiet, but the host suite saw two synced tabs ask again after every
  upkeep, the host loading the roots again each time ("asked for unloaded
  doc — loading it again", without end). So a root a tab holds is kept, not
  only one it is still taking.

**Decision.**

*Access.*

- **Every keeper step receives its step's documents, and a root is reached
  only through them or through a lease.**
  - `@pinetrie/keeper` gains a step context: `createKeeper` takes
    `context: { open(): C; close(c: C): void }`, and `run`, `once` and
    `later` hand each step the `C` that `open` made for it. `close` runs
    when the step settles. Keepers without a context are unchanged.
  - The host's keeper makes a `StepDocs` for each step: `root(root)`,
    `lane(lane)`, `lease(root)`, `destroy(root)`, and the `records` that
    write through it. Its `close` revokes it, so a call after the step
    settled throws.
  - `Basics.docs` keeps the documents always loaded: the session,
    `pinetrie:live` and the places. It no longer offers `root`, `laneDoc`,
    `view`, `docOfLane`, `loaded`, `unload` or `destroy`.
  - A plan takes the handles its step loaded as arguments.
  - So "not loaded" cannot be written. `lane(lane)`'s `null` means "no
    `LANE` record", which is a fact about the lane, not about memory.
- **A record's scope is in its write's type.** `ValueWrite` carries the
  scope of its spec (`RecordSpec<R, K, "session" | "root">`), and
  `setRecord`'s overloads return it. The `Records` port a module gets at
  construction takes `ValueWrite<"session">` alone. A root's record (a
  digest, a revision) is written through `StepDocs.records`.
- **A lease keeps a root loaded outside the keeper.**
  - It is taken from a step's `StepDocs`, on a root that step loaded. It
    carries the handle, and is released by `await using`.
  - Leases are counted by root: they say what must stay in memory, not
    what is running. Which lanes run stays `pinetrie:live`'s.
  - A run takes one in `Runs.start`, which takes the step's `StepDocs` and
    so can only be called inside a step. It releases it after the run's
    `ended` has run.
  - What reads a running lane's root (the stream, its pinned cards, its
    task's context, its budget, its pending verdict) reads the handle the
    run's lease carries. `Runs.docOf(lane)` returns it, and its `null`
    means "no run".
- **pi opens a root only if a step or a lease holds it, and its cached
  session is released before the root is unloaded.**
  - pi's port (`AgentDocuments.root`) answers for a root the running step
    loaded, or a leased one. For any other root it throws. This is the one
    check made at run time, because pi's calls cross its package boundary.
  - The scribe caches a root's session after that first open, and later
    appends use the cache without asking the port. That stays sound
    because the upkeep step runs the scribe's `release` before it unloads
    the root.

*Residency.*

- **What should be loaded is a derived set:** the roots a lease holds, plus
  the roots a tab holds or is taking (a `pending` or `synced` peer state,
  `sync(doc).peerStates`).
- **A tab tells the host it let a root go.** `rootDocs`
  (`packages/session/root-docs.ts`) destroys a root before it stops wanting
  it: Kyneta sends `dismiss` only where `canShare` still allows it (S216,
  P3), so narrowed first, the host would never hear the drop.
- **One upkeep step reconciles storage and memory with it.** It replaces
  the settle's compaction (`later("compact")`), keyed `upkeep`.
  - Its plan (`planUpkeep`, pure) returns the documents to compact (the
    roots runs changed since the last upkeep, and the session's documents
    when a settle asked, as today), the roots to unload (every loaded root
    outside the set), and the roots a tab holds to start watching.
  - It compacts, releases, then unloads, in that order: a root is compacted
    before it leaves memory.
  - A settle, every load and every lease's release queue it. So does a
    change to a watched root's peers.
  - Nothing else unloads a root. `StepDocs.destroy` refuses a leased root.
    The migrations, which run before the keeper exists, unload what they
    opened, as today.
- **What follows, by construction:**
  - **L1.** Inside a step, every root it loaded stays loaded until the step
    ends. Only the upkeep step unloads, it is a keeper step, and the keeper
    runs one step at a time.
  - **L2.** A leased root stays loaded for as long as its lease lives. A
    lease is taken inside a step, on a root that step loaded, so by L1
    there is no gap between the load and the lease. The upkeep step leaves
    leased roots alone.
  - **L3.** When the keeper is idle, no lease is held and no tab holds a
    root, no root is loaded. Every load and every release queues the upkeep step,
    and a `later` runs after every step queued before it.
  - **L4.** A tab's ask loads a root at most once per ask: the upkeep step
    keeps a root while a tab holds it, so the tab has no reason to ask
    again. This one rests on Kyneta reporting its peers; the others rest on
    our code.
- **A model-based test checks L1–L3** against the real keeper with its
  step context, the roots' store and an in-memory Exchange. It runs every
  sequence of a small alphabet of events, and checks each lemma after
  every event.
- **Stacks of moves keep their own lifetime.** A person's stacks unload
  when their last seat leaves (`seats.ts`), and a task's when it is
  archived or deleted, as today. The upkeep step does not unload them.
  Releasing a root no longer unloads its tasks' stacks: the archive's close
  unloads its task's stacks itself.

*Startup, recovery and the rest.*

- **A starting host opens only the roots of the lanes in `pinetrie:live`'s
  `activeRuns`**, read before `planClear` empties it, and `recover` resumes
  the interrupted lanes among them.
- **A root's first load in a host's life queues the startup checks for that
  root** as a step of its own. It gathers the root's interrupted lanes, its
  stored record keys and its malformed lanes; plans with `planStartup` and
  `planUndeclaredSweep`; then resumes, deletes and logs. This catches a
  lane interrupted outside a run, which `activeRuns` does not name.
- **Roots Kyneta loads for a tab are followed** (`exchange.documents`,
  `doc-promoted`) once the directory names them, counted as loaded and left
  to the upkeep step. A root with no message is not started: the directory
  records no root without one, and a tab's minted root is not followed
  before its first send, which would otherwise find its id in use.
- **The directory refreshes a root from the handle its change event came
  with.** A handle unloaded since still reads the root's last value, which
  is what the record should say. Its rebuild of stale records loads in a
  step and leaves the unloading to the upkeep step.
- **Archiving queues the upkeep step instead of unloading.** Restoring
  opens nothing.
- **Which thread takes a write is unchanged.** The gate (`planGate`) and the
  late writes' gate (`lateAway` over `isLivePlace`) still decide that, as
  ADR-0029 has it. `Later.step` loads the root of a thread that passes,
  then plans. `rootsHeld` and `readStartedRoots` go.

**Consequences.**

- A starting host opens a few roots, not every live one. Its heap grows with
  what is running, not with the board.
- About 20 keeper steps use their `StepDocs`, and about 52 reads of a root
  move to one or to a run's lease. Code that reads a root without loading
  it no longer compiles, and neither does a module writing a root's record
  outside a step.
- The keeper's steps all take a context argument. A step that needs none
  ignores it.
- The first step into an idle root pays its load. S216 measured 1–20 ms for
  roots of 0.06–4.35 MB stored. For the largest root in S84 (13.6 MB), the
  same rate gives about 60 ms. Each load also rebuilds the root's pi session
  and harness: 0.35 ms each in S84.
- A root is compacted each time it leaves memory: 18 ms for the median root
  and 182 ms for the largest in S84.
- A root stays loaded while any tab shows it, so the host's heap follows
  what people have open as well as what runs.
- A lane a crash interrupted outside a run resumes when its root is next
  loaded, not at startup.
- The startup log names how many roots it opened and why, not "of N, M
  archived".
- The e2e harness reads the host's roots through a step, since a quiet host
  holds none.

**Alternatives rejected.**

- **A workflow state whose roots are not held**, beside Backlog. Its roots
  would be read-only, a second archive, which ADR-0122 rejects. Otherwise a
  write would load them, which is this decision with a state added. And a
  backlog item is a conversation people write in (ADR-0122).
- **Fixing the six reads one by one** (`await docs.root` before each). It
  fixes today's readers and leaves the port that let them go wrong. The next
  sync read of `view` would compile.
- **A documents' wrapper beside the keeper** (`steps.run`, `steps.once`,
  `steps.later`). It would repeat the keeper's API, and every module would
  choose between two ways to queue a step.
- **Steps declaring their roots up front**, with a map typed by the
  declaration. Many steps learn which roots they read partway through their
  gather, from the places or a lane's record. A handle `root` returns
  inside a step is already never null.
- **`view` throwing instead of returning `null`.** The mistake would then
  show at run time, not at compile time, and a read outside any step would
  still compile.
- **A second `later` for the sweep, beside the compaction.** Two upkeep
  steps would compact the same root twice, and memory and storage would be
  reconciled in two places.
- **Stacks of moves in the same upkeep step.** A stack unloaded and loaded
  again is measured (S91), but not whether one reloaded refuses the undo of
  a move the host overtook while it was unloaded. Until a spike answers
  that, stacks keep the lifetime S91 measured.
- **Letting go of a root a tab holds.** The tab asks for it again, and the
  host loads it again, with no end.
- **Unloading a root after a time idle.** That is a clock standing in for
  what holds a root, which is a value.
- **Loading the live roots in parallel at startup.** It is no faster
  (S216), and the heap stays the same.
- **Recovering only the roots in `activeRuns`.** S216 found no check that pi
  opens an operation only inside a run, so a lane interrupted outside one
  would stay busy until a restart that happened to open its root.
