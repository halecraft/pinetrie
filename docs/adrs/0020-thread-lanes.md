# ADR-0020 — Lanes belong to threads and never move; people own none

**Status:** Accepted. Supersedes ADR-0011. Amends ADR-0018 and ADR-0019.
Evidence: S19, S20, S21. Amended by ADR-0021 (the lane is also the thread's
mode), and by ADR-0048 (step 3) with ADR-0055: what waits for a busy lane is
a queued card, written by clients and taken by the host; nothing waits in
`pineta.outbox`, which is gone. (ADR-0026 said a note, and was never built.)

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
