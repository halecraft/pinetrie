# ADR-0064 — The search tools run programs pine·trie carries into every lane

- **Status:** Accepted
- **Area:** `packages/pi/TECHNICAL.md`, `packages/lanes/TECHNICAL.md`
- **Evidence:** S44, S88
- **Amends:**
  - ADR-0034: the lane runtime carries rg, fd and sd beside jj, and the
    agent's `grep` and `find` tools run them.
  - ADR-0046: every lane of its own is also told to search with the `grep` and
    `find` tools and that rg, fd and sd are on `PATH`; the browser fact is
    `defaultImage`, and its line names python3 too.
- **Amended by:**
  - ADR-0204: the lane runtime also carries pine·trie's bash, one pinned
    version, static against glibc, off `PATH`, as the shell of tool calls.

**Context.** pi's prompt builder adds "Use bash for file operations like ls,
rg, find" whenever the tools it is given name `bash` and none of `grep`,
`find` or `ls` (`buildRules`, pi-coding-agent's `core/system-prompt.js`).
pine·trie gave every lane `read`, `write`, `edit` and `bash`, so every lane was
told to use `rg`, and no lane had it: the default image installed git, curl
and procps, and a project's own `pinetrie.Containerfile` installs what it
likes. Search ran through `bash`, with free-form arguments, output bounded
only by `bash`'s tail, and tool rows labelled by a shell command.

pi-coding-agent has `grep` and `find` tools, but they spawn `rg` and `fd` on
the host with `child_process`, and `grep` reads files back with `node:fs`. In
a lane of its own they would search your Mac.

The lane runtime (ADR-0034, S44) already carries Node and a static jj into
every lane, mounted at `/pinetrie-runtime`, with `bin/` on `PATH`. Static musl
builds of rg, fd and sd exist; Debian's packages link glibc (S88).

**Decision.**
- **The runtime carries rg, fd and sd** beside jj. Core's
  `RUNTIME_PROGRAMS` lists them. The default image downloads pinned static
  release builds; the runtime copies each out (`EXTRACT`, `runtime.ts`), and
  a program missing from the image stops the host at startup.
  `ensureRuntime` keeps a runtime only when it holds every program
  (`runtimeComplete`).
- **pine·trie's own `grep` and `find` tools** (`packages/pi/search.ts`) run rg
  and fd through the tool context's `env`, so they search wherever the lane's
  other tools work. Each call plans its arguments and one shell command
  (`shellWord`, moved to core), runs one `env.exec` that keeps the first
  `limit` lines, and words the outcome. They are among the file tools, so
  they are pi's `selectedTools` too, and pi's rule is gone.
- **Every tool context says where its programs are** (`ToolContext.programs`).
  A lane of its own answers with the runtime's `bin/`, which the host passes
  as `LaneAccess.programs`; a lane that works directly answers with pi's
  `ensureTool`, which finds the host's own or downloads it into pi's bin
  directory, remembered once found. The programs a tool can ask for are a
  type derived from `RUNTIME_PROGRAMS`.
- **The default image carries python3.** It is not carried into other images:
  it is no static binary.
- **What a lane is told.** Every lane of its own is told to search with the
  tools, and that rg, fd and sd are on `PATH` for `bash`; the line is built
  from a table keyed by the runtime's programs. `LaneFacts.browser` becomes
  `defaultImage`, and the default image's line names python3 too. `lane.md`
  says the same.
- **Rows** read `grep <pattern> [path]` and `find <pattern> [path]`
  (`subjectOf`).

**Consequences.**
- The default image's tag changes, so the host builds it once, extracts a new
  runtime, and recreates each lane's container at its next start (the disk is
  untouched).
- A project image's own older rg comes first on `PATH` in `bash`; the tools
  run the runtime's by absolute path.
- A lane that works directly on a host without rg or fd downloads them on its
  first search, into the directory pi's own CLI uses. Offline, or with
  `PI_OFFLINE`, the tool says so and points to `bash`.
- `grep`'s `limit` counts lines of output, context included, where pi's
  counts matches.
- Gitignored directories, a shared `.plans` among them, are searched only
  when named as the tool's `path`.

**Alternatives rejected.**
- A prompt line and apt packages in the default image: pi's rule stays, a
  project's image has none of them, and Debian's builds could not be carried.
- pi-coding-agent's `grep` and `find`: they search the host.
- Replacing pi's whole `rules` section to drop the one rule: pine·trie would own
  every rule pi writes, and miss those a pi upgrade adds.
- Naming a tool the model lacks in `selectedTools`: it drops the rule by
  making the prompt untrue.
- Removing or wrapping the image's `grep` and `sed`: both are Essential in
  Debian, and a wrapper's warning lands in every script's output.
- Gating tools per lane on a probe of the image: carried programs are present
  in every lane, so there is nothing to gate.
- Counting grep's matches exactly with `rg --json`: it needs a parser for
  rg's events, context included, for a limit a line count serves.
