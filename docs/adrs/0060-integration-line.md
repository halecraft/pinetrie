# ADR-0060 — Takes stack on an integration line; the repo is the ledger

**Status:** Accepted (Duane, 2026-10-02). Evidence: S48, S51, S72, S73,
S74, S77, S78. Implemented by `PLAN-2026-10-02-integration-line`. Amends ADR-0038 (where
an offer sits and starts, what a take does, what you already have, and
where a root thread starts: the line, not your `@`), ADR-0032 (where a
lane starts) and ADR-0034 (how work moves into your repo).

**Context.**

Pineta shares one repo with you. You rewrite it freely, in jj and jjui:
squash, amend, reword, rebase. Pineta has worked out what you meant from
the repo's state, compared against records it keeps elsewhere, and each
way that failed was patched as it was found:

- **What you already have** (ADR-0038's `pineta.have` records): commits a
  take delivered and copies of your `@`, kept by commit id in the session
  document. A rewrite of yours breaks the link. The rules for which haves
  count grew case by case: the newest copy supersedes older haves (S51), a
  parent taken after a branch forked counts for the branch (S72).
- **Who edited an offer**: a diff against the commit the host last
  recorded. A host restart between a refresh's jj steps and its record
  write lost the record, and the host's own rewrite then read as your edit:
  the offer froze for twenty minutes and was taken with conflicts it never
  named (S73).
- **Your `@-` moved forward**: assumed by the base snapshot's refresh. A
  rewrite in place moved it sideways, the working copy went stale, and
  every lane failed to start (S74).
- **A take moves your `@`.** It is `jj rebase -r <offer> -A @- -B @`, run as
  you, because it updates your files. Using jjui beside Pineta, you cannot
  tell what a take will do to the work you have open, and fear "messing
  something up".

Your work is also already made immutable, implicitly and unannounced. A
lane's history reaches your repo as untracked remote bookmarks
(`tip@pineta-<lane>`), which jj's builtin `immutable_heads()` includes (S48
item 11). Once a lane forks from or is brought up to date with a commit of
yours, that commit is an ancestor of the lane's tip, and immutable. On
2026-10-02, `nmsuztkr`, a fix still being finished, became immutable when
cozy-mallard was brought up to date past it. When your work freezes depends
on what threads do, not on you.

And your landed history is held only by those lanes' refs: no bookmark of
yours moves with takes. On 2026-10-02 a lane's ref was missing for one
import, and jj abandoned three landed commits with the lane's history, and
rebased everything above them, `@` included (S78).

Two causes underlie the four failures. The ledger lives outside the repo, in a
document that can lose a write jj has already made durable. And identity
is by commit id, which every rewrite of yours changes.

**Decision.**

- **An integration line.** One bookmark, `pineta-onto` by default, is the
  line where finished work lands: threads' work, by a take, and yours, by
  "land my work". It only moves forward. The name is configurable:
  `offers.onto` in the user config (`$XDG_CONFIG_HOME/pineta/config.json`)
  or the project's `pineta.json`; the project's value wins, since the
  bookmark belongs to the repo. A repo without the bookmark is set up once:
  the host proposes your `@-` and creates the bookmark only when you agree.
- **The line is immutable, and so are offers that sit on it.** The host
  extends your repo's `immutable_heads()` with
  `present(<onto>) | (bookmarks(glob:"pineta-offer/*") & children(present(<onto>)))`
  (without `present()`, a repo with no line fails every jj command, S77),
  joined to
  the definition you already have, and shows you the result before writing
  it. jj makes every ancestor of an immutable head immutable, so nothing of
  yours above the line is frozen: an offer is immutable only when its parent
  is the line. Rewriting taken work then needs `--ignore-immutable`, a
  deliberate act. The host's own rewrites of offers pass that flag in its
  own operations.
- **Where agent work begins, a lane starts from the line.** A thread (a
  line of the conversation, with its lane, ADR-0020) that has no agent work
  to inherit (a new root thread, or a branch from above any agent work)
  gets a lane whose disk starts at the line. It does not see your `@`, your
  uncommitted edits, or commits of yours not yet on the line. ADR-0038's
  fallback, "your `@` as it is when you send, uncommitted edits included",
  goes. A branch below agent work still clones its parent lane's disk at the
  nearest revision (ADR-0032, ADR-0034): it inherits work that began on the
  line, or on a WIP's copy.
