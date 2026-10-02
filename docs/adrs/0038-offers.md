# ADR-0038 — A thread's work reaches you as an offer: one commit you can see before you take it

**Status:** Accepted. Evidence: S48. Implementation:
`PLAN-2026-09-28-offers`. Amends ADR-0032 (where a lane starts, and its
bookmark), ADR-0033 (landing) and ADR-0034 (how work moves into your repo).
**Amended by ADR-0040:** the offer moves from the column's header to its work
strip, and its lines become plain words, with the bookmark shown apart.
**Amended by ADR-0047:** the preview is in Pineta too: the column widens to
show each revision's description, files and diffs.
**Amended by ADR-0055:** "Update from my work" becomes a card's command,
"bring up to date", carried out when the host takes the card; its prefill
goes, and the card's text is the intent.
Amended in place (S51, `PLAN-2026-09-29-offer-start`): the newest copy of
your `@` in a lane's history supersedes the haves recorded before it.
Amended in place (S72, `PLAN-2026-10-02-offer-start-beside`): a commit
delivered beside a lane's tip counts for the history the two share at or
above the tip's newest copy.
Amended in place (S73, `PLAN-2026-10-01-offer-lost-write`): an offer is
edited only by a change an operation not the host's made; an edited offer
that conflicts says so.
Amended in place (`PLAN-2026-10-02-offer-from-repo`): "edited" is a change
an operation not the host's made since the host's newest version in the
evolog, and the host keeps no record of what it wrote.
**Amended by ADR-0060:** an offer sits on its thread's base (the
integration line, or a WIP bookmark), and starts where the lane's
`Pineta-Base` and taken offers' `Pineta-Source` trailers say; a take is a
forward bookmark move, never a rebase under your `@`; `pineta.have` and
copies of your `@` are gone, and a root thread starts at the line.

**Context.** Taking a thread's work today rebases your `@` onto the lane's
merge (ADR-0034). Every turn commit the lane made becomes an ancestor of your
work, described "edit /workspace/…", and immutable there: `pineta/*` is in
your repo's `immutable_heads()`, so what you took cannot be squashed. Before
that, you must "land your work", which merges your `@-` into the lane and
always runs the agent (ADR-0033). The button points the wrong way: it moves
your work toward the thread. A lane starts from `@-`, so work you have not
committed is invisible to it, and "commit before asking" is a step people
miss. Nothing shows what a take will bring before it happens. Every turn
also fetches the lane's bookmark into your repo, so your `jj log` and op log
fill with turns.

Two histories were one. A lane's turn commits are its infrastructure:
branching from any message, folds and conflict context need them
(ADR-0032). What you want in your repo is the change, as you would accept a
pull request.

**Decision.**
- **Each lane with its own copy keeps one offer in your repo:** a single,
  mutable commit holding the lane's net change since it started, or since
  your last take. Precisely: from the newest of the lane tip's ancestors
  that you already have, your own commits and every lane commit a take has
  delivered, to the lane's tip. So a branch of a thread you never took
  offers its parent's work with its own, and a branch of one you took offers
  only its own, unless the branch was brought up to date before that take
  (S72); bringing it up to date again restores it. A conversation thread has no lane, and a lane working
  directly edits your files already; neither has an offer.
  - **It sits on `pineta-onto`, if you set that bookmark, else on your
    `@-`.** Not on `@`: `@` is rewritten on every snapshot, and an offer on
    it would move under you and put your unfinished edits below the thread's.
  - **Its bookmark is `pineta-offer/<lane>`.** You may reword, squash,
    split or move it like any commit.
  - **An agent writes its description, as a commit message.** A one-shot
    model request, outside the thread: no tools, nothing added to the tree
    or to the lane's context. It runs under a replaceable skill,
    `commit-message`, read from your working copy as `resolve-conflicts` is
    (ADR-0033), and is given the offer's diff, the thread's messages since
    the last take (budgeted as a fold is, ADR-0010), and your repo's recent
    descriptions, so it follows your conventions. The host adds the lane and
    the newest entry as trailers.
  - **It is written when the offer's content changes:** once a run ends that
    changed the lane's files. A refresh only moves the offer, and a
    description depends on what it changes, not where it sits, so a refresh
    writes nothing. Until the first is written, the offer carries a
    placeholder naming its thread. "Rewrite description" asks again. A
    description you edited is never replaced (the edit rule below).
  - **It is a preview.** It shows in `jj log` and in jjui before you take it.
    jj records conflicts rather than failing, so an offer that conflicts
    with your committed work is marked conflicted, and names its files
    (S48 item 3). An offer that touches files you are editing is flagged
    from file names (S48 item 4): that conflict only shows at take, in `@`.
