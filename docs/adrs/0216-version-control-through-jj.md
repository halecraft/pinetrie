# ADR-0216 — Version control is served through jj, and jj is needed only where there is version control: a git repo is made colocated, a folder under neither runs with no jj

- **Status:** Accepted (Duane, 2026-10-26)
- **Area:** `docs/01-architecture.md`, `packages/lanes/TECHNICAL.md`,
  `packages/jj/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Evidence:** S348, S36, S41
- **Amends:**
  - ADR-0142: a git repo with no jj is no longer a folder project; it is made
    colocated at the start and served as a jj project. A folder under no
    version control is a folder project with no jj installed.
  - ADR-0150: pine·trie writes one thing in your folder besides the exclude
    file's lines: a git repo's `.jj`, made once.
  - ADR-0102: a host with tools refuses a folder under jj or git while jj or
    git does not run, naming which.

**Context.**

- **A host with no jj did not start** (S348 item 1): the default lane
  image's jj was pinned to the host's (`hostJjVersion`), which threw. Past
  that, a folder project needed no jj on the host (item 2), and `serve`
  reached `listening` (item 4).
- **A jj repo with no jj was read as a folder** (item 3): any failure of
  `jj workspace root`, its absence among them, read as "no jj repo". jj
  says "no repo" as exit 1 with its own message, and a config error is
  exit 1 too (item 7).
- **Only jj says where a workspace is** (S36, S41): a copied
  `.jj/working_copy` claims its parent's workspace, so no code of ours
  finds a root by looking for `.jj`.
- **`jj git init --colocate` leaves a git user's repo as it was** (item 5):
  branch, index, edits and `git status`; a later `git commit` is imported.
  In a git worktree jj refuses, in its own words (item 6).
- **Duane:** pine·trie serves version control through jj, so a git repo
  is made colocated, and a folder with `.jj` or `.git` is refused while jj
  is missing.

**Decision.**

- **The project's facts** (`RootFacts`): whether jj runs and its version,
  jj's answer from the folder (a root, no repo, or a failure with its
  first line, `jjRootAnswer`), whether git runs, git's top level when jj
  names no root, whether a git directory is found from jj's root, and,
  only when jj or git does not run, the nearest `.jj` or `.git`, which
  says only that version control is there.
- **The plan** (`planProjectDir`, pure), with tools on:
  - jj does not run and a `.jj` or `.git` is found: refused, `jj-missing`;
  - jj fails in any other way than "no repo": refused, `jj-failed`, in its
    words;
  - a jj workspace or a git repo, and git does not run: `git-missing`;
  - a jj workspace: a jj project (a git directory beside it, or
    `not-colocated` as before);
  - a git repo with no jj workspace: a jj project once made colocated
    (`colocate`);
  - any other folder: a folder project, said so when jj does not run
    (`jjMissing`).

  Without tools it decides the root alone: nothing is refused for jj or
  git, and nothing is made colocated.
- **`startHost` carries it out** (`settleProjectDir`), before the
  project's adapter is chosen: `jj git init --colocate` at git's top
  level, said in one line (`projectPlanLine`), or refused in jj's words,
  `colocate-failed` (a git worktree). `server.ts` takes only the root.
- **The lanes' jj is the host's, else `DEFAULT_LANE_JJ_VERSION`**
  (`laneJjVersion`).

**Consequences.**

- pine·trie installs and serves a plain folder with Node alone, on Linux
  with Docker or on the Mac with the lane VM's own needs.
- Serving a git repo the first time adds `.jj` beside its `.git`. jj
  ignores it for git, so `git status` does not show it.
- A folder project from before this on a git repo has folder lanes, which
  the jj project it becomes refuses (ADR-0150's foreign lane).
- jj's "no repo" message is read as text, against `lanes/run.ts`'s rule;
  should jj reword it, a folder in no repo is refused in jj's words, never
  misread.

**Alternatives rejected.**

- **Looking for `.jj` and `.git` ourselves to find the root:** wrong from
  inside a copied workspace (S41); the look is used only to refuse.
- **Refusing a git repo with no jj, and telling you to colocate it:** one
  more step before a first run, which jj does safely (S348 item 5).
- **A start step of its own for the machine's prerequisites:** the VM's and
  Docker's checks already run only when needed, at the first step, and on
  the Mac Docker answers only through the VM's lease; the new needs, jj
  and git, are the project's, refused where the project is planned.
