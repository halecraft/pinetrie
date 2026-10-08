# ADR-0104 — Offers are accepted onto accepted work by a forward bookmark move; the repo is the ledger

- **Status:** Accepted
- **Area:** `docs/the-jujutsu-repo.md`, `packages/repo/TECHNICAL.md`
- **Evidence:** S48, S51, S72, S73, S74, S77, S78, S80, S81, S87, S89, S97,
  S99, S102, S103, S111, S121
- **Supersedes:**
  - ADR-0060: restated whole, with ADR-0061, ADR-0065, ADR-0067, ADR-0072,
    ADR-0076, ADR-0079, ADR-0080, ADR-0083, ADR-0090, ADR-0099 and ADR-0100
    folded in.
- **Amended by:**
  - ADR-0118: accepted work, WIPs and publish are per branched source.

Restates ADR-0060 as amended by ADR-0061, ADR-0065, ADR-0067, ADR-0072,
ADR-0076, ADR-0079, ADR-0080, ADR-0083, ADR-0090, ADR-0099, ADR-0100 and its
own revision of 2026-10-02 (S81); decides nothing new. The words are
`docs/glossary.md`'s. What the host writes in your repo, command by command,
is `docs/the-jujutsu-repo.md`.

**Context.** pine·trie shares one repo with you, and you rewrite it freely,
in jj and jjui. pine·trie used to work out what you meant from the repo's
state compared against records it kept elsewhere, and four failures came of
it (ADR-0060):

- **What you already have** was a record by commit id (`pinetrie.have`),
  which every rewrite of yours broke; its rules grew case by case (S51,
  S72).
- **Who edited an offer** was a diff against a remembered commit. A restart
  between a refresh's jj steps and its record write made the host's own
  rewrite read as your edit (S73).
- **Your `@-` was assumed to move forward.** A rewrite in place moved it
  sideways, and every lane failed to start (S74).
- **A take moved your `@`.** It rebased the offer under your working copy,
  as you, so with jjui open you could not tell what it would do.

Your work also froze unannounced: a lane's history is an untracked remote
bookmark, immutable in jj, so any commit of yours a lane descended from
became immutable (S48 item 11). And taken history was held only by lanes'
refs: one missing ref abandoned three taken commits (S78). Two causes lay
under all of this: the ledger lived outside the repo, and identity was by
commit id.

**Decision.**

