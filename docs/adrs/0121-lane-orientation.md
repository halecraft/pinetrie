# ADR-0121 — A lane's agent is told where it is: a short block in every prompt, and a note it reads when it needs it

- **Status:** Accepted (Duane, 2026-10-08)
- **Area:** `packages/lanes/TECHNICAL.md`, `packages/pi/TECHNICAL.md`
- **Evidence:** S23, S56
- **Supersedes:**
  - ADR-0046: restated whole, with what ADR-0048, ADR-0064 and ADR-0103
    changed in it folded in.
- **Amended by:**
  - ADR-0116: a lane is told its task's canvas.
  - ADR-0118: a lane is told its sources.

Restates ADR-0046 as amended by ADR-0048, ADR-0064 and ADR-0103; decides
nothing new. ADR-0046's change to ADR-0034 stands as ADR-0046 made it. Since
ADR-0102 every thread's agent works in a lane of its own, so ADR-0046's
"a thread that works directly" is now an agent with no tools.

**Context.** An agent in a lane of its own (ADR-0034) was told two things: its
copy is at `/workspace`, and your working copy is at `/mnt/host-working-copy`,
read-only; and each shared directory is shared and never branched
(ADR-0035). The rest it found by trying. One agent saw `jj st` empty after
its edits and worked out only later that pine·trie commits each turn
(ADR-0032). Another tried to run `container`, which a lane lacks.

Several facts hold in every lane, whatever the project, and cost an agent
effort to rediscover:
- pine·trie commits each turn, and the offer and branches follow its commits
  (ADR-0032, ADR-0038).
- The container stops when a run ends, so background processes end with it.
  Only `/workspace` is snapshotted and cloned into branches.
- `/pinetrie` is pine·trie's install, read-only. It looks like a pine·trie
  checkout, and is not the project.
- A lane has no container runtime, no model key and no credentials, unless
  `pinetrie.json` grants them. It reaches the internet, and not your loopback.

A provider can rebuild the prompt by its section tags. Through
`pi-anthropic-auth`, a lane's agent receives pi's `<rules>` intact, while pi's
preamble and `<tools>` are replaced and `<docs>` is dropped (S23, addendum).

**Decision.**
- **Every agent thread's `<rules>` opens with one fixed line** (ADR-0048):
  the team pins cards to say what it wants from the thread, they appear in
  `<pinned-cards>` blocks, and the latest block holds. It is constant, so a
  lane's prompt stays the same between runs.
- **A lane of its own gets a block of guidelines** in pi's `<rules>`, built
  by `laneGuidelines` (`packages/pi/lanes.ts`) from the lane's facts. It says,
  in about 250 tokens:
  - that it is a pine·trie lane, as root, in its own jj repo;
  - that pine·trie commits after each message, so the agent need not commit,
    and how to list its work;
  - that the person gets one commit, the offer, and never sees the files
    live;
  - that only `/workspace` lasts, and background processes end with a run;
  - where the person's working copy and pine·trie's install are;
  - each shared directory;
  - that it has no container runtime, model keys or credentials, with the
    project's grants named; the internet works and your localhost does not;
  - to search with the `grep` and `find` tools, and that rg, fd and sd are
    on `PATH` (ADR-0064);
  - whether its image is the default one (`defaultImage`), with a browser
    and python3 (ADR-0064);
  - where the note is.
- **The note** is `packages/pi/lane.md`, read in the lane at
  `/pinetrie/packages/pi/lane.md` (`LANE_NOTE`). It says the same at length:
  paths, turn revisions, the offer, what lasts, the image, the network,
  people and updates, and what to do when the lane cannot do something. A
  lane's servers are reached from the Mac through ports published on the
  lane VM's address (ADR-0103). It is versioned with the pine·trie that runs
  the lane. Each fact names its source as an HTML comment, a path and a
  symbol, and a test fails when one no longer exists.
- **Only what holds in every lane.** A project's own facts, such as which of
  its checks need a container runtime, belong in its `AGENTS.md`. Only
  measured facts.
- **The host fills in each lane's values** in `access`: the offer's
  bookmark, shared directories, grants, whether the image is the default
  (the project has no `pinetrie.Containerfile`), pine·trie's mount and the
  note's path. `packages/pi` builds no name itself: their rules are in
  `@pinetrie/lanes`, which it does not declare. Every value is fixed while
  the host runs, so the prompt is the same on every request of a run.
- **An agent with no lane of its own (tools off) is told none of it.**

**Consequences.**
- Every request of a lane of its own carries about 250 tokens more than
  without the block. Conversations are unchanged.
- A change to pine·trie that makes a line of the block or the note false must
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
- The note as one of pine·trie's own skills (`packages/pi/skills/`): it would
  be listed in every thread, a conversation included, where it is false;
  and a listed skill is read only when the agent suspects it needs it.
- Project facts in the same block: they belong to the project.
