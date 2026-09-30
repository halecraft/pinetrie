# ADR-0018 — Humans in the tree: chat is a pi `CustomMessage`, and only an agent can be compelled

**Status:** Accepted. Roadmap step 5. Evidence: S19. Amended by ADR-0020 (lanes
belong to threads) and ADR-0021 (a thread's mode is its lane; a mention picks
the addressee).

**Context.** People working with an agent also talk to each other, and that
talk is part of the work: an invited agent needs it, in order and by speaker.
A transcript cannot hold it without every message becoming a prompt. The
question was how human messages enter pi's tree without each one costing a run,
and what decides when the agent answers.

**Decision.**
- **Obligation, not identity, is the distinction.** A *collaborator* may reply
  at their discretion, human or bot. A *compelled responder* must reply, which
  is a run, and only an agent can be one. Every human message records who it
  compels (`Responder`): usually nobody.
- **A human message is a pi `CustomMessage`** (`role: "custom"`,
  `customType: "pineta.chat"`). `content` is what the model reads, with the
  speaker ("Alice: …"), copied at write time; `details` holds the author lane,
  display name, text and responder. pi's default conversion sends it to the
  model as a `user` message, so there is no projector.
- **A compelled message IS the agent's prompt**, run on the agent's lane
  (`a-agent`). A message that compels nobody is appended on its author's lane
  with no run. Both attach where the author is reading.
- **Appended through the pi `Lane`, never the session.** A `Lane` plans against
  its cached tip; a write through `session.mutate` is stored but drops out of
  the next turn's path, silently (S19).
- **Threads carry a default.** A *working session* compels the agent on every
  message; a *conversation* compels nobody, so `@agent` does. Set at an entry
  as a `pineta.thread` value and inherited below it; the session's root is a
  working session. `@name` notifies a person and never compels. *Superseded by
  ADR-0021:* the default is derived from whether the thread has a lane, nothing
  is stored, and a message naming only people does not compel the agent.
- **The composer states the obligation before sending**, using the same
  `compelledResponder` the host runs.
- **pi's data is written only by the host.** Shared drafts, a later plan, will
  extend this to "tabs write only draft text".

**Consequences.** One shape for all human messages; a run exactly when an agent
is compelled. The agent's lane is shared, so the agent answers one message at a
time, and a second compelled message is refused (`busy`), not queued. Views
follow leaves, not lane tips, because the agent's lane leaves a thread whenever
another thread compels it. `prompt` and `branch` become redundant and are
removed.

**Alternatives rejected.** Chat outside the tree (a second record; the agent
would need it re-assembled). A custom entry with an `entryProjectors` projector
(a run must start with `prompt`, so compelling the agent would add a synthetic
second message; S19). Chat written directly by browser tabs (leaves pi's tree).
People versus agents as the distinction (a bot can collaborate; only an agent
can be compelled). A separate "note" type (a note is a message that compels
nobody). Discretionary agents that may speak unprompted: deferred until there is
a policy for when to speak.