- **Or from a WIP bookmark you name,** in place of the line. A bookmark
  whose name starts with the WIP prefix, `wip/` by default
  (`offers.wipPrefix`, configured as `onto` is), above the line, declares
  "threads may build on this". A WIP is mutable: it is above the line, so no
  exception to `immutable_heads()` is needed. Nothing else of yours is
  visible to a thread.
- **A thread's base is chosen once, at its first message.** The new
  column's composer keeps it in its "…" menu, since it is rare: "starts
  from", with the line preselected and every WIP bookmark above the line
  listed (the host reads `bookmarks(glob:"<prefix>*")` and gives the page
  the list as a fact). The choice goes with the first message, as a new
  thread's lane id does (ADR-0057). It is never inferred from where your `@`
  is. A base other than the line shows in the column's header ("on
  wip/search"); the line shows nothing.
- **A thread on a WIP forks from a copy of it, never from its commits.** A
  lane's tip is an untracked remote bookmark in your repo, and so immutable;
  a lane forked from your WIP's own commits would freeze them (see
  *Context*). The host makes the copy in the new lane, as it makes a copy of
  your `@` today (`planYourCopy`): one commit on the line commit under the
  WIP, holding the WIP's files, its message written by the host with
  `Pineta-Base: <bookmark>@<commit>`. The copy's parent is already
  final, so the lane freezes nothing of yours. The copy lives only in the
  lane's history. Its offer is the lane's work since the copy, placed on the
  WIP bookmark's current target: after you rewrite the WIP, it follows the
  bookmark, and conflicts only where you changed what the lane changed.
- **The lane's history says its base.** Every commit the host makes in a
  lane to start it or bring it up to date carries `Pineta-Base:
  <bookmark>@<commit>`: the bookmark is the line or a WIP, the commit what
  it pointed at then. A fork from the line is an empty commit on the line
  commit with that trailer; a WIP fork is the copy; an update is the merge
  it makes. The newest such commit in the lane's history is the thread's
  base, and its commit is where the lane's offer starts. A branch below agent
  work clones its parent's lane, so it inherits the base with no choice of
  its own. The host reads the base from the lane and gives the page it as a
  fact: the header, the take destinations and the update button all come
  from it.