- **The host builds and refreshes offers without touching your working
  copy.** Every host command runs with `--ignore-working-copy` and
  `--config operation.username=pineta-host`, and addresses an offer by its
  change id, never a commit id kept between steps (S48 items 1 and 2).
  Nothing finds a revision by its description.
  - **Build:** an empty commit at the lane's fork point, the lane tip's files
    restored into it, rebased onto the target, bookmarked.
  - **Refresh:** after each turn, and when your repo's operation head
    changes (`.jj/repo/op_heads/heads`, S48 item 13), if the target moved.
  - **Never over your edits.** The host refreshes an offer only when it
    matches the commit the host last wrote for it: the same description, no
    `jj interdiff`, and a parent that is an ancestor of the target (S48
    item 7). Otherwise the offer is yours: the host leaves it, and the
    thread's later turns become a new offer on top. *Amended (S73):* a
    difference counts as yours only if a version an operation not the
    host's made, walking the evolog back to the host's commit, changed it.
    The host's record of its own write can be lost after its jj steps
    landed (a restart between the two), and its own commit must not then
    read as your edit.
  - **A race is repaired in your favour.** A refresh racing your edit makes
    the offer divergent; the host abandons the commit its own operation made
    (`operation.user()`) and keeps yours (S48 item 8).
- **Take puts the offer on the target, under your edits:** `jj rebase -r
  <offer> -A <target> -B @` when the target is an ancestor of `@`, otherwise
  nothing moves but bookmarks. Take runs as you, since it updates your
  files. `pineta-onto`, when set, then moves to the offer, so accepted offers
  stack in the order taken, and an offer on a side branch never touches `@`
  (S48 items 5 and 9). A conflicted offer can be taken anyway: you resolve it
  in jj, as any conflict.
- **What you already have is recorded.** A take writes a host-written
  `pineta.have` value: the lane commit the offer was built from, delivered.
  So does every copy of your `@` made in a lane. Where an offer starts is
  read from these, so the next offer holds only what came after, and never
  your own edits back. *Amended (S51):* a copy holds everything you had when
  it was made, so the newest copy in the lane's history supersedes every have
  recorded before it. An older copy's uncommitted edits, or a delivered
  commit, may since have become commits of yours with other content, and
  starting from both would put the two versions in conflict. *Amended
  (S72):* a commit delivered beside the lane's tip counts for the history
  the two share at or above the tip's newest copy, so a branch of a thread
  taken after the fork offers only its own, unless the branch was brought
  up to date before that take; bringing it up to date again restores it.
- **The lane's history stays out of your view.** It is fetched as remote
  bookmarks (`refs/remotes/pineta-<lane>/…`), which jj shows only on request
  and treats as immutable with its builtin config: no remote is added and
  Pineta's line in your `immutable_heads()` is removed (S48 item 11).
  `jj log -r '::remote_bookmarks(remote=glob:"pineta-*") ~ ::@'` shows it.
- **Where no revision is above a lane's fork point, it starts from your `@`
  as it is when you send**, uncommitted edits included, instead of your
  `@-`. A lane still starts from the nearest revision at or above where it
  branches (ADR-0032); this changes only the fallback, which is where a root
  thread, or a branch above any agent work, starts. The copy is made in the
  lane: a commit on your `@-` with `@`'s files and a change id of its own.
  Starting at the `@` commit itself brings it back into your repo with the
  lane's work, and makes your `@` divergent (S48 item 10). The composer's
  warning that the agent will not see your uncommitted work goes.
