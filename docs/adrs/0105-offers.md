# ADR-0105 — A thread's work reaches your repo as an offer: one commit, or a stack, on its base, that you review and accept

- **Status:** Accepted
- **Area:** `docs/the-jujutsu-repo.md`, `packages/jj/TECHNICAL.md`
- **Evidence:** S48, S49, S51, S57, S72, S73, S87, S89, S97, S103, S104
- **Supersedes:**
  - ADR-0038: restated whole, with ADR-0039, ADR-0040, ADR-0047, ADR-0055,
    ADR-0060, ADR-0061, ADR-0065, ADR-0067, ADR-0080, ADR-0083 and ADR-0100
    folded in.
- **Amended by:**
  - ADR-0113: the offer's line is in the column's header.
  - ADR-0118: a thread has an offer in each source it changed.
  - ADR-0142: in a folder project, an offer is a pair of states, not a commit.
    It is reviewed as files, and it has no bookmark, no evolog and no stack.
  - ADR-0154: whether you edited an offer is read from the host's remote
    bookmark, not from the evolog. An archived lane's tip is parked under a
    ref of the host's, not deleted.
  - ADR-0156: a thread's proposed changes sit under
    `pinetrie-proposed/<name>`; a starting host renames each
    `pinetrie-offer/<name>`, once.

Restates ADR-0038 as amended by ADR-0039, ADR-0040, ADR-0047, ADR-0055,
ADR-0060, ADR-0061, ADR-0065, ADR-0067, ADR-0080, ADR-0083, ADR-0100 and
its own revisions (S51, S72, S73, and offers read from the repo); decides
nothing new. Where an offer sits, how it is accepted and how its ledger is
kept are ADR-0104's. The words are `docs/glossary.md`'s.

**Context.** A lane's turn commits are its infrastructure: branching from
any message, catch-ups and conflict context need them (ADR-0032). Taking a
thread's work once rebased your `@` onto the lane's merge, so every turn
commit, described "edit /workspace/…", became an immutable ancestor of your
work, and every turn's fetch filled your log. Nothing showed what a take
would bring before it happened. What you want in your repo is the change,
as you would accept a pull request.

**Decision.**

- **Each thread whose agent changed files keeps one offer in your repo:** a
  commit holding the lane's net change since its start (ADR-0104), on the
  thread's base, accepted work or a WIP. A conversation thread has no lane,
  and has none.
  - **Its bookmark is `pinetrie-offer/<name>`,** the thread's two-word name
    (ADR-0039). The host finds the offer by it. You may reword, squash,
    split or move it like any commit.
  - **An agent writes its description, as a commit message,** in a one-shot
    request outside the thread, under the replaceable `commit-message`
    skill read from your working copy. It is given the offer's diff, the
    thread's messages since the last acceptance, and your repo's recent
    descriptions. It is written when the offer's content changes, once a
    run ends that changed files; until then the offer carries a placeholder
    naming its thread. A description you edited is never replaced.
  - **It is a preview.** It shows in `jj log` and jjui before you accept it
    (ADR-0104 adds offers to `revsets.log`). jj records conflicts rather
    than failing, so an offer that conflicts with its base is marked
    conflicted and names its files.
- **An offer is built only from work known to change a file, from a known
  start** (ADR-0067). Whether the lane's work changes any file is `none`,
  `some` or `unknown`; unknown never builds an offer, and keeps one that is
  there. The page decodes each offer record into one status, `none`,
  `accepted`, `held` or `open`, which every reader switches on; an offer
  whose files accepted work already holds is `held`, and nothing counts it
  or warns about it.
