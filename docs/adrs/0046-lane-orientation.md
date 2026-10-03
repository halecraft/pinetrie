# ADR-0046 — A lane's agent is told where it is: a short block in every prompt, and a note it reads when it needs it

**Status:** Accepted. Implementation: `PLAN-2026-09-30-lane-orientation`.
Amends ADR-0034 (what a lane's prompt says; the port proxy it describes is
not built).
**Amended by ADR-0064:** every lane of its own is also told to search with
the `grep` and `find` tools and that rg, fd and sd are on `PATH`; the
browser fact is `defaultImage`, and its line names python3 too.

**Context.** An agent in a lane of its own (ADR-0034) was told two things: its
copy is at `/workspace`, and your working copy is at `/mnt/host-working-copy`,
read-only; and each shared directory is shared and never branched
(ADR-0035). The rest it found by trying. One agent saw `jj st` empty after
its edits and worked out only later that Pineta commits each turn
(ADR-0032). Another tried to run `container`, which a lane lacks.

Several facts hold in every lane, whatever the project, and cost an agent
effort to rediscover:
- Pineta commits each turn, and the offer and branches follow its commits
  (ADR-0032, ADR-0038).
- The container stops when a run ends, so background processes end with it.
  Only `/workspace` is snapshotted and cloned into branches.
- `/pineta` is Pineta's install, read-only. It looks like a Pineta checkout,
  and is not the project.
- A lane has no container runtime, no model key and no credentials, unless
  `pineta.json` grants them. It reaches the internet, and not your loopback.

A provider can rebuild the prompt by its section tags. Through
`pi-anthropic-auth`, a lane's agent receives pi's `<rules>` intact, while pi's
preamble and `<tools>` are replaced and `<docs>` is dropped (S23, addendum).

**Decision.**
- **A lane of its own gets a block of guidelines** in pi's `<rules>`, built
  by `laneGuidelines` (`packages/pi/lanes.ts`) from the lane's facts. It says,
  in about 200 tokens:
  - that it is a Pineta lane, as root, in its own jj repo;
  - that Pineta commits after each message, so the agent need not commit,
    and how to list its work;
  - that the person gets one commit, the offer, named by its bookmark, and
    never sees the files live;
  - that only `/workspace` lasts, and background processes end with a run;
  - where the person's working copy and Pineta's install are;
  - each shared directory;
  - that it has no container runtime, model keys or credentials, with the
    project's grants named; the internet works and your localhost does not;
  - whether its image has a browser;
  - where the note is.
- **The note** is `packages/pi/lane.md`, read in the lane at
  `/pineta/packages/pi/lane.md` (`LANE_NOTE`). It says the same at length:
  paths, turn revisions, the offer, what lasts, the image, the network,
  people and updates, and what to do when the lane cannot do something. It
  is versioned with the Pineta that runs the lane. Each fact names its
  source as an HTML comment, a path and a symbol, and a test fails when one
  no longer exists.
- **Only what holds in every lane.** A project's own facts, such as which of
  its checks need `container`, belong in its `AGENTS.md`. Only measured facts:
  whether your machine reaches a server at a lane's IP is not in either.
- **The host fills in each lane's values** in `access`: the offer's
  bookmark, shared directories, grants, whether the image has a browser (the
  project has no `pineta.Containerfile`), Pineta's mount and the note's
  path. `packages/pi` builds no name itself: their rules are in
  `@pineta/lanes`, which it does not declare. Every value is fixed
  while the host runs, so the prompt is the same on every request of a run.
- **A thread that works directly is told none of it.**

**Consequences.**
- Every request of a lane of its own carries about 230 tokens more than
  before. Directly-working threads and conversations are unchanged.
- A change to Pineta that makes a line of the block or the note false must
  change it. The note's source comments point at the code, and a renamed or
  removed symbol fails `packages/pi/lanes.test.ts`.
- A change to the block reaches lanes at the host's next start.
- An agent that commits anyway loses nothing: its commit is the turn's
  revision (ADR-0032, amended by S56). Rewriting earlier revisions
  (`squash`, `rebase`, `abandon`) is still unsafe, and the note says so.

**Alternatives rejected.**
- Everything in the prompt: about 1,000 tokens on every request, for facts
  most turns do not need.
- Only a pointer to the note: an agent reads a note when it suspects it
  needs to, and the failures seen came from not suspecting.
- A section of its own (`buildSystemPrompt`'s `sections`, or
  `appendSystemPrompt`): a provider that rebuilds the prompt by its tags may
  drop a section it does not know, as `pi-anthropic-auth` drops `<docs>`.
- The note as one of Pineta's own skills (`packages/pi/skills/`): it would be
  listed in every thread, working directly or in a conversation, where it is
  false; and a listed skill is read only when the agent suspects it needs it.
- Project facts in the same block: they belong to the project.
