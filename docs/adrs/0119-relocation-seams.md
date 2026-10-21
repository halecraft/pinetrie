# ADR-0119 — A thread, its lane and where the lane runs are kept apart; one host holds a lane at a time, and a lane at rest can be rebuilt elsewhere

- **Status:** Accepted (Duane, 2026-10-08)
- **Area:** `docs/01-architecture.md`, `packages/lanes/TECHNICAL.md`
- **Amends:**
  - ADR-0120: one host holds a lane at a time, and is the only writer of its
    thread's end.
  - ADR-0023: the session's host writes the session's records; a lane's host
    writes its thread.
  - ADR-0034: a lane at rest is its revisions; what else is on its disk is
    rebuildable.
- **Amended by:**
  - ADR-0168: a lane's record naming its host, the runner, and the check that
    a lane rebuilt from its revisions runs are shelved. One host holds a lane
    at a time and alone writes its thread's end, as built.
  - ADR-0202: a lane's record names the machine it is tethered to, by
    principal; that machine alone writes the agent's record.

**Context.**

- **"The host is the only writer of the session's documents. A lane belongs
  to its thread, and is never moved"** (ADR-0120, ADR-0023). "Never moved"
  means its tip never jumps elsewhere in the tree.
- **A lane has a machine, too**: its disk, its container's CPU, and the
  model its runs call. The aim, later, is to take a lane from one machine
  to another between runs: from a host in the cloud to a laptop, say, and
  go on with a local model.
- **ADR-0117 names four layers**: history, thread, lane, runner. History
  syncs already, and a thread's card moves by handoff. The lane and its
  runner are the ones bound to one machine.
- **pi carries a history to another model.** `transformMessages` in
  `@earendil-works/pi-ai` 0.87.1 (`dist/api/transform-messages.js`)
  rewrites tool-call ids for the new provider, converts thinking blocks,
  and puts a placeholder for each image a model without vision cannot read.
- **The model is the host's**, from pi's settings or `PINETRIE_MODEL`.

**Decision.** Only the seams. Relocation itself is not built.

- **The four layers stay apart in code.** Nothing about a thread's card
  reads its runner, and nothing about a lane's disk assumes the host that
  made it.
- **One host holds a lane at a time.** The host holding a lane is the only
  writer of its thread's end and its lane's records. A lane's record names
  its host. Today one host holds every lane of its session, so nothing
  behaves differently. The session's records (the board, tasks, places)
  keep one writer: the session's host.
- **A lane at rest is its revisions.** Between runs, what its next run
  needs is its thread's history, each branched source's last turn revision
  (ADR-0118), its sources and their modes, and its image. Anything else on
  its disk, such as ignored files, installed dependencies and caches, is
  rebuildable: a lane started from those alone must run, as a root
  thread's lane starts now.
- **A run never moves.** Relocation, when built, happens between runs, and
  is refused while one runs.
- **The model is a run's choice**, from the host's default. Nothing stores
  it on the lane.
- **A live source ties its lane to its machine** (ADR-0118). Read-only
  sources travel only where the other machine has them.

**Consequences.**

- **A lane's record gains its host**: one value, while there is one host.
- **A check that a lane rebuilt from its revisions runs**, on a fresh disk.
  A root thread's lane already starts this way.
- **Deferred to the ADR that builds relocation:** who writes the session's
  records once hosts are many; how a lane's revisions and its thread's
  documents reach the other host; and the verb, since "move" is a board's
  and a card's.

**Alternatives rejected.**

- **Build relocation now.** It needs federation of the session's records,
  which nothing else needs yet.
- **No seams.** Each later step would first unpick a host-wide assumption.
- **A lane's disk as the unit that travels** (`btrfs send`). Exact, but
  large, and tied to btrfs; revisions travel with jj, to any machine.
- **A model fixed per lane.** A thread that moves to a laptop could not go
  on with the model the laptop has.
