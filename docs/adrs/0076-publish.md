# ADR-0076 — The project is published to main; the project menu says only what applies where the host runs

**Status:** Accepted (Duane, 2026-10-05). Implemented by
`PLAN-2026-10-05-project-publish`. Amends ADR-0060 (a second bookmark the
host moves: the publish bookmark, forward only, never your `@`), ADR-0061
(the project menu's two sections, and its words) and ADR-0069 (the
project's mark counts unpublished commits, not your files being behind).

**Context.** The header's **◆ project** menu (ADR-0061) had grown confusing
(Duane, 2026-10-04):

- Its heading said "The project", but every line and its one action were
  about your files: "the project has 3 commits your files don't", "update
  my files".
- That sentence read backwards, in jj's terms.
- A note listed the paths updating would change, "116 files: a, b, c and
  113 more", which said nothing useful and made the menu as wide as the page.
- Its action looked like another note, and did not say your work stays on
  top.
- ↓ on its trigger meant "your files are behind"; on a column's header it
  means "the thread's base has new work" (ADR-0061, ADR-0073).

And "your files" means nothing on a host a team shares (`PINETRIE_BIND`,
ADR-0022): `LineRecord.commands` is false there, so the menu showed the
host machine's `@`, which no reader has, and offered nothing.

The project's own state was missing: whether what is on the line has
reached `main`, the branch everyone else builds from.

**Decision.**

- **Publishing moves the publish bookmark forward to the line.** It is
  `offers.publish` (default `main`), configured as `offers.onto` is. The
  host moves it as itself (`moveForward`, never `--allow-backwards`), since
  it changes no file. It does not push.
- **Anyone admitted may publish**, on a team host too: it moves a bookmark
  forward to work already on the line. Setting up, landing and updating
  your files stay with the host's own machine (`HOST_ONLY`).
- **It is a fast-forward or nothing.** `LineRecord.published` carries the
  bookmark's commit and, as each WIP does, `behind` (line commits it lacks:
  the unpublished count) and `ahead` (its commits the line lacks).
  Publishing is refused, saying why, with no line, no bookmark, nothing
  unpublished, or `ahead > 0` ("main has 2 commits the project doesn't:
  bring them into the project first").
- **One rule decides what may run** (`lineActionState`, `@pinetrie/rules`): the
  host's `planLineAction` and the page's `lineView` both read it, and
  `lineRefusal` words its refusals for both.
- **The menu has two sections.** *The project*, on every host: how many
  commits are not yet on main, and **publish to main (N commits)**. *Your
  files*, only on the host's own machine: one line on where your files
  stand ("3 new commits in the project since you last updated"), what would
  conflict, and **update my files** (its title: how many files it changes,
  that your work stays on top, and the jj command that shows the diff),
  **add my work to the project**, **resolve with the agent**.
- **No file lists in the menu**, except the files that would conflict, at
  most three named. The record carries how many files updating changes,
  not their paths.
- **The trigger counts unpublished commits**: "◆ project · 2 unpublished".
  Your files being behind no longer marks it, so ↓ keeps one meaning.
- **A move of the publish bookmark outside pine·trie refreshes the line's
  record alone** (`Moved.line`): no offer depends on it.

**Consequences.**

- A record written before this decodes as unknown until the host writes it
  again (ADR-0067, rule 5): the project menu is empty for a moment after an
  upgrade.
- With `main` moved outside pine·trie, the project cannot be published until
  main's commits are brought into the line, by hand for now.
- The line's facts read three more jj processes per operation (the
  bookmark's commit and its two counts).

**Alternatives rejected.**

- **Push on publish.** It needs a remote, credentials and a story for a
  refused push. Configurable pushing is later work.
- **Open a pull request.** For teams that cannot push to main; later.
- **One section, hiding the lines about your files on a team host.** The
  heading would still be wrong on your own machine, where they are most of
  the menu.
- **List the files updating changes.** A list belongs in the review pane
  (ADR-0047); showing this range there is later work.
- **"Ready to merge".** A take and a publish are bookmark moves, not merges
  in jj's sense.