- **"Update from my work" moves your work toward the thread, and only when
  you ask.** It merges your `@` (through a copy, as above) into the lane. It
  never happens at the start of a run, and waits while the lane runs.
  - **It writes a fact into the thread:** a `pineta.update` message listing
    the commits that came in and the files that changed, which the model
    reads at its next run. The merge is recorded as that entry's revision, so
    a branch below it starts with the merged files. Without the entry, the
    agent would work from files it no longer has.
  - **A clean merge prefills your composer** with an editable intent, such as
    "I've merged my latest work (3 commits). Check that yours still fits."
    Nothing runs unless you send it.
  - **A conflicted merge offers "Resolve in the thread":** ADR-0033's
    resolution run, unchanged: labelled sides, the resolution skill, and the
    repository's verdict.
- **"Split into a stack" rewrites an offer as a series of revisions.** It is
  a run on the lane, under a replaceable skill, `offer-stack`, read from your
  working copy as `resolve-conflicts` is (ADR-0033): how to split, how to
  describe each step, and which checks each step must pass. The stack is
  built in the lane from its fork point. The host accepts it only when its
  top has exactly the lane tip's files (S48 item 12), runs any checks the
  skill names, and reports which steps fail; the agent's claim is never
  enough. "Squash to one" returns to a single commit. Turns after a split
  make the stack stale: split again, or take the stack with the rest as one
  more commit.
- **The column shows one state and its buttons:**

  | state | the column says | buttons |
  |---|---|---|
  | nothing new since the start or the last take | nothing | Update from my work (menu) |
  | running | "offer updates after each turn" | Stop |
  | ready | "offer: N files · `pineta-offer/<lane>`" | **Take**, Split into a stack, Update from my work (menu) |
  | ready, touching files you are editing | the same, and "conflicts expected in your edits" | the same |
  | conflicts with your work | "conflicts with your work in N files" | **Resolve in the thread**, Take anyway |
  | resolving or splitting | the run | Stop |
  | needs you | the agent's question | a reply; Take anyway |
  | stack ready | "offer: a stack of K" | **Take stack**, Squash to one |
  | stack stale | "a stack of K, and changes since" | Split again, Take stack and the rest |
  | edited by you | "you edited this offer", and "· conflicts with your edits in N files" when it conflicts (S73) | **Take** ("Take anyway" when it conflicts), Refresh (discards your edits) |
  | taken | "taken as `<change id>`" | none, until the next turn |

  "Land your work" and "take into my working copy" are gone. The page header
  counts offers ready, as it counts mentions.

**Consequences.**
- What you take is one commit (or a stack you asked for), mutable, with a
  real description. The lane's turns stay browsable, and out of your log.
- Your op log gains the host's offer operations, marked `pineta-host`,
  instead of one import per turn.
- A clean update costs no run; a conflicted one costs ADR-0033's run, and a
  stack costs one more. Each run that changes files costs one short
  description request.
- Your repo's config is no longer edited, and the host removes Pineta's old
  line from it at startup, after moving each lane's history to its remote
  bookmark (S48 item 21). Commits lanes build on stay immutable in your repo,
  as ADR-0032 wants: remote bookmarks' ancestors are (S48 item 19). Offers are named `pineta-offer/…`, outside
  `pineta/*`, which that line makes immutable (S48 item 14).
- Noticing your jj operations costs a read of your repo's operation head,
  14 ms (S48 item 13).
- An offer can be divergent for one jj command's length, and is repaired.
- A new root thread sees your uncommitted edits, so one started while you
  are mid-change starts mid-change. Branches inside agent work are unchanged.

**Alternatives rejected.**
- The offer on `@`: rewritten by every snapshot, and a take would commit your
  unfinished edits below the thread's.
- Bringing the turn commits into your history ("take with history"): the
  noise this ADR removes. The lane's history is one `jj log` away.
- Deciding who edited an offer from the evolog alone: jj's rebase of the
  offer, caused by your reword below it, is recorded as your operation
  (S48 item 7).
- Finding the host's commit by description after a race: your edit may keep
  the description (S48 item 8).
- Updating the thread at the start of every run: files would change under
  the agent without anyone asking.
- Running the agent after every update: a clean merge is often nothing to
  talk about, and you can send the prefilled line when it is.
- A description from the thread's first request: it says what was asked,
  not what changed.
- The description written by the lane's own agent, as a turn in the thread:
  every thread would end each run with a message about commit messages, in
  its history and its context.
- A description written at every refresh: a refresh changes where the offer
  sits, never what it says.
- Root lanes starting at the `@` commit itself: your `@` becomes divergent.