- **Accepted work is one bookmark,** `pinetrie-accepted` by default
  (`accepted.bookmark`, in the user config or the project's `pinetrie.json`,
  the project's winning). Finished work lands on it, and it only moves
  forward. A repo without it is set up once: **set up** proposes your `@-`
  and shows every config line it would write, and writes only when chosen.
  Anyone admitted may set it up, on any host (ADR-0099). A starting host
  renames the old `pinetrie-onto` to it once (ADR-0100, S121).
- **Accepted work is immutable, and so is an offer that sits on it.** Setup
  joins `present(<accepted>) | (bookmarks(glob:"pinetrie-offer/*") &
  children(present(<accepted>)))` to your repo's `immutable_heads()`, and
  the offers to its `revsets.log`, since an immutable head is out of jj's
  default log (S77 items 3 and 8). Nothing of yours above accepted work is
  frozen. The host's own rewrites of offers pass `--ignore-immutable`.
- **Where agent work begins, a lane starts from accepted work.** A new root
  thread, or a branch above any agent work, gets a lane whose disk starts at
  accepted work. It does not see your `@`, your uncommitted edits, or your
  commits not yet accepted. A branch below agent work clones its parent
  lane's disk at the nearest revision (ADR-0032, ADR-0034).
- **Or from a WIP you name.** A bookmark starting with the WIP prefix
  (`wip/` by default, `wip.prefix`), above accepted work, says "threads may
  build on this". It is mutable, and nothing else of yours is visible to a
  thread.
- **A thread's base is chosen once, at its first message,** in the
  composer's "…" menu ("starts from"), accepted work preselected and every
  WIP listed. It goes with the first message, and the host checks it before
  it creates the lane (ADR-0057). It is never inferred from your `@`. A WIP
  base shows in the column's header; accepted work shows nothing.
- **A thread on a WIP forks from a copy of it**, never from its commits,
  which the lane's immutable tip would freeze. The copy is one commit, made
  in the lane, holding the WIP's files. Its offer is the lane's work since
  the copy, placed on the WIP bookmark's current target. A WIP thread's
  catch-up copies onto the lane's previous copy, so conflicts the lane
  already resolved do not come back.
- **The lane's history says its base.** Each commit the host makes to start
  a lane or catch it up carries `Pinetrie-Base`: `accepted@<commit>` for
  accepted work, `<wip>@<commit>` for a WIP. A name with the WIP prefix is a
  WIP; any other, older `pinetrie-onto@…` included, is accepted work
  (ADR-0100). These commits are titled `base: accepted work`, `catch up:
  accepted work` and `copy of <wip>`. The newest is the thread's base; the
  host reads it from the lane and gives the page it as a fact.
- **Catching up is with the thread's base,** named on its button ("catch
  up", ADR-0061). It merges accepted work's commit, or a fresh copy of the
  WIP, into the lane. A WIP thread never catches up with accepted work: you
  rebase the WIP onto accepted work (it is yours), then catch the thread up
  with the WIP. A thread also catches up with the thread it branched from
  (`catch-up-with-parent`, ADR-0072), which is no base: its offers still go
  to accepted work or its WIP. Before either merge, each accepted-offer
  commit the lane holds is joined to its source, so the lane's work is not
  merged twice (ADR-0079, S102). The agent catches up through its
  `catch_up` tool, refused as the button's command is (ADR-0080, S103).
  The host records what catching up would change, and where it was read,
  as `pinetrie.base` (ADR-0067).
- **A WIP that lands hands its threads to accepted work.** When the WIP's
  bookmark, or the commit a thread's `Pinetrie-Base` names, is in
  `::<accepted>`, the thread's base becomes accepted work. A WIP gone
  without landing stops its threads' catch-ups and WIP acceptances, and the
  header says so; "continue on accepted work" (`continue-on-accepted`, a
  person's command, ADR-0080) moves the thread by a catch-up whose
  `Pinetrie-Base` names accepted work. pine·trie does not decide this for
  you: the bookmark may come back.
- **An acceptance moves one bookmark forward to the offer.** It never
  rebases and never moves your `@`. Its destinations, decided as a value:
  the bookmark the lane forked from (the default), and for a WIP thread,
  accepted work too, with your WIP's commits. Every destination gives the
  same tree. The acceptance names the offer it was shown (its ledger, and
  whether it conflicted), and is refused `offer_changed` when the offer now
  brings other work or newly conflicts (ADR-0065). It re-reads its facts in
  its own step and refuses a destination no longer below the offer. It
  leaves a fact in the thread, queued as a card while the thread runs
  (ADR-0080).
- **Only an offer with no conflicts is accepted into accepted work.** A
  conflicted one is resolved in its thread (ADR-0033), or accepted into a
  WIP, which is mutable. Each button names its destination: **accept**,
  **accept into wip/search**, **accept anyway into wip/search**; a
  conflicted offer on accepted work shows **Resolve in the thread**. The
  commit an acceptance leaves is an **accepted-offer commit** (ADR-0083,
  ADR-0100).
- **Publish moves the publish bookmark forward to accepted work**
  (`publish.bookmark`, `main` by default; ADR-0076, ADR-0090). It is one
  button, shown only when there is something to publish, and anyone
  admitted may press it. With `publish.catchUp` off, the default, it is
  `jj bookmark move main --to <accepted>` as the host, and no file moves.
  With it on, it first catches your files up (`jj rebase -b @ -d
  <accepted>`, as you) and accepts your commits below `@` with `main` in
  one move, as you; a conflict it could not preview reverts the catch-up
  with `jj op revert`, never `jj op restore` (ADR-0099, S111). It is
  refused when `main` holds commits accepted work lacks. It does not push.
- **The repo is the ledger.** What the host needs to resume is in trailers
  on the commits it makes, never on yours:
  - an offer's every revision carries `Pinetrie-Source` (the lane tip it
    holds) and `Pinetrie-Start`, beside `Pinetrie-Thread`, `Pinetrie-Lane`
    and `Pinetrie-Entry`;
  - an accepted offer keeps them, so `Pinetrie-Source` names the lane
    commit you now have. Trailers survive a rebase, and a squash that keeps
    both messages keeps both; pine·trie reads them from every paragraph
    (S77 item 6).

  Your own commits are found by ancestry. Where an offer starts is one
  revset: the lane's newest `Pinetrie-Base` commit and the lane commits that
  `Pinetrie-Source` trailers in `::<accepted>` (and `::<wip>`) name, except
  those at or below the commit the base names, which the lane merged whole
  (S81). An accepted-offer commit above the base that names no source makes
  the lane's start untraced, and nothing is offered until the lane catches
  up past it (ADR-0067, S97). The offer record (`pinetrie.offer`) and
  accepted work's record (`pinetrie.accepted`) are the page's caches,
  rebuilt from the repo; a lost write costs nothing.
- **Authorship comes from jj's operation log.** Every host operation runs
  as `pinetrie-host`, and an acceptance no longer runs as you. Whether you
  changed an offer is a walk of its evolog back to the host's newest
  version (S73).
- **Identity is by bookmark or change id**, never a remembered commit id,
  wherever your rewrites must be tolerated: the base snapshot follows
  accepted work (with S74's recovery), an offer on a WIP follows its
  bookmark, and every write to your repo goes through its one owner
  (ADR-0065).

**Consequences.**

- pine·trie moves your files and your `@` only in a publish with
  `publish.catchUp` on, as you. An acceptance is a bookmark move, as the
  host.
- Accepted work is final: it changes by commits on top, or by
  `--ignore-immutable` on purpose. What is immutable is decided by you, not
  by what a lane descends from: lanes start on accepted work, or on a copy
  whose parent is on it.
- An offer conflicts only with accepted work or its WIP. Your open work
  meets accepted work when you catch up, as an ordinary jj conflict.
- A thread does not see uncommitted work. To have one build on unfinished
  work, name it as a WIP.
- Trailers appear in accepted commits' messages. Stripping one by hand
  changes what pine·trie believes.
- Your repo config gains the immutable heads and the log revset, shown
  before they are written.

**Alternatives rejected.**

- **A jj workspace of pine·trie's own, to accept into.** Workspaces separate
  only `@`, not ownership, and a checked-out commit goes stale whenever you
  rewrite under it (S74).
- **Offers immutable while they sit on your `@-`.** Every ancestor of an
  immutable head is immutable: your work under an offer would freeze.
- **Acceptances that move your `@`** (ADR-0038). You cannot tell in advance
  what one does to the work you have open.
- **A WIP thread forking from the WIP's own commits.** The lane's immutable
  tip would freeze the WIP as soon as a thread started on it.
- **Threads forking from your committed stack, or from your `@` with
  uncommitted edits** (ADR-0038). The host would have to match versions of
  your changes after every rewrite, for every thread.
- **A mutable exception below accepted work's head.** Immutability is
  closed over ancestors; a WIP lives above accepted work instead.
- **The ledger in the session document.** A record written after the jj
  steps it describes can be lost after they land (S73).
- **Trailers on your own commits.** Your commits are found by ancestry.
- **Catching a WIP thread up with accepted work.** Its offer would carry
  accepted work's new changes into your WIP.
- **Inferring a thread's base from where your `@` is,** or moving a thread
  whose WIP is gone to accepted work by itself: both decide from what you
  did not say.
- **Rebasing an offer into a destination it does not sit on.** A rebase
  makes new content and can make new conflicts: a different operation.
- **A publish that decides from where the host listens or whom it admits**
  (ADR-0090). What the host does is config (ADR-0099).
