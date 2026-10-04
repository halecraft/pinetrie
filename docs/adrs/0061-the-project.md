# ADR-0061 — The integration line is "the project"; work moves between places, and archiving withdraws offers

**Status:** Accepted (Duane, 2026-10-03). Evidence: S80. Implemented by
`PLAN-2026-10-03-jj-ux`. Amends ADR-0060 (its
words; and "Pineta never touches your files or your `@`", for one act you
ask for), ADR-0055 ("bring up to date" is "catch up", its button acts at once,
and how a card with a command says so), ADR-0032 (where the composer says where an agent
works), ADR-0029 and ADR-0038 (archiving a root withdraws its threads'
offers). Amended by ADR-0076: the project menu has two sections, the
project's (publishing it to main) and your files' (only on the host's own
machine), and lists no files but those that would conflict. Amended by
ADR-0069: the header's ⇣ goes; its threads are the
activity menu's "Ready to add", counted on its badge.

**Context.** Using ADR-0060's build, Duane found:

- A column whose base had moved said nothing; "bring up to date" sat in
  the offer's "…" menu whether or not anything was new.
- The chip beside the send button said "on a copy", which read as part of
  the button: "on a copy · send to agent".
- Its menu listed where the agent works and where its copy starts in one
  list, with no mark on either choice; "starts from pineta-onto" read as a
  caption.
- "Bring up to date" seemed to do nothing: it gave your card a command and
  focused the box, and the button still said "queue up next".
- The header counted 7 offers after he had abandoned every offer bookmark:
  a refresh that found no offer and nothing to build left the record, and
  an archived thread's lane history, deleted from the repo, left its offer
  and record for good.

And `pineta-onto` means nothing to someone who does not use jj; to someone
who does, it says nothing about what to do next.

**Decision.**

- **Three places, named by what they are for.** The integration line is
  **the project**: where finished work goes. Your own work is **your
  files**. A thread works on **its own copy**. A WIP is **your unfinished
  work**, named by its bookmark. Words name places only so, through one
  function (`baseName`, `packages/marginalia/work.ts`); the jj names (the
  bookmark, short commit ids, `pineta-offer/<thread>`) go in titles, in the
  project's setup, and on the offer's copy button, which is there to find
  it in jj.
- **The verbs move work between the places.** "Add to the project" (a take
  onto the line), "add to wip/search" (into a WIP), "catch up with the
  project" (bringing a thread up to date), "add my work to the project"
  (land my work), and "update my files" (below).
- **A thread knows when its base has moved on**, from records the page has:
  the commit its newest `Pineta-Base` names against the line's commit or the
  WIP's (`baseMoved`). Then the offer's strip says "the project has new
  work", catching up stands beside the offer instead of in its menu, and
  the column's header shows ↓, titled with the bookmark and both commits.
- **The composer says what a send does to your files**: "works on its own
  copy · your files stay as they are", or "edits your files directly", as a
  line left of the send button, which opens the menu. The menu has two
  sections, each choice marked ✓ when chosen: where the agent works, and,
  only when there are WIP bookmarks, where its copy starts.
- **A card with a command says what sending it does**, above its box:
  "↓ catches up with the project first, then sends what you write". Its
  button is "catch up", or "catch up and send" with text; its box's text is
  optional. Queued, the strip says the thread is catching up.
- **Catching up acts at once** (amended in place, Duane, 2026-10-03). The
  strip's catch-up button (and "continue from the project", and "resolve in
  the thread") queues a new card holding the command and no text, which the
  host takes when the lane is free; your composer is left as it was. A
  second press to send it was one step too many: what to do with the new
  work can be said in a message after it. A card still carries a command
  when one is unqueued, and then says so as above.
- **Archiving a root withdraws its threads' offers**, edited ones too:
  offers are immutable, so editing one is an expert's deliberate act.
  Restoring builds them again from the lane history it brings back. It is
  the refresh's rule (`planRefresh`: an archived thread's offer is
  withdrawn, keyed on the archive record, not on a missing tip), run on the
  offers' queue for your repo. Archive in a tab's ⋯ names the threads it
  withdraws offers of.
- **A refresh that finds no offer and none to build removes the record**
  (`forget`). A lane whose work changes no file is not built (`empty`): a
  built and withdrawn offer would be built again on the next poll.
- **"Update my files" rebases your work onto the project, when you ask.**
  It is a `line` action, run as you, as "land my work" is:
  - `jj rebase -b @ -d <onto>`: your work above the line, and every head
    on it, `@`'s siblings included (S80 items 1 and 2).
  - Before it runs, a preview from `git merge-tree` against `@`, which
    writes nothing jj or jjui shows: the files that change in your working
    copy, those that conflict, and the other heads that move (S80 item 3).
  - A conflict does not refuse it (Duane, 2026-10-03): jj records it, and
    the markers land in `@`'s files, as a thread's catch-up leaves them in
    its lane. The header then says your files have conflicts, and offers
    "resolve with the agent": a thread working in your files (ADR-0032),
    run with `resolve-conflicts` (ADR-0033), resolving at the lowest
    conflicted commit (S80 item 5).
  - It refuses only when `@` descends from no commit of the line.

**As built.**

- **The preview is part of the line's record** (`yours.follow`), read
  with the rest whenever your repo's operation head moves, so the project's
  menu shows it before you choose: the files that change, those that would
  conflict, and how many other lines of your work move. "Update my files"
  is offered only with a preview, and runs only while the record it is
  planned from still has one.
- **"Resolve with the agent" opens a new agent tab** working in your files
  (its box's `Prefill` carries the work setting), its box holding
  `/pineta:skill:resolve-conflicts` and the conflicted files, for you to
  send. The
  agent reads the conflicts from your working copy itself: the skill has a
  section for your own files, where `ask_for_guidance` is not available
  and it asks in its reply. No host-built prompt (`planResolution`) is
  needed: the host gathers conflict material for a lane only because it
  cannot read a lane's disk.
- **A refused or failed `line` command is said** in the project's menu,
  at the top of its notes, until the next.

**Consequences.**

- Someone who never uses jj can follow work from a thread to the project,
  and, once "update my files" is built, into their files.
- Pineta touches your `@` in one act, which you ask for after a preview.
  ADR-0060's reason against a take moving `@`, that you cannot tell what it
  does to the work you have open, is met by the preview; a take still never
  moves it.
- An update stored before this ADR has no `line` flag, and names its base
  by its bookmark.
- Dropping one branch's offer while its conversation stays open, and an
  offer you abandon in jj on an open thread, are not covered: the offer is
  built again while its thread has work not on the line.

**Alternatives rejected.**

- **Keep the jj names in the words.** `pineta-onto` is a configured
  bookmark: it tells a person neither what it is for nor what to do.
- **"Update my files" as part of a take.** ADR-0060 removed that for good
  reason: a take you press for a thread's work would change your files too.
- **Refuse "update my files" on a conflict.** A thread's catch-up leaves its
  conflicts for its agent; your files can do the same, with the same skill.
- **A "drop this offer" action.** Archiving already means "done with this";
  a second way to dismiss would need a state of its own.
- **Withdraw an offer when its lane's tip is missing from your repo.** A
  ref missing for one import (S78) would abandon a live thread's offer; the
  archive record says what was meant.
- **`jj rebase -r '<onto>..@'`** for "update my files": it reparents your
  other heads onto the commits under the moved ones, dropping their
  changes (S80 item 2).
