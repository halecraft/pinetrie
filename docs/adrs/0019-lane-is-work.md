# ADR-0019 — A lane is a line of work, not a unit of parallelism

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
