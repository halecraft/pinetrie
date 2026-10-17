# ADR-0163 — No trunk is stored: one writer holds each thread's end, so a fold that loses a race is refused like any other

- **Status:** Proposed
- **Area:** `docs/01-architecture.md`
- **Evidence:** S12
- **Supersedes:**
  - ADR-0012: no trunk and no promotion are stored. The host is the only
    writer of each thread's end, so two folds into one end race like two
    messages (ADR-0120), and nothing derives a winner.

**Context.**

- **ADR-0012 answered many writers.** ADR-0011 gave every writer a lane
  of its own. Two peers could then fold into the same trunk tip at once,
  and only one fold can come next on a linear path (S12). ADR-0012 stored
  each promotion of a tip as a record in an append-only DAG. It derived
  the trunk's tip as the DAG's leaf, or as the winner under `(ts, peer,
  id)` when there were several, and showed the fork.
- **None of that was built.** No promotion record, trunk pointer or winner
  rule exists in the code or the schema. S15, which asked whether that
  winner should be causal, stayed open on a rule that never ran.
- **The writers it guarded against are gone.** ADR-0011 is superseded. The
  host is every lane's only writer and runs every command in one serial
  executor (ADR-0120). One host holds a lane at a time and alone writes its
  thread's end (ADR-0119). Two people's commands never write the same end
  at once.
- **No thread is a trunk.** The data has no main thread. Whatever you put
  first reads as the trunk (`docs/06-interface.md`, Principles), and a
  root's threads are peers. A fold's destination is the thread you fold
  into (ADR-0010), not a tip that all the session shares.
- **S12's deeper finding still holds.** Two folds into one end are a
  semantic conflict in any representation: the second was written without
  the first in its `ours` leg.

**Decision.**

- **No trunk is stored, and no promotion.** A thread's end is its lane's
  tip, or a conversation's newest entry, as the host writes it (ADR-0120).
- **Two folds into one thread's end meet ADR-0120's race rule.** A fold
  that would land below something its author did not see is not written.
  It is folded again at the new end, which ADR-0010 already prescribes, or
  it lands on a branch. The conflict is refused, not stored.
- **Nothing derives a winner.** With one writer, the order is the order in
  which the host writes.

**Consequences.**

- `docs/01-architecture.md`, Fold, states the race in place of the
  promotion DAG. `packages/schema/TECHNICAL.md` no longer cites ADR-0012
  for `parentId`.
- S15 is moot.
- If a session's records ever have more than one writer (the federation
  that ADR-0119 defers), what each end's single writer is will be decided
  then, with the conflict S12 found still in view.

**Alternatives rejected.**

- **Keep ADR-0012 in force for a federated future.** It describes a store
  of many writers that pine·trie chose not to be (ADR-0120). It would be
  rebuilt then on the records of that time, not on ADR-0011's lanes.
- **Build the promotion DAG now.** It guards against a race that one
  serial writer cannot have.