- **"Bring up to date" is always with the thread's base**, named on its
  button: "bring up to date with pineta-onto", or "with wip/search". A line
  thread merges the line's current commit into its lane, with no copy: the
  line is final. A WIP thread merges a fresh copy of the WIP. A WIP thread
  is never brought up to date with the line: its offer is its lane's work
  since the copy, so line changes merged into the lane would ride into the
  WIP with the thread's. To bring a WIP thread level with the line, you
  rebase the WIP onto the line (it is yours), then bring the thread up to
  date with the WIP. The app says when that is due, as a fact ("wip/search
  is 3 takes behind pineta-onto").
- **A WIP that lands hands its threads to the line.** When the WIP's
  bookmark points into `::<onto>` (moved there by landing, or by a squash
  into the line, which keeps the bookmark and drops the WIP's change, S77),
  or, with the bookmark gone, the commit a thread's `Pineta-Base` names or
  its change id is in `::<onto>`, the WIP's work is on the line: the
  thread's base becomes the line, its header loses the WIP, and its next
  update is with the line. A WIP that is gone
  without landing (its bookmark deleted, renamed, or its commits abandoned)
  stops its threads' updates and WIP takes, and the header says so;
  "continue on pineta-onto", in the "…" menu, moves such a thread to the
  line, by an update like any other: its merge says `Pineta-Base:
  <onto>@…`, so the thread is on the line from then on. Its offer then
  carries the gone WIP's content with the thread's work, since that is now
  the only place it exists. Pineta does not decide this for you: the
  bookmark may be about to come back.
- **A take moves one bookmark forward to the offer. It never rebases, and
  never moves your `@`.** Its destinations are the bookmarks below the offer
  that can move forward to it, decided as a value:
  - the bookmark the lane forked from, the default: the line, or the WIP;
  - for a thread on a WIP, the line too, landing your WIP's commits with the
    offer.

  Every destination gives the same tree, so the conflicts an offer shows are
  true wherever it is taken. Destinations differ only in which bookmark
  moves, what comes with it, and whether the result is final. The take
  re-reads its facts in its own step, and refuses when the destination is
  no longer below the offer.
- **Only a clean offer lands on the line.** The line is immutable, so a
  conflicted commit taken onto it would stay conflicted in its history, and
  every thread forked after it would start from it. A conflicted offer is
  resolved in its thread first (ADR-0033), or taken into a WIP, which is
  mutable: there you fix it yourself. The take re-checks this in its own
  step, as it does the destination.
- **Each take button names its destination**: "take onto pineta-onto"; for a
  WIP, "take into wip/search", with "land on pineta-onto, with your 2
  commits beneath it" in its menu. A conflicting offer has no line among
  its destinations: a thread on a WIP shows "take anyway into wip/search",
  and a thread on the line shows "Resolve in the thread". The words come
  from the value (`offerWords`), as now.
- **"Land my work" moves the line forward to a commit of yours**, as you,
  forward only. It touches no files. Your `@` stays where it is; bringing the
  line into your own work is a rebase you make in jj or jjui, and the app
  says when the line has moved since your `@`'s base.
- **The repo is the ledger.** What the host needs to resume is in the repo,
  as trailers on commits it makes, never on yours:
  - an offer carries the lane tip it was built from and where it starts
    (`Pineta-Source`, `Pineta-Start`), beside `Pineta-Thread`,
    `Pineta-Lane` and `Pineta-Entry`;
  - a taken offer keeps them: `Pineta-Source` names the lane commit you now
    have. Trailers survive rebase, and a squash, accepting jj's prefilled
    message, keeps both messages, so they follow what you do to taken work.
    Pineta reads its trailers from every paragraph of a message, by regex:
    jj's `trailers` reads only the last, and a squash leaves two (S77). A
    squash that keeps one message drops the other's trailers, and that work
    is offered again: the consequence of an explicit edit.

  Your own commits need nothing: they are found by ancestry. What a lane's
  offer starts from is then one revset over the repo: the lane's newest
  `Pineta-Base` commit, and the lane commits that `Pineta-Source` trailers
  in `::<onto>` and `::<the WIP>` name. `pineta.have` records go. The
  `pineta.offer` record becomes a cache for the page, rebuilt from the repo
  on every trigger; a lost write costs nothing.
- **Authorship comes from jj's operation log.** Every host operation carries
  `operation.username=pineta-host`, and a take no longer runs as you, so
  every operation of yours is yours. "Did you change this offer?" is a walk
  of the offer's evolog to the host's last version (S73), never a diff
  against a remembered commit alone.
- **Identity is by bookmark or change id, never by a remembered commit id,**
  wherever your rewrites must be tolerated: the base snapshot follows the
  line (with S74's recovery kept), and an offer on a WIP follows the WIP's
  bookmark.

**Measured** (S77): a bookmark moves only forward without
`--allow-backwards`; a WIP bookmark is deleted by `jj abandon`, follows a
rebase and a split, and moves onto the line's commit in a squash into it;
the extended `immutable_heads()` freezes the line and its offers and not a
WIP, at no measurable cost; a lane's own bookmark keeps a sideways fetch
from rewriting it, so S74's recovery is needed on the base disk only; an
offer from a WIP's copy conflicts only on lines both changed; the host's
`--ignore-immutable` rewrite of an offer and a take's bookmark move both
work on the immutable line.

**Consequences.**

- Pineta never touches your files or your `@`. A take is a bookmark move,
  as the host; landing your work is a bookmark move, as you.
- Taken work is final on the line: it is changed by commits on top, or with
  `--ignore-immutable` on purpose. What is immutable is then decided by you
  (the line, and offers on it), not by which commits a lane happens to
  descend from: lanes start on the line, or on a copy of a WIP whose parent
  is on the line, so a lane's tip makes immutable only what was already
  final. Rewriting taken work in place, the case behind S74, no longer
  happens by accident.
- An offer conflicts only with what is on the line or in its WIP. Your own
  open work meets the line when you rebase onto it, as an ordinary jj
  conflict in your own tool.
- A thread no longer sees uncommitted work. To have one build on unfinished
  work, name it as a WIP. To share it more widely, land it and continue on
  top: fix-up commits instead of amends.
- A thread has one base for its life, chosen once and rarely: the line by
  default. "Bring up to date" has one meaning, named on its button, and a
  WIP thread's header says which WIP.
- Copies of your `@` in lanes go, and with them S51's newest-copy rule and
  `pineta.have`. The one copy left is a WIP's, whose offer needs no record of
  what you have: it is the lane's work since the copy. The start rules
  shrink to ancestry plus trailers.
- Trailers appear in taken commits' messages. Correctness is chosen over a
  quieter log. Stripping them by hand changes what Pineta believes, which is
  explicit intent.
- Your repo config gains the immutable heads above, shown before it is
  written. ADR-0038 had removed Pineta's line from `immutable_heads()` once
  lane history became untracked remote bookmarks, immutable with no config
  (S48 item 11). This line protects something else: the integration line
  and the offers on it.
- Migration: existing open offers are rebuilt on the line; `pineta.have`
  records are read once to write `Pineta-Source` where a taken commit lacks
  one, then deleted.

**As built.** Where the build departs from the text above:

- **`line` commands are a host's, not a seat's.** Kyneta does not tell the
  host which connection a seat came over, so a host with an invite key
  (one that admits others) refuses setup and land (`not_yours`), and the
  page offers neither.
- **The base is chosen per composer**, as the work choice is, and sent with
  the first message; nothing is kept on the column.
- **A WIP thread's update copies onto the lane's previous copy**, not the
  line commit under the WIP, so conflicts the lane already resolved do not
  come back.
- **No migration of `pineta.have`:** stored values are deleted at
  startup. A lane with no `Pineta-Base` is on the line, and starts at the
  newest line commit in its history.
- **Setup also writes `revsets.log`**, adding the offers: an immutable
  head is out of jj's default log, so jj and jjui would not show an offer on
  the line (S77 item 8). It is shown, and written, with the immutable heads.
- **An offer's ledger is read from its message** (`offerLedger`); the
  record keeps a copy only for an offer whose message you rewrote without
  it.

**Alternatives rejected.**

- **A jj workspace of Pineta's own, to take into.** Workspaces share the
  operation log, the commits and the bookmarks; they separate only `@`. It
  would not separate ownership, and it adds a checked-out commit that goes
  stale whenever you rewrite what it sits on (S74, in your own repo). The
  host's operations need no working copy, and lanes have disks where one is
  needed.
- **Offers immutable while they sit on your `@-`.** Every ancestor of an
  immutable head is immutable: your own work under an offer would freeze.
- **Takes that move your `@`** (ADR-0038). The take ran as you and changed
  your files; with jjui beside Pineta, you cannot tell in advance what it
  does to the work you have open.
- **A thread on a WIP forks from the WIP's own commits.** The lane's tip,
  immutable in your repo, would make them immutable: the WIP would freeze as
  soon as a thread started on it.
- **Threads fork from your committed stack** (your `@-`, with no copy).
  Convenient, but a thread then builds on whatever you have committed, and
  the host must match versions of your changes after every rewrite, for
  every thread. A named WIP keeps that to the threads you chose, anchored to
  a bookmark.
- **Threads fork from your `@`, uncommitted edits included** (ADR-0038).
  Needs copies in lanes, the copy rules of S51, and a moving target.
- **A mutable exception inside the line** (a `wip/` commit below the line's
  head). Immutability is closed over ancestors; there is no exception below
  an immutable head. A WIP lives above the line instead.
- **Keeping the ledger in the session document.** A record written after
  the jj steps it describes can be lost after they land (S73). The document
  stays a cache.
- **Trailers on your own commits.** Not needed: your commits are the
  commits, found by ancestry. Pineta writes trailers only on commits it
  makes.
- **Bringing a WIP thread up to date with the line.** The lane's work since
  its copy would then hold the line's new changes, and its offer would carry
  them into your WIP. Rebasing the WIP onto the line is yours to do.
- **Inferring a thread's base from where your `@` is.** It would decide from
  where you happen to be, which is the implicit intent this ADR removes.
- **The base choice in the composer's own row.** It is rare and has
  consequences; a control always in sight invites a choice you seldom mean.
  It is in the "…" menu, and shown in the header once chosen.
- **A thread whose WIP is gone moves to the line by itself.** The bookmark
  may be about to come back, renamed or recreated; only a WIP that has
  landed hands its threads over.
- **Rebasing an offer into a destination below which it does not sit.** A
  rebase makes new content and can make new conflicts; it is a different
  operation, with its own preview, not a take.
