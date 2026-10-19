# ADR-0181 — A lane's refresh reads your repo off the owner, four lanes at a time, and names accepted thread commits by their revset

- **Status:** Proposed
- **Area:** `packages/jj/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S253, S254, S87
- **Amends:**
  - ADR-0065: a lane's refresh gathers with jj pinned to an operation, off the
    owner, up to four lanes at once; only what it writes runs on the owner,
    and only at the head it gathered at. After accepted work moves, a lane's
    refresh runs five jj processes, not four.
  - ADR-0067: a refresh of a lane whose base moved runs three more jj
    processes, not two: the start read too, while accepted work sits above the
    lane's base.

**Context.**

- **An acceptance refreshes every lane, one after another.** Accepted work
  moving marks every named lane whose thread is not archived (`planMarks`).
  Each refresh is upkeep on the owner of your repo (ADR-0065), which runs
  one step at a time. A lane shows **catch up** only once its own refresh
  has written its base record's catch-up read (`catchUpNow`). On Duane's
  Mac, after one acceptance, refreshes waited up to 45.9 s.
- **Most of that time is one revset.** In S253's copy of Duane's repo, 73
  lanes were refreshed after an acceptance, and 62 of them had no proposed
  changes. Their gathers ran 386 jj processes, 17.0 s in series on Linux.
  The lane read (`gatherLane`) writes out all 304 accepted thread commits,
  `(present(c1) | …)`, and took 148 ms against an empty `jj log`'s 13-15
  ms. Naming them by the revset the shared facts read them by
  (`ACCEPTED_THREAD_COMMITS` under accepted work), through an alias, took
  22 ms and printed the same bytes. The start read's union of sources, 8.9
  KB, took 38 ms written out and 25 ms as an alias. The list grows with
  every acceptance.
- **The reads write nothing, so they need not wait their turn.** A jj read
  pinned with `--at-op` writes nothing, whatever runs beside it (S87). In
  S253, gathers run 4, 8 and 16 at once gave the same facts as the serial
  run for all 73 lanes.
- **The documented costs were low.** ADR-0065, as ADR-0067 amended it,
  says a lane whose base moved runs two more jj processes. The lane read
  holds every accepted thread commit not under the lane's base, other
  lanes' acceptances included, so once any acceptance sits above that base
  the start read (`readStart`) runs too. Nothing keeps it: unlike the
  catch-up diffs, `known` does not cover it. S253 counted five processes
  for 60 of the 73 lanes.

**Decision.**

- **A long set of commits in a read is a revset, not a list.** Every read
  that names the accepted thread commits names them by the revset the
  shared facts (`readShared`) read them by, at the same operation, so it
  is the same set: `readShared` lists them from `::<accepted> &
  ACCEPTED_THREAD_COMMITS`, and the read names that revset. A union of
  commits that no revset expresses, such as the start read's sources,
  goes in as a revset alias (`--config revset-aliases.<name>=…`), not
  inline.
- **A refresh gathers off the owner.** Its gather (`gatherRefresh`) runs
  with jj pinned to the operation the owner last observed. Its shared
  facts are that operation's: `readShared` takes an operation and a
  pinned runner already, and the facts are kept per operation, read once
  however many lanes gather there. Up to four lanes gather at once. A lane
  gathers at most once at a time, and a lane marked again while it
  gathers gathers once more after it.
- **What a refresh writes still runs on the owner,** as upkeep keyed
  `refresh:<lane>`: its repo steps and its records. The step first checks
  that the head is still the operation it gathered at. If it is not, the
  step gathers again on the owner and plans from that, as a refresh does
  today.
- **The documented costs are S253's.** Proposed changes left unchanged
  cost 2 jj processes. After accepted work moves past a lane's base, its
  refresh runs 5: the lane read, the start read, `filesTouched`, and two
  catch-up diffs, plus one diff for each further head of its proposed
  changes' start.

**Consequences.**

- **The fan-out after an acceptance falls about eightfold** on S253's copy:
  from 17.0 s to 2.0 s for 73 lanes on Linux, with the same facts for
  every lane. The revsets alone take it to 7.6 s, and four lanes at once
  without them to 4.1 s.
- **A command no longer waits behind a gather.** The owner runs only a
  refresh's writes, and a refresh that writes nothing to your repo holds
  the owner only while it writes its records.
- **A build moves the head, and the gathers made before it are gathered
  again on the owner.** After an acceptance, few refreshes build, so few
  pay twice. At worst, a refresh gathers twice: once off the owner, and
  once on it as today.
- **The host log's `refresh:<lane>` line times only the write step.** A
  gather that runs slow shows up only through its slow commands
  (`onSlowCommand`).
- **The Mac gathers as Linux does.** On Duane's Mac, the 73 lanes' gathers
  took 15.3 s in series and 1.7 s with the revsets and four at once
  (S253 item 9).
- **This speeds up only the gathers.** The refreshes in Duane's log ran
  1.1-2.3 s, and the same lanes' gathers 141-326 ms on his Mac (S253 item
  10). The rest was more jj: the shared facts, accepted work's record's
  facts among them, read at every new operation, and the record read back
  after a write (S254). Since S254's change, a refresh that rebases after
  an acceptance runs 13 jj processes, most of them its writes, which stay
  on the owner, one lane after another. This ADR stays Proposed until a
  host log, whose slow-step lines now say where each refresh's time went,
  shows what is left. Lanes on a WIP are not measured either: S253's repo
  had none.

**Alternatives rejected.**

- **One `jj log` for every lane's read.** It works, with each row tagged
  by its lane through aliases in a config file: 0.42-0.52 s for all 73
  lanes' reads, with the same facts. Written out as one argument, it was
  past Linux's 128 KiB limit for a single argument (`E2BIG`). It saves
  about another second over the aliased reads, while every lane still
  runs its other three or four reads, and S100's questions about lanes on
  a WIP still apply.
- **Every diff through one `git diff-tree --stdin`.** It answered all 152
  diffs in 72 ms, but listed other paths than jj for 40 of them. jj lists
  only a renamed file's new path, and git with `-M` pairs renames
  differently from jj (71 differ).
- **Running each repeated command once.** Of the 386 commands, 321 were
  distinct: a lane's diff from its own tip is its own.
- **Accepted work as a jj workspace, so jj brings lanes up to date.** jj
  carries work along only when a commit is rewritten, and an acceptance
  rewrites nothing. The lanes are repos of their own (ADR-0034), and
  catching up is a merge a thread chooses. ADR-0104 rejected a workspace
  to accept into.
- **More than four at once.** Eight took S253's fan-out from 2.0 s to
  1.3 s, and sixteen to 1.1 s, on a 16-core machine. Four gives most of the
  gain, and leaves the rest of the machine to the lanes.
