# ADR-0099 — Config decides what the host does, not where it listens: `offers.catchUp`, and setup on any host

- **Status:** Accepted (Duane, 2026-10-07)
- **Area:** `docs/the-jujutsu-repo.md`, `packages/rules/TECHNICAL.md`
- **Amends:**
  - ADR-0060: As built: `line` commands are anyone's, with no `not_yours`.
  - ADR-0076: a publish moves `main` alone when `offers.catchUp` is off, on
    any host, not because the host admits others.
  - ADR-0090: whether a publish catches your files up and accepts your commits
    is `offers.catchUp` (default off), not whether the host admits others; any
    host shows **set up**.
- **Amended by:**
  - ADR-0100: `offers.catchUp` is `publish.catchUp`, and `publishCatchesUp` in
    code.
  - ADR-0102: "your files" is "the working copy".

**Context.** ADR-0090 made a publish three steps on the host's own machine
(your files catch up, your commits below `@` are accepted, `main` moves)
and one step on a host that admits others (`main` moves). Setting up the
line was refused outright on a host that admits others (`not_yours`), and
the page showed no button there. Which kind of host it is came from
`PINETRIE_BIND`: off loopback, the host makes an invite key, and
`LineRecord.commands` is false (`lineCommands: key === null`,
`apps/pinetrie/host/index.ts`).

The inference stood in for a fact the host lacks: Kyneta does not say
which connection a seat came over (ADR-0060, "As built"), so the host
cannot tell the owner's click from a guest's. It protected nothing that
matters: anyone with the invite link already gets an agent that runs
commands on the host's machine as its owner, and identity is not
authenticated (`docs/pinetrie.md`). What it did do was make a daily
button's behaviour depend on a variable nobody sees in the page. Duane
expected publish to rebase his `@` onto accepted work, and thought that was
a setting. It was not: off loopback, publish stops moving your files for
everyone, the owner at the host's own keyboard included.

**Decision.**

- **What the host does is decided by config:** the user's
  `$XDG_CONFIG_HOME/pinetrie/config.json` and the project's
  `pinetrie.json`, the project's winning. Never by the address the host
  binds, and never by whether it admits others. The bind and the invite
  key decide who gets in (ADR-0022, ADR-0042), and nothing past that.
- **`offers.catchUp`, a boolean, decides whether a publish moves your
  files.** On, a publish is ADR-0090's three steps: your files catch up
  (`jj rebase -b @ -d <onto>`, as you) when they are behind, your commits
  below `@` are accepted, and `main` moves, the last two in one `jj
  bookmark move <onto> <publish> --to @-`. Off, a publish moves `main`
  alone (`jj bookmark move <publish> --to <onto>`, as the host), and no
  one's files move.
- **Default off.** Moving your files and accepting your commits is an
  option you turn on. It is read where the other `offers` keys are
  (`lineConfig`); a value that is not a boolean is refused, with why, and
  the default holds.
- **Anyone admitted may set up the line, on any host.** The button reads
  **set up** wherever the line does not exist yet, and its confirmation
  shows what it writes: the bookmark at your `@-`, and the exact
  `immutable_heads()` and `revsets.log` text for your repo's config.
  `not_yours` goes.
- **`LineRecord.commands` goes.** The record carries `catchUp`, the
  setting's value, and `publishWork`, `lineActionState`, `lineRefusal` and
  `publishView` read it. Nothing in `@pinetrie/rules`, `@pinetrie/interface`
  or the host's work reads the invite key.
- **The button's title says which publish it is.** Off, it says your files
  do not move and names the setting (`offers.catchUp`), so the reason is
  on the page, in one wording function with the rest of the title.

**Consequences.**

- On the host's own machine, where publishing used to catch your files up
  with no config, it now moves only `main` until you turn
  `offers.catchUp` on.
- On a host a team shares, an owner who turns the setting on accepts that
  a guest's publish moves the owner's `@` and accepts the owner's commits
  below it. A guest may set up the line, writing the owner's jj config.
  Both are what the invite link already allows an agent to do.
- A line record written before this does not decode, and reads as unknown
  until the host writes it again (ADR-0067, rule 5).
- The startup warning that anyone with the invite link can run commands as
  you stays: it says what admission grants, and decides nothing.
- `docs/the-jujutsu-repo.md`, `docs/06-interface.md` and the host's
  `TECHNICAL.md` describe publish and setup by config, not by the kind of
  host.

**Alternatives rejected.**

- **Keep the inference from the bind.** It decided a daily button's
  behaviour by a variable nobody sees in the page, and protected nothing
  the invite link does not already grant.
- **Publish always does all three steps.** One behaviour, but no way to
  publish without moving your files.
- **Only the owner may publish or set up, recognized per connection** (a
  loopback socket, or an owner key apart from the invite key). It needs
  Kyneta to carry a connection's fact to its seat, which is unproven, and
  identity is not authenticated anyway.
- **Default on**, keeping what a host on loopback did before. The setting
  is an option, so it starts off.
- **Setup by hand in jj only, with no button.** No bind dependence either,
  but it drops a confirmation that shows exactly what is written.
- **ADR-0090's objection to "a configurable chain of publish steps".** It
  rejected configuring pushing, the steps' order and publishing on every
  accept. This is one switch between the two publishes ADR-0090 already
  has, made explicit instead of inferred.
