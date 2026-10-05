# ADR-0092 — pi is three things to the host: the scribe, the person's pi setup, and the agent

**Status:** Proposed. Evidence: S113. Implemented by
`PLAN-2026-10-05-pi-in-three`. Amends ADR-0062 (the scribe carries the
host's writes, not the agent) and ADR-0063 (a root is released through the
scribe, which closes the agent's harness over it). Sits beside ADR-0003:
no pi type crosses `packages/pi/index.ts`.

**Context.** `Agent` (`packages/pi/agent.ts`) was the host's one door into
pi, and it did three jobs that need different things:

| job | its members | it needs |
|---|---|---|
| carry the host's writes into the documents | `writeValues`, `appendToTree`, `release` | the documents, a replica id, the image store |
| the person's pi setup, loaded | `complete`, `skill`, `commands`, `refusedCommands`, `expand`, `canDrawBanners`, `drawBanner`, `agentDir`, the model's label, where it came from, whether the title model was found | the model choice, the project's root, the agent directory, the user config |
| the agent at work in threads' lanes | `createThreadLane`, `lane`, `interrupted`, `close` | both of the above, lane work's `access` and `hooks`, `set_banner`'s asks, `onStream` |

Only the third needs the host, since pi's tools call lane work. But
`createAgent` made all three at once, so `startHost` made lane work,
banners, digests, titles, names and base news before the agent, and they
read it through `theAgent()`, which threw until it existed. Most of them
only wrote records or asked the model something. A module's signature said
`() => Agent` where it meant "I write records", and the order of
construction was explained in comments rather than held by the types. A
write to the session document built a whole harness over it, whose only
work was to carry the write.

S113 measured what a split needs:

- A session written to before any harness exists, and a harness made over
  it later, work: a lane is made at an entry written with no lane, and it
  runs.
- The writes and the harness must share **one session per document**. Two
  over one document drift apart: `KynetaStorage` indexes its own commits
  and reconciles only `replay` changes, so neither sees the other's.
- **A harness closes the session it was given**, and both closes are
  idempotent.
- Making a harness writes nothing, and costs about 0.06 to 0.3 ms: the
  split is for the coupling, not the cost.
- The setup needs only the project's root, which `prepareHost` finds
  without the agent or a document.

**Decision.**

- **`@pinetrie/pi` gives the host three facades, made in this order**, each
  from what exists by then:
  - **`Scribe`** (`createScribe`): `writeValues`, `appendToTree`,
    `release(root)`, `close()`. It holds one pi session per document.
  - **`PiSetup`** (`loadPiSetup`): the model's one-off requests, banners,
    commands and skills, the agent directory, and the model's labels. It
    reads no document.
  - **`Agent`** (`createAgent({ scribe, setup, … })`): `createThreadLane`,
    `lane`, `interrupted`, `close`. It is made last, with lane work's
    `access` and `hooks`.
- **The agent's harness over a document is made over the scribe's session
  for it**, never one of its own (S113). The scribe holds, beside each
  document's session, what was built over it: the agent asks the scribe to
  build its harness, and keeps no map of its own. The session document has
  no harness.
- **The scribe owns every session's end.** `release(root)` forgets the
  root's entry, closes what was built over its session (the harness), then
  closes the session, which also ends a root written to and never run. The
  host releases a root only through the scribe.
- **What crosses is ours.** `createAgent` reaches the scribe's sessions and
  the setup's raw model setup through module-private maps keyed by the
  facades. A facade `createScribe` or `loadPiSetup` did not make cannot
  build an agent.
- **The host makes them in order, and passes values.** A host module takes
  `Pick<Scribe, …>`, `Pick<PiSetup, …>` or `Pick<Agent, …>`, never a
  function that returns one. What genuinely recurses, an agent's tool call
  that leads the host to a lane, is said where it happens: a caller that
  holds the agent passes the lane's handle, and lane work announces a base
  change to a listener that joins once the agent exists. `split_offer`'s
  card needs no drain of its own: it is queued during its run, so the
  run's end drains it.
- **The names.** The agent at work in threads' lanes is what the product
  calls the agent (`THE_AGENT`), so `Agent` keeps its name and loses what
  is not the agent. The scribe writes what the host decided and decides
  nothing, beside the documents' keeper, which orders the steps. "The
  person's pi setup" is the docs' phrase for what pi loads from the agent
  directory and the project, and the `Pi` prefix keeps it from lane work's
  `Setup`.

**Consequences.**

- `startHost` has no lazy agent. Titles, digests, banners, names, the
  directory, provenance, lane work and the offers are made with values,
  and the directory starts before lane work.
- A module's signature says which of the three it uses. `commands/chat.ts`
  and `startup.ts` take all three: they write, read commands, and create or
  resume lanes.
- A root's harness is made at the first lane call in it, not at its first
  write.
- Shutdown gains a `scribe` step after `agent`: the agent's close ends the
  runs, the scribe's the sessions, so a write after it is refused for every
  document, the session's included.
- Host tests fake one facade's few members. pi's own tests make the three
  in order through one helper.
- An agent is never made without a scribe and a setup, so a test that
  wants only writes or a completion no longer builds a harness.

**Alternatives rejected.**

- **Keep `Agent`, narrowed with `Pick` behind a lazy getter.** The getter
  was lazy because one object did three jobs. Narrowing its type does not
  change when it exists.
- **Put `writeValues` on `Basics`.** It would hide which modules write, and
  `Basics` would need the scribe, which needs the documents `Basics` holds.
- **A scribe with sessions of its own, apart from the harnesses'.** They
  drift apart (S113), and a lane cannot be made at an entry the other
  session wrote.
- **The agent owns release.** A root released before the agent exists, or
  written to and never run, would then depend on the host joining
  listeners in the right order. The scribe holds every session, so it ends
  them.
- **Lane work's hooks given per run, so the agent could be made first.** pi
  registers tools, and their hooks, as it makes a harness. Per-run hooks
  would have `runs.ts` hand lane work's internals to every run.
- **Other names.** `Sessions`: "session" is the session document,
  `@pinetrie/session` and `SessionClient` in about 950 places, and pi's
  word. `Lanes` and `Harnesses`: our lanes package, and pi's word.
  `Models`: the setup holds commands, skills and the agent directory too,
  and `model` already means the model chosen. `Recorder`, `Writer`,
  `Ledger`: a lane's turn is recorded, a writer is a person, and the
  ledger is the offers'.