- **The host builds and refreshes offers without touching your working
  copy.** Every host command runs with `--ignore-working-copy` and
  `operation.username=pinetrie-host`, through the one owner of your repo
  (ADR-0065), and finds a revision by its bookmark or a nonce, never a
  commit id kept between steps (S48 items 1 and 2).
  - **Build:** one commit per source at the start, each with its files
    restored, rebased onto the base, bookmarked.
  - **Refresh:** when the owner observes a move an offer depends on (the
    watched heads), as keyed upkeep, never on a poll. A full observation
    refreshes every named lane whose root is not archived, and every open
    record (2026-10-05).
  - **Rebuild** in place from the lane, keeping the change id and bookmark,
    when the lane's work changed (S49).
  - **Never over your edits.** An offer is yours once a version an
    operation not the host's made changes it, read by walking each
    revision's evolog back to the host's newest version (S73). A rebase jj
    made because you reworded a commit below is not an edit. The host then
    leaves the offer, and the thread's later work becomes a new offer on
    top.
  - **A race is repaired in your favour.** A refresh racing your edit makes
    the offer divergent; the host abandons its own commit and keeps yours
    (S48 item 8).
- **The repo, not a record, says what an offer is.** Its revisions are
  found by its bookmark and its thread's trailer; what it holds and where it
  started, by its ledger (ADR-0104); whether you edited it, by the evolog.
  The `pinetrie.offer` record is the page's cache. A refresh that finds no
  offer and none to build removes it.
- **The lane's history stays out of your view.** It is fetched as an
  untracked remote bookmark, `tip@pinetrie-<lane>`, which jj treats as
  immutable and leaves out of the default log; the owner imports each
  lane's bundle as the host's operation (ADR-0065, S87).
- **Archiving a root withdraws its threads' offers,** and restoring builds
  them again (ADR-0061).
- **Catching up is a card's command**, carried out when the host pops the
  card (ADR-0055): "catch up" with the thread's base, or with the thread it
  branched from. Its button queues a card with the command and no text. The
  agent can catch up, and ask for a split, through tools (ADR-0080). A lane
  whose work changes no file is caught up before its run.
- **"Split into a stack" rewrites an offer as a series of revisions,** under
  the replaceable `offer-stack` skill: a run on the lane, queued as a card
  and sent when the thread is free. The host accepts the stack only when its
  top has exactly the lane tip's files, runs the checks the skill names, and
  reports which steps fail. "Squash to one" returns to one commit.
- **Each step on an offer leaves a fact in its thread** (ADR-0080): an
  acceptance, a description, a squash and a refresh, queued as a card while
  the thread runs, so the agent works from what is true.
- **The column's work strip shows the offer in plain words** (ADR-0040):
  "2 files ready", with **accept** and the bookmark, which a press copies.
  The offer's line opens its review in the column's pane: each revision's
  description, files and diffs, read from jj by commit id (ADR-0047, S57).

**Consequences.**

- What you accept is one commit, or a stack you asked for, with a real
  description. The lane's turns stay browsable, and out of your log.
- Your op log gains the host's offer operations, marked `pinetrie-host`,
  instead of one import per turn.
- Each run that changes files costs one short description request; a stack
  costs one more run.
- Noticing your jj operations costs one read of your repo's operation head
  per change (S48 item 13).
- An offer can be divergent for one jj command's length, and is repaired.

**Alternatives rejected.**

- **The offer on `@`:** rewritten by every snapshot, and an acceptance would
  commit your unfinished edits below the thread's.
- **Bringing the turn commits into your history:** the noise this removes.
  The lane's history is one `jj log` away.
- **Deciding who edited an offer from a remembered commit, or from the
  evolog's newest entry alone:** the record can be lost (S73), and jj's
  rebase caused by your reword is your operation (S48 item 7).
- **Finding the host's commit by description after a race:** your edit may
  keep the description (S48 item 8).
- **Catching a thread up at the start of every run:** files would change
  under the agent without anyone asking.
- **Running the agent after every catch-up:** a clean merge is often
  nothing to talk about.
- **A description from the thread's first request,** or written by the
  lane's own agent as a turn, or at every refresh: the first says what was
  asked, not what changed; the second fills every thread with commit
  messages; a refresh changes where an offer sits, not what it says.
- **Building an offer when the work is unknown:** a guess at an offer can
  put your own work back over itself (S97).
