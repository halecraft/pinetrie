# ADR-0144 — A budget for agents talking spends what each request adds, never the context it re-reads

- **Status:** Accepted (Duane, 2026-10-16)
- **Area:** `packages/rules/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`,
  `packages/pi/TECHNICAL.md`
- **Evidence:** S144
- **Amends:**
  - ADR-0128: a run's request spends its output and the context new since the
    run's previous request, not pi's `totalTokens`.

**Context.** ADR-0128 counts a request as pi's `totalTokens`: input,
output, and cache reads and writes (S144). Every request re-sends the
lane's whole context, so each one costs at least the thread's size. An
asked agent in a thread of 100k tokens spends a budget of 200k in two
requests, and a run that reads a file or a thread before it answers needs
three or more. In use, the asked agent was stopped before it answered,
and the asking thread was told the budget was spent, on the first ask.

**Decision.**

- **A run's request spends what it adds to the talk**
  (`packages/rules/TECHNICAL.md`): its output, thinking included, and the
  context new since the run's previous request (tool results, a steered
  message), which is this request's context less the previous one's
  context and output.
- **A run's first request spends its output alone.** Its prompt is an ask
  or an answer, which another agent wrote, and was counted as that
  agent's output; the rest is the thread as it was.
- **A compaction adds nothing**: a smaller context spends only the
  output.
- **The previous request is kept in memory**, by its run's prompt,
  until the run ends. A run resumed after a restart counts its first request's
  output alone.
- **A request outside every thread** (the verdict, the digest, the
  round's) still spends all its tokens: it re-reads no lane, and what it
  sends was built for it.
- **The default stays 200k.**

**Consequences.**

- **An asked agent answers** on what it reads and writes, whatever its
  thread's size.
- **The budget no longer tracks cost.** A thread's re-read context is
  most of what a provider bills, and is free here. ADR-0128 already
  declined a budget of money; this one measures how much agents say and
  bring in, which is what grows when they loop.
- **pi's usage event reaches the host as its parts** (`RequestTokens`:
  context and output), not one total.

**Alternatives rejected.**

- **A larger default.** A thread's size has no bound a default could
  meet, and a budget large enough for a big thread lets a small one loop
  for long.
- **Leave out cache reads only.** A cache miss (a lane idle past the
  cache's life, or a provider without caching) re-reads the whole thread
  as input or cache writes, and spends it again.
- **Output only.** A tool that brings in a whole thread or file would cost
  nothing, though it is what the next requests carry.
