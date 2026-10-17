# ADR-0160 — Of agents talking, only `read_thread` is still to build; five other unbuilt parts are shelved

- **Status:** Accepted (Duane, 2026-10-16)
- **Area:** `docs/06-interface.md`
- **Amends:**
  - ADR-0128: a budget chosen in the composer, a top-up, dismissing a member,
    a relayed run's verdict in the asking thread and the asked thread's
    "talking in" header are shelved; `read_thread` is still to build.

**Context.** ADR-0128 was accepted with most of it built: mentions of
another thread's agent, invites and members, `ask`, ask cards, answers,
heard entries, budgets and their stop, the round, and Stop reaching
relayed runs. Six parts were never built:

- `read_thread`, an agent's tool to read another thread in reach;
- a budget chosen per message, in the composer (`Command.budget`); every
  budget is the config's `agents.budget`;
- a top-up of a spent budget ("the fact offers more");
- a person dismissing a member; only the agent's `leave` exists;
- a relayed run's verdict in the thread that asked; it is the run's own
  thread's;
- the asked thread's header saying "talking in sable-meadow" while a
  relayed run runs.

Reading a thread is still wanted. Whether the other five are is not
settled.

**Decision.**

- **`read_thread` stays decided**, as ADR-0128 states it, and is to be
  built.
- **The other five are shelved.** Nothing is built toward them, and
  nothing describes them as coming. The behaviour that holds is what is
  built: the config's budget for every message, no top-up, members leave
  only by `leave`, a run's verdict in its own thread, and no "talking in"
  line.
- **Taking one up again** is a new decision, with an ADR of its own.

**Consequences.**

- `docs/06-interface.md` names `read_thread` as decided and not built,
  and the five as shelved.
- A spent budget stops what agents start for good: a person who wants
  more sends a new message, which sets a new budget.
- A member stays until its agent leaves.

**Alternatives rejected.**

- **Keep ADR-0128 Proposed until all of it is built.** It holds decisions
  in force that are built and relied on, and shows them as undecided.
- **Delete the five from ADR-0128.** The record is a log; an accepted ADR
  is amended, not rewritten.
- **Shelve `read_thread` too.** It is still intended: reading a digest
  costs less than asking an agent that rereads its whole context.
