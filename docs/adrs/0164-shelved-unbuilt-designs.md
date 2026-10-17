# ADR-0164 — Fold, and sources with relocation, are shelved: decided long ago, never built, and no longer described as coming

- **Status:** Proposed
- **Area:** `docs/01-architecture.md`, `docs/00-vision.md`,
  `docs/glossary.md`, `docs/the-jujutsu-repo.md`
- **Amends:**
  - ADR-0005: lazy, destination-aware summarizing is shelved with fold.
  - ADR-0010: the fold it shapes is shelved. Its finding that a fold without
    its `ours` leg is confidently wrong (S5) is still evidence.
  - ADR-0118: sources are shelved: their registration, their three modes,
    `/sources/<name>`, and accepted work and proposed changes per source. What
    is built of it stays: the session kept outside the project, the extra
    slots, and the folder project.
  - ADR-0119: a lane's record naming its host, the runner, and the check that
    a lane rebuilt from its revisions runs are shelved. One host holds a lane
    at a time and alone writes its thread's end, as built.
  - ADR-0116: a file card names a file of the project, the one source a host
    has, as accepted work holds it.

Each of the two parts below can be accepted or rejected alone. A part
rejected stays decided, and is to be built.

**Context.** ADR-0160 shelved five unbuilt parts of agents talking. Two
more designs are accepted, cited in the living docs as coming, and have
nothing built toward them:

- **Fold** (ADR-0005, ADR-0010), decided in September from S5's ablation:
  an LLM's three-way fold of one branch into another thread's end, as a
  merge entry with a `fromId`. Nothing calls a model to fold, and there is
  no command or button for it. `fromId` exists because pi's own branch
  summaries carry it (`packages/pi/stored-row.ts`). The vision names merge
  as the third and most ambitious capability (`docs/00-vision.md`). Since
  fold was decided, threads, lanes, tasks and the canvas have changed what
  "the branch" and "the destination" are: a thread with a lane of its own,
  its own proposed changes, and its own card.
- **Sources and relocation seams** (ADR-0118, ADR-0119), decided on
  2026-10-08. A host serves one project, the folder its command line names
  (ADR-0086). Later ADRs built pieces that ADR-0118 named: the session
  outside the project (ADR-0149, ADR-0150), a slot for what accepted work
  newly shares (ADR-0141), and a folder that is no repo, branched as a
  folder project (ADR-0142). What makes a source a source is unbuilt:
  registering several folders, choosing a mode per thread,
  `/sources/<name>`, and proposed changes per source. Of ADR-0119, a lane's
  record does not name its host, and no runner exists.

Both still read as "decided, and not built yet" in the vision, the
architecture, the glossary and the jj page. A reader plans around what
will not come unless someone decides it again.

File and media cards (ADR-0116) are also unbuilt, but they are still to
be built, so this ADR leaves them decided. A file card is defined as one
file of a source, so shelving sources changes what it names.

**Decision.**

- **Fold is shelved** (ADR-0005, ADR-0010). Nothing is built toward it.
  The vision keeps merge as an aim, without a design in force. S5's
  findings stand as evidence for whoever takes it up.
- **Sources and relocation are shelved** (ADR-0118, ADR-0119). The host
  serves one project. What is built of either ADR stays, as built.
- **A file card names a file of the project** (ADR-0116), the one source a
  host has. It shows the file as accepted work holds it: a jj project's at
  its accepted bookmark, a folder project's in its folder (ADR-0142),
  updated as accepted work moves. Everything else ADR-0116 says of file
  cards holds.
- **Nothing describes the shelved parts as coming.** The behaviour that
  holds is what is built.
- **Taking one up again** is a new decision, with an ADR of its own.

**Consequences.**

- `docs/00-vision.md`, "Designed for but not built", and its effect merge,
  say fold is shelved. `docs/01-architecture.md`, Fold, keeps the design as
  the shelved one, with its evidence. The paragraph on ADR-0119 is
  restated as what is built.
- `docs/glossary.md`, "Accepted, not yet built", drops source and its
  modes, and runner. File card is restated as one file of the project.
  Media card, party and stack stay. The note on "source" under the words
  that look alike keeps only ADR-0135's meaning.
- `docs/the-jujutsu-repo.md` no longer says the host will serve several
  sources.
- ADR-0163's race rule for two folds into one end stays as decided. It
  applies once fold is built.

**Alternatives rejected.**

- **Leave them accepted until they are built.** Every reader keeps
  planning around two designs that no one is building. ADR-0160 chose the
  same remedy for the same problem.
- **Supersede them.** Nothing overturned them. They wait, and an amendment
  says so (`docs/adrs/README.md`, Amendments).
- **Delete them from the record.** The record is a log (ADR-0136), and
  S5's evidence is the most valuable thing fold left.
- **Shelve fold's vision too.** Merge is still why the conversation is a
  tree. Only its design is shelved.
- **Shelve file cards with sources.** File and media cards are still to
  be built, and a host's one project is enough to show a file from.
