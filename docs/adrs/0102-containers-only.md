# ADR-0102 — Every thread's agent works in a lane of its own: no direct work, and no "your files"

**Status:** Accepted (Duane, 2026-10-07). Evidence: S122–S127 and S132 (lanes
on Linux and in a lane, ADR-0103). Implemented by
`PLAN-2026-10-07-containers-only`. Amends:
- ADR-0032: working directly goes;
- ADR-0034: where its runtime is missing, the host refuses to start, and
  lanes do not work directly;
- ADR-0036: no branch works directly;
- ADR-0040: no direct lane's work strip;
- ADR-0061: the composer's line no longer says what a send does to your
  files, and "resolve with the agent" in your files goes;
- ADR-0086: a host started outside `pnpm host` no longer works directly;
- ADR-0076, ADR-0090 and ADR-0099: their words, not their behaviour: "your
  files" becomes "the working copy".

**Context.** An agent had two places to work: a lane of its own (ADR-0034),
or directly in a directory, by default the host's working copy.
- **Working directly came from ADR-0032,** when lanes were jj workspaces.
  ADR-0034 kept it as a choice in the composer, and as what every lane does
  where Apple's `container` is missing. `PINETRIE_LANES=0` (ADR-0032's
  `PINETRIE_WORKSPACES=0`, renamed) made it the default.
- **It doubles a lane's every path:**
  - a `"direct"` work and project kind through `@pinetrie/core`, `rules`
    and `protocol`;
  - the host's setup, containers and hot reload (held while a direct lane
    runs);
  - pi's tool access;
  - the composer's menu of places to work, a direct work strip, and
    "resolve with the agent", a thread working in your files.
- **The fast suites run their lanes directly** (`containers: false`),
  because a lane could not start lanes (S132). So the path people run is
  the one the suites do not.
- **"Your files" names the host's working copy as if the reader sat at
  it.** On a host a team shares, or one in the cloud, nobody does.
- **What pine·trie is for happens in lanes:** an agent's own copy, offers
  reviewed and accepted, and a publish.

**Decision.**
- **Every thread's agent works in a lane of its own,** on the runtime of
  ADR-0103.
  - There is no direct work: no `"direct"` lane work or project kind, no
    `PINETRIE_LANES`, and no `containers` host option.
  - The composer offers no place to work, only where a thread starts from:
    accepted work or a WIP (`baseChoices`).
- **The host refuses to start without what lanes need:** a jj or git repo,
  and a working lane runtime. It says what is missing and how to get it,
  as `planHost`'s reasons say today for `container`.
  `PINETRIE_TOOLS=0` is unchanged: an agent with no tools needs no lane.
- **The working copy is where the two worlds meet, and it is the
  person's.** They read and change it with their own editor and jj.
  - Lanes read it, read-only, at `/mnt/host-working-copy`.
  - pine·trie changes the repo only through its owner (ADR-0065):
    - accepted work and offers' bookmarks;
    - `main`, on a publish;
    - with `offers.catchUp` on (ADR-0099), a publish's catch-up of the
      working copy.
  - Shared directories (ADR-0035) are the one way a lane writes the host's
    files, each chosen by name.
- **"Your files" goes,** from the page, what the agent is told, the docs and
  the code. Where the host's working copy must be named, it is "the working
  copy" (`/mnt/host-working-copy` in a lane). The work's own words are
  ADR-0100's.
- **Every suite runs real lanes.** No scenario starts a host without them;
  ADR-0103 lets a lane run lanes, so the suites run in lanes too.

**Consequences.**
- **What goes:**
  - the direct kinds in `@pinetrie/core`, `rules`, `protocol` and the
    layout schema;
  - the host's `PINETRIE_LANES`, `containers` option and direct project;
  - hot reload's holding of updates under a direct lane's directory;
  - pi's direct tool access;
  - the composer's work menu, the direct work strip, the publish toast's
    "resolve with the agent", and `scripts/migrate-pineta.ts`'s direct
    case.

  A lane recorded with direct work needs a store migration (ADR-0096).
- **pine·trie no longer resolves conflicts in the working copy:** they are
  the person's, in jj. A publish whose catch-up would conflict is still
  refused before its first step (ADR-0090).
- **A host without a lane runtime does not start.** Until ADR-0103 is
  built, on the Mac that runtime is Apple's `container` (ADR-0034).
- **The fast suites start real lanes,** and pay for them: a lane starts in
  77–113 ms and the VM in about a second (S126, S127). What the suites
  take in all is not measured.
- **To change the working copy, an agent's work goes through an offer:** it
  is accepted, then published with `offers.catchUp` on, or brought in by
  the person with jj.

**Alternatives rejected.**
- **Keep working directly for people without a runtime.** It keeps two of
  everything, and the one the suites do not run.
- **Keep it for the suites only,** as a lane runtime for tests. The suites
  would prove a path nobody runs.
- **Rename "your files" to "the host's files".** It still names a place no
  reader sits; the working copy is the thing itself.
