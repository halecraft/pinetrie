# ADR-0090 — One publish button: it catches your files up, accepts your work and moves main, or does nothing; the line is "accepted work"

**Status:** Accepted (Duane, 2026-10-05). Evidence: S111. Implemented by
`PLAN-2026-10-05-publish-button`. Amends ADR-0060 ("land my work" goes:
publishing integrates your commits), ADR-0061 (the project menu and
"update my files" go; the line is "accepted work", not "the project"),
ADR-0076 (the menu's two sections go; on the host's own machine a publish
also catches your files up and integrates your commits) and ADR-0083 (the
page's verb for an offer integration is *accept*; the code's stays
*integrate*).
Amended by ADR-0099: whether a publish catches your files up
and accepts your commits is `offers.catchUp` (default off), not whether the
host admits others; any host shows **set up**.

**Context.** The footer's **◆ project** menu (ADR-0061, ADR-0076) showed
the three places work sits: the line (`pinetrie-onto`), the publish
bookmark (`main`) and your working copy. It offered one action per move
between them: publish, update my files, add my work. Duane read "1 new
commit in the project since you last updated" as something he was being
asked to add. It meant that an accepted offer had moved the line past his
`@`. What he wanted to do was one thing: "move main to the line, then `jj
new` on top of main so my working copy has the latest".

The words were inconsistent too. One move had two names: a thread
*catches up*; your files *update* (`follow` in the code). `follow` named
three things: rebasing your `@`, an offer rebuilt from its lane, and a
scroller staying at its end. The line was "the project", which people read
as `main`.

**Decision.**

- **One button, `publish`, in the footer, and no menu.** It shows only
  when publishing has something to do. Its title says what it will do, in
  words and in jj.
- **On the host's own machine, a publish is three steps, in order:**
  1. your files catch up with accepted work (`jj rebase -b @ -d <onto>`,
     as you), when they are behind;
  2. your commits below `@` are integrated into accepted work, when there
     are any;
  3. `main` moves forward to accepted work.

  Steps 2 and 3 are one `jj bookmark move <onto> <publish> --to @-`, as
  you, which jj carries out whole or not at all (S111). Without commits of
  yours it is `jj bookmark move <publish> --to <onto>`, as the host.
- **On a host that admits others,** a publish is step 3 alone (ADR-0076):
  no one's files move.
- **Nothing is left half done.** What can be checked before the first step
  is (`lineActionState`): your files' conflicts, the catch-up's preview,
  `main` holding commits accepted work lacks. After the catch-up, the line
  is read again; if your commits are now conflicted, or `main` moved
  meanwhile, or the move fails, the catch-up's operation is reverted (`jj
  op revert`, as you; never `op restore`, which deletes edits made since,
  S111).
- **A refusal or failure is a toast** (`role="alert"`), worded once
  (`lineRefusal`, `outcomeWords`). When your files conflict, it offers
  **resolve with the agent**.
- **Before the line exists**, the same button reads **set up**, and opens
  the confirmation that shows the config it writes. A host that admits
  others shows no button until then.
- **Words.** The line is **accepted work** wherever a person or the agent
  reads it; "the project" names no ref. An offer's button is **accept**
  ("accept", "accept stack", "accept anyway", "accept into wip/search",
  "accepted as k1a2b3c4"); its title keeps the jj move. Threads and your
  files both **catch up**. In the code: `LineAction` is `setup | publish`,
  the line record's preview is `yours.catchUp`, an offer rebuilt from its
  lane is the decision `rebuild`, and "follow" means only a scroller's.

**Consequences.**

- A publish integrates every commit of yours below `@`. Work you are not
  ready to publish stays in `@`, or on a `wip/` bookmark.
- There is no button that only catches your files up: publish does it.
  Accepting an offer no longer marks your files as behind anything you are
  asked about.
- The base snapshot is refreshed whenever the owner observes the line's
  bookmark move, so a move made in jj outside pine·trie refreshes it too.
- A line record written before this does not decode, and reads as unknown
  until the host writes it again (ADR-0067, rule 5).
- **Pushing is later work, with an ADR of its own first.** It has to
  decide how commits on `main` made outside pine·trie get into accepted
  work, which a publish refuses today (`not_fast_forward`). Decided
  already (Duane, 2026-10-05): a refused push undoes the publish, so
  nothing is left published but not pushed.

**Alternatives rejected.**

- **A configurable chain of publish steps** (`to`, `push`, update your
  files, publish on every accept). On the host's own machine, catching
  your files up is always wanted. Publishing on every accept would move
  your `@` without your asking, which ADR-0060 removed for takes. That
  leaves pushing, which comes with its own ADR.
- **Keep the menu, reworded.** One intent was spread over three actions in
  two sections, about three refs; rewording keeps the shape.
- **One bookmark: `offers.onto` set to `main`.** Every accept would then
  reach the outside world, and pine·trie would no longer own its line once
  `main` moved outside it.
- **Undo with `jj op restore`.** It deletes an edit made since (S111).
- **Integrate first, then catch up**, so no undo is needed. Your commits
  cannot be integrated before they are above accepted work.
- **"integrate" as the page's verb.** "Integrate into accepted work" reads
  badly; *accept* pairs with *accepted work*.
- **"update", "sync" or "pull" for the move up.** "Update" names no
  direction, and an offer already has an update button; "sync" reads as
  both ways; "pull" means git's fetch and merge.
