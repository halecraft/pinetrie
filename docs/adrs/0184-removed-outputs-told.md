# ADR-0184 — Getting the latest tells the agent what it removed, why, and the last command seen writing there, as a hint

- **Status:** Accepted (Duane, 2026-10-19)
- **Area:** `apps/pinetrie/host/TECHNICAL.md`, `packages/rules/TECHNICAL.md`
- **Amends:**
  - ADR-0135: the stale outputs removed on getting the latest are told to the
    agent in the update message's text: each removal's paths, the input that
    changed, and the last command seen writing there, worded as a hint.

**Context.**

- **Getting the latest removes outputs and says nothing.** After an update's
  merge, `removeStaleOutputs` deletes each output whose recipe's key broke
  (ADR-0135) and returns nothing. The agent learns of it from the lane's
  guidelines, which say in general that getting the latest removes what was made
  from files that changed, or from a command that fails. Duane saw an agent
  find `node_modules` gone and guess at the reinstall.
- **In pine·trie's own repo, getting the latest almost always removes `node_modules`.**
  One `pnpm install` reads the lockfile, `pnpm-workspace.yaml` and every
  package's `package.json`, and its recipe holds the root `node_modules`
  and every package's. A change to any of them breaks the one key.
- **The registry already knows what to say.** For each broken recipe, the
  check names the first input whose fact changed (`RecipeCheck.broken`),
  or the recipe was made on another image; the plan knows its outputs to
  remove; and the recipe keeps its command (`RecipeKey.command`).
- **That command is not certainly the one that made the output.**
  - A run is one shell tool call, and its command is the call's whole
    text: `pnpm install --frozen-lockfile && pnpm test` is one command.
    The observer tags each process with its run and reports file calls by
    process, but reports no `exec`, arguments or parent, so no step of a
    compound command can be named.
  - A newer recipe takes an older one's outputs (`nextRegistry`), so the
    command kept is the last tool call that wrote under the output, not
    the first to make it: after `pnpm add -D foo` or `pnpm install
    --filter web`, that is the command kept for `node_modules`.

**Decision.**

- **The plan says what each removal was.** `planStaleOutputs` returns,
  beside the paths to delete, one removal for each broken recipe that
  deletes something: its paths, its cause (the input that changed, or the
  image), and its command. Outputs kept as caches, or still held by a
  recipe whose key holds, are in no removal. `removeStaleOutputs` returns
  the removals once the paths are deleted.
- **The update message's text carries them.** Getting the latest passes
  its merge's removals to its settling. A clean merge's update message
  ends with them; a conflicted merge's land message has them just before
  what the person asked, which stays last. So `catch_up`'s answer says
  it, and so does the prompt when you get the latest for the thread. Only
  `content` changes: `details` keep their shape, since nothing reads the
  removals back, and a stored message keeps decoding.
- **A conflicted merge's prompt still always fits.** Its floor is measured
  before the merge, when the removals are not yet known. The removals'
  text is cut at a fixed length, and the floor reserves room for that
  length, so the smallest prompt keeps the removals. That smallest prompt
  is measured with them, and were it ever over, the floor's own message,
  already measured, is sent instead: the fit never rests on the estimate
  growing with length.
- **Words state what pine·trie saw, never what to run.** One function words
  the removals (`packages/rules`), one item each, and one closing line:

  > What getting the latest removed:
  > - `pnpm-lock.yaml` changed, so what was made from it went:
  >   `node_modules`, `packages/core/node_modules`, `packages/jj/node_modules`
  >   and 12 more. The last command seen writing there was
  >   `pnpm install --frozen-lockfile && pnpm test`.
  >
  > A command named here is a hint, not necessarily the one to run: make
  > what went again as you would after a pull.

  - The cause names the path the check gave, or says the lane's image
    changed, or that pine·trie could not check what it was made from.
  - At most three removals are worded, and a count of the rest. The
    whole text is cut at a fixed length.
  - At most three paths are named each, topmost first, and a count of the
    rest; a path or a cause's path past 120 characters is cut with `…`.
  - The command is shown as recorded, on one line: newlines are shown as
    `⏎`, and past 200 characters it is cut with `…`.
  - A run the host learnt of only from its events has no command; its
    removal says no command was seen.
- **The registry gains nothing.** No first maker is kept: "the last
  command seen writing there" is true of the command the recipe holds.

**Consequences.**

- An agent that gets the latest is told what to make again, why, and a likely
  command, before a check fails.
- The command can be wrong to run as it stands: a compound command runs
  its other steps again, and the last writer may be a `pnpm add` or a
  filtered install. The words say so, and the agent judges.
- Removals at a container's start (another image) are not told: no
  message carries them, and the guidelines' general line still holds.
- The column's one line for an update is unchanged; its text, which the
  person can open, holds the removals.
- An observer that reports each `exec` with its arguments, parent and
  working directory could later name the step that wrote an output, and
  only the command in the words would change.

**Alternatives rejected.**

- **Saying "made by" the command.** A newer recipe takes an older one's
  outputs, so it can name a `pnpm add` as the maker of `node_modules`.
- **Keeping each root's first maker in the registry** to name it instead.
  It is new stored state, and the first maker is not more certainly the
  command to run: a first install may have been `pnpm install --filter`.
  The last writer, called a hint, is true as it stands.
- **The removals in `details` as well.** Nothing reads them back, and a
  shape change stops older update messages decoding (`packages/rules/TECHNICAL.md`,
  "History messages").
- **Running the recorded command after getting the latest.** pine·trie runs no
  project command (ADR-0135), and a recorded command may run tests or
  worse.
- **Naming the step of a compound command now.** The observer reports no
  `exec`; that needs a spike of its own, and the hint is useful without it.
