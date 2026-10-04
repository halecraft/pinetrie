# `@pineta/repo`: technical notes

This package is your repo as the host reads and writes it: the offers, the
integration line, and lanes' refs in it (ADR-0038, ADR-0060, ADR-0061), all
through one owner (ADR-0065). It declares `@pineta/core`, `@pineta/keeper`
and `@pineta/lanes` (`workspace.test.ts`); `lanes` never imports it. What a
lane also runs, through a `Runner` it is given, stays in `lanes`
(`laneBase`, `REVISION_READ`, `commitsOf`), and this package calls it. The
client may not depend on it.

What an offer or a `line` command means is decided in
`@pineta/rules`, which this package cannot declare: it returns
each decision as a value typed in `@pineta/core` (`core/offers.ts`), this
package reads the facts it is made from and turns it into steps, and the
host connects the two. The rule all three packages keep:

> Core holds the vocabulary (ids, intents, every record's type) and the
> reads of the tree. A format or type that lanes or repo must read, write
> or name lives in core too, since neither can declare @pineta/rules.
> What a stored shape says, and how the host changes it, is
> @pineta/rules', whoever reads it. One client's own in-flight state
> (its moves, held roots, slot repair, commands out) is @pineta/session's.
> What the page draws, and its words, is @pineta/client's.

`index.ts` names its exports: only what other packages use. The separate
reads, the one-read path and the step planners stay inside, so the host
reads an offer only through a gather and runs only the steps a decision
translates to.

## Where things are

- `owner.ts`: `startRepoOwner`, the one writer of your repo.
- `observe.ts`: what an outside change moved, pure: the fingerprint
  (`fingerprintRead`, `parseFingerprint`) and `planObserve`.
- `step.ts`: `RepoStep`, one command on your repo as data.
- `plan.ts`: the steps, pure: the line's setup, land and follow
  (`lineProposal`, `lineSteps`), an offer's build, follow, refresh, repair
  and take, lanes' refs (`laneRefSteps`), a bundle's import
  (`planImport`), where an offer starts (`offerStart`, `takenRevset`), the
  takes' revset (`TAKES`, read with `@pineta/lanes`' `TAKE_ROW` and
  `parseTakes`), and the evolog walk
  (`walkToHost`).
- `run.ts`: the runner factory, private to the package.
- `offer.ts`: the separate reads an offer's facts come from, and a
  review's.
- `offer-gather.ts`: every read an offer step plans from, one per action
  (`gatherOffer`, `gatherPlace`, `gatherRefresh`, `gatherTake`,
  `gatherStack`, `gatherDescribe`), each returning core's facts. Where an
  offer sits is decided here, once, as an `OfferPlace`, and so is the read
  path: a refresh of a lane on the line takes the one read, every other
  gather the separate reads.
- `offer-steps.ts`: a decision into steps, pure (`offerEffects`,
  `rebuildEffects`, `takeEffects`, `describeEffects`), with what the host
  does after (`OfferEffects.after`).
- `offer-repair.ts`: `repairOffer`, the one offer step that reads between
  its steps.
- `line.ts`: the line's facts, a new lane's begin, a WIP's state
  (`wipState`, `readWipState`).
- `shared.ts`: the facts every lane and the line share, per operation.
- `lane-read.ts`: one lane's refresh facts in one `jj log` (`gatherLane`).

## The owner (`owner.ts`, ADR-0065)

**The owner is the only thing that knows the head. Writes run on it, and
everything else reads at the head it last saw.**

- **Commands first, upkeep keyed.** `command` is a step someone waits on;
  `later(key)` is upkeep (`refresh:<lane>`, `line`, `observe`, `shared`), at
  most one queued per key, started only when no command waits
  (`@pineta/keeper`). A command waits for at most the one step running.
- **Only the owner runs a `RepoStep`** (`RepoOps.execute`). The package
  exports no runner: a step gets `RepoOps` (`jj` as the host, `jjAsYou`,
  `git`, `execute`), a read gets `RepoReads`.
- **A write observes at once, inside its step**: `execute` as soon as its
  steps ran, `jjAsYou` as the step ends. A record the step writes after it
  names commits a page may read at once, and a read is pinned to the
  observed head: observed only at the step's end, a page asked for a review
  of a commit its read could not see yet (the browser suite's review,
  caught). A step that only read observes nothing.
- **Pinned reads** (`read`): jj with `--ignore-working-copy --at-op
  <head>`, which writes nothing whatever runs beside it (S87), never queued.
  Before the first observation, a read waits for it. When the head's
  operation is gone (abandoned and collected: jj says "No operation ID
  matching", `operationGone`), the read observes and retries once.
- **Observation** (`later("observe")`, or inline after a write): `jj op log
  --no-graph -n 1 -T id`, which merges divergent heads and names the result
  (S87 item 4). The same id ends it. Else one `jj log`, pinned to that id,
  reads the fingerprint: the line's bookmark, the WIP bookmarks, the
  publish bookmark (`main`, ADR-0076), the offers' bookmarks, the lanes'
  `pineta-*` remote bookmarks, each with its commit (a conflicted one with
  all its targets), and `@`'s commit. A bookmark of yours outside those is
  not read, so moving it moves nothing. The publish bookmark moving is
  `Moved.line`, not `all`: no offer depends on it, so it refreshes the
  line's record alone (`planMarks`). `planObserve` says what moved; the listeners hear it, and the fingerprint
  advances. The first observation reports `all`; a listener that subscribes
  after it hears one `all` of its own.
- **The watch** (`fs.watch` on `op_heads/heads`, S87 items 5 and 6) and a
  `readdir` every 5 s as its backstop: neither starts jj. Heads that are
  exactly the last observed one do nothing; anything else queues an
  observation. `.jj/repo` is a file naming the repo in a secondary
  workspace (`headsDir`). `close()` stops both and refuses every step.
- **`importLane`** is `planImport` as a command: the host's operation
  (`pineta-host`, S87 item 7), in the order the bundles were made.

## Shared facts and one read per lane (`shared.ts`, `lane-read.ts`)

**An operation id names the repo exactly, so what every lane reads at one
operation is read once and kept until the head moves.**

- **`SharedFacts`**, per operation (`RepoOps.shared()`): the line's facts
  (`lineFacts`, for the line's record), the takes on the line (`TAKES`: a
  `Pineta-Source` or `Pineta-Thread` trailer), split into those naming
  sources (`taken`) and those that name none for some lane (`untraced`,
  `untracedLanes`, S97), and the files `@` changes (`editing`). The owner keeps one set, keyed by the head as it
  is at the moment of reading: the one file in the heads directory; any
  other (an outside write, two heads) is observed first. A write in the same
  step observes, so a read after it reads a fresh set.
- **`yourEdits` is `files ∩ editing`**, decided in `offerRecord`
  (`@pineta/rules`): no lane reads `@`. `@` alone moving rewrites every open
  record's from one shared read (`planYourEdits`).
- **A lane on the line is read in one `jj log`** (`laneRead`): its tip, the
  newest commit carrying `Pineta-Base`, the newest line commit in its
  history, the offer's region (`::<bookmark> ~ ::<line>`), and the taken
  commits and this lane's untraced takes not under its base; each row with
  its parents, its flags (`contained_in` each revset: tip, bookmark, region,
  base, under the base, taken, untraced), whether it is divergent or
  conflicted, its files (in the region) and its description as JSON.
  `planLaneRead` (pure) says the base, the start and the offer from them: an
  untraced take above the base makes the start `untraced`. "Under the base" stands for
  `takenRevset`'s `~ ::present(<base source>)`: the base commit merged that
  source, and a taken commit is a line commit.
- **What the rows cannot say is read only when needed:** the start, when a
  taken source above the base names more (`offerStart`); a stack's files,
  and the top's conflicted files when it conflicts, with the files
  conflicted where its ledger says it starts (`startConflictsOf`,
  ADR-0072): `conflictCause` reads both. An unconflicted offer pays
  nothing. Each revision's evolog
  (`sinceHost`) is always read, and whether the lane's work changes any
  file (`workChanges`) unless the start is untraced. The second is asked of
  the lane's own work, never read from the offer's files: those are a diff
  against the target, empty once the line holds the lane's work, which
  still changes files. Read from them, such an offer was withdrawn and built
  again on every observation, without end (S89).
- **What catching up would change** (`readCatchUp`) is read only once the
  base has moved from the lane's base start, and kept (`known`: the page's
  `pineta.base`, as a memo) while the lane's tip and the base's commit stay.
- **The budget:** an unchanged offer's refresh runs at most 3 jj processes
  (`repo.test.ts` counts 3: the read, the evolog, and `workChanges`); S89
  measured 18 before. A lane whose base moved runs two more, once per move.
- **One rule decides both.** `repo.test.ts` holds `gatherLane` beside the
  separate reads (`laneTipIn`, `laneBase`, `startOfOffer`, `readOffer`,
  `workChanges`, `readCatchUp`) at every offer it builds, takes, follows, repairs and
  stacks, and expects the same values. A lane on a WIP reads the separate
  way (`wipFacts`): its target and state need more of your repo. Which way
  a lane is read is `gatherRefresh`'s choice; the host never makes it.
  Whether one read could serve every lane is S100.

## Steps and runners (`step.ts`, `run.ts`)

- **A repo plan never names the root.** It returns `RepoStep`s: `jj` as
  `host` or `you`, or `git`, with its arguments. Only the owner runs them.
  A `RepoStep` has no `in`, so `lanes`' `execute` cannot take one, nor a
  `LaneStep` run here.
- **One runner factory** (`runnerFor`, through `repoCommand`, pure and
  tested as a table) adds what each runner needs: `-R <root>` and jj's
  `--no-pager --color=never` to every jj; as the host,
  `--ignore-working-copy` and `operation.username=pineta-host`, from the
  repo's root, so paths jj prints are the repo's; pinned, `--at-op <id>`
  and `--ignore-working-copy`; as you, nothing more, from the host's own
  directory; git from the repo's root.
- **A plain read can write.** With divergent operation heads, any jj command
  that loads the repo reconciles them, writing an operation and rebasing
  descendants (S57). That is why every read outside the owner is pinned.
- **Startup reads your repo before the owner exists.** `lanes`'
  `prepareHost` and `prepareShared` read it with `jjIn` and git from its
  root: the one exception to "only this package runs jj on your repo". They
  only read, and nothing else runs yet (`packages/lanes/TECHNICAL.md`). The
  lane setup's reads of your jj config (`user.name`) use `jjIn` too: config,
  not the repo.

## Offers in your repo (`offer.ts`, `offer-gather.ts`, `offer-steps.ts`, `plan.ts`, ADR-0038, ADR-0039)

- **The host runs no jj on an offer.** Each of its offer steps is a gather
  here, a decision in `@pineta/rules`, a translation here (`offerEffects` and
  the rest), then the steps on the owner. A decision carries the facts its
  steps need (a `Placed`, the offer, its changes), so each kind has one
  translation and none that runs nothing because a case cannot occur.

- **An offer's bookmark is `pineta-offer/<name>`**, the thread's two-word
  name (`offerBookmark`). Every step finds the offer by it: one built under
  another name is not found, and a new one is built.

- **Every host command on your repo carries `--ignore-working-copy` and
  `--config operation.username=pineta-host`** (`as: "host"`, `RepoOps.jj`): it
  never snapshots your working copy, and the evolog says which commits the
  host made (S48 items 1 and 8). The import of a lane's bundle is the host's
  too (`planImport`), so it is `pineta-host`'s in your op log (S87 item 7),
  and so is publishing (`planPublish`, ADR-0076), which changes no file and
  is anyone's command.
  Updating your files (`planFollow`: `jj rebase -b @ -d <onto>`) is one
  exception, since it changes your files; landing your work is the other: it
  moves the line to your commits, your act, so it runs as you (`as: "you"`,
  `planLand`). The line's config is set as you too: `jj config set` is not
  an operation.
- **The line is immutable** (`immutableHeads`, written to the repo's config
  only by the `line` command's setup): `present(<onto>)`, and the offers on
  it, joined to the repo's own definition. `present()`, or a repo without
  the bookmark fails every jj command (S77 item 3). The host's rewrites of an
  offer pass `--ignore-immutable` (`rewrite`); a bookmark move rewrites
  no commit and needs none (S77 item 7). An immutable head is out of jj's
  default log, so setup adds the offers to the repo's `revsets.log` too
  (`logRevset`), or jj and jjui would not show them (S77 item 8).
- **An offer is built by nonce, never by a commit id kept between steps**
  (`planOffer`): `jj new` has no template, so each commit is named by a
  unique description (`nonceRevset`) until its last step describes it
  (S48 item 18). A step given an old commit id acts on a hidden commit and
  forks the change (S48 item 2).
- **A single offer is a stack of one**: `planOffer` makes one commit per
  source, each with that source's files restored, on the one before; the
  first on the start (a merge when the start names several heads), then all
  rebased onto the target. A stack's sources are the agent's revisions.
- **Where an offer starts is read from the repo** (`startOfOffer`,
  `offerStart`, ADR-0060): `heads(::tip & (<base start> | ::(<sources>)))`.
  The base start is the commit the lane's newest `Pineta-Base` names
  (`laneBase`); for a lane with none, from before the line, the newest line
  commit in the tip's history. The sources are the lane commits that taken
  offers' `Pineta-Source` trailers name, in `::<onto>` and in `::<wip>`
  for a lane on a WIP, minus `::present(<base source>)` (`takenRevset`,
  read by `takenFacts` with the lane's untraced takes), each `present()`: one never fetched here names
  nothing you have. A squash of two taken offers keeps both trailer
  paragraphs, and `trailerValues` reads every one; jj's `trailers` template
  reads only the last (S77 item 6).
- **A source taken below the base's source is not part of the start**
  (S81). `LaneBase.source` is the commit of yours the lane merged whole:
  the one its `Pineta-Base` names (the WIP's commit, never the copy, which
  descends from no taken commit), else `start`. An offer keeps the diff from
  its start's merge to the tip, so a start the target holds as another
  commit is subtracted from the target. A taken commit and a later catch-up
  are both heads, and their merge conflicts wherever the line changed the
  taken lines since: an offer conflicted where its lane had nothing left to
  resolve. `present()` around the base's source keeps a commit lost to
  `jj util gc` from failing every refresh; it then excludes nothing.
- **Every revision of an offer carries the host's trailers and its ledger**
  (`offerMessage`, core's `trailers.ts`): `Pineta-Thread`, `Pineta-Lane`,
  `Pineta-Entry`, then `Pineta-Source: <tip>` and `Pineta-Start`, in one
  paragraph, on its WIP line and kept through a description. The source is
  the lane tip the whole offer holds, a stack's revisions included: taken,
  it says you have that tip.
- **`lineFacts` previews updating your files** (`yours.follow`, S80):
  `git merge-tree --write-tree --name-only --merge-base=<fork point> <onto>
  <@>` exits 1 on conflicts and prints the merged tree, the conflicting
  paths, a blank line, then its messages; the tree against `@`'s names the
  files that change. It writes only a tree object. It reads `@` as last
  snapshotted: the host never snapshots your files. Null when nothing is
  behind, or `@` shares no commit with the line but the root. `-b @`
  moves every head on your work, which the preview counts: `-r` would
  strip them of the commits under them. `yours.conflicts` counts your
  conflicted commits above the line, and lists `@`'s conflicted files.
- **`workChanges`** says whether a lane's work since its start changes any
  file: `none`, `some` or `unknown` (ADR-0067). From one start, `jj diff
  --from <start> --to <tip>`: the diff a build restores, so the two always
  agree. From several, `jj diff -r '(<start>)..<tip>'`, which diffs a range
  from its roots' parents, merged, to its tip. jj refuses a range with gaps,
  as after a catch-up merged a take (S97): the merge is in the range and
  one of its parents is not. A refusal, or no start, is `unknown`, which
  never builds an offer.
- **An untraced take** is one whose paragraph names a thread and a lane but
  no source (`untracedLanes`, core): a take made before offers carried their
  ledger. Above a lane's base, it makes the lane's start `untraced`
  (`StartRead`), since no start can leave out what it brought: nothing is
  offered until the lane catches up past it, which puts it under the base.
  A turn's commit names no thread, so it is never one. Only the lane's own
  takes are matched, by `Pineta-Lane`: an untraced take of a lane it forked
  from is not found.
- **An untraced place leaves a gap** (`untouched`, ADR-0067): on a lane
  whose start is untraced, a divergent offer is not repaired and an offer
  you edited is not recorded again; nothing runs, and its record stays as
  it was, until the lane catches up past the take. Only an offer the host
  made is withdrawn there. `RefreshDecision` names it, so nothing reaches
  it by accident.
- **`catchUpFiles`** says which files catching up would change in a lane:
  those the base changed between the lane's base start and its commit now
  (`jj diff --from <start> --to <to>`) that the lane's tip does not hold as
  the base does (`jj diff --from <tip> --to <to>`). A three-way merge from
  the start changes no other file. For a WIP, `to` is the WIP's commit: the
  copy the update makes has its files. `repo.test.ts` holds it against
  `mergeUpdate`'s files on the line and on a WIP, and against your own take
  (none).
- **`startOfOffer` is the one path to a start**, or to `untraced`. Every
  gather reaches it, the one read included (`gatherLane`'s `offerStart`
  read): the host's refresh, its `squash` and `refresh` actions and
  `stackSpan` all plan from it: a start from
  another rule would read as a moved start to `planRefresh`, and a split
  would build on it. The exclusion above is inside it: sources read any
  other way bring S81's conflicted start back.
- **An offer follows its lane in place** (`planFollowOffer`, S49): `rebase -s`
  back onto the start, `restore --from <tip>`, `rebase -s` onto the target.
  Restoring where it sits would give it the tip's tree, dropping your work
  under it. The change id and bookmark stay, and jj records no operation for
  a restore that changes nothing. `planOffer` and the follow both end with
  `planRefreshOffer`'s rebase.
- **A take is a forward bookmark move** (`planTakeOffer`, ADR-0060): `jj
  bookmark move <destination> --to <top>` as the host, then the offer's
  bookmark deleted. It never rebases and never touches your `@`. A take, a
  land and a publish each move a bookmark with `moveForward`, which never
  passes `--allow-backwards`: jj refuses a move that is not forward, so a
  stale move fails rather than drops commits (S77 item 1). A colocated
  repo's git ref follows a host move made with `--ignore-working-copy`
  (`repo.test.ts`, publish).
- **`readOffer` reads an offer from your repo alone** (`OfferInRepo`,
  ADR-0060): nothing the host remembers is needed, so a lost record costs
  nothing. Its revisions (`offerRevisions`) are what is under the bookmark,
  not already under the target, and carries the thread's trailer:
  `(::<bookmark> ~ ::<target>) & (description(regex:"(?m)^Pineta-Thread:
  <name>$") | <bookmark>)`. A conflicted offer's `startConflicts` are the
  files conflicted at each commit its `Pineta-Start` names
  (`startConflictsOf`, shared with `gatherLane`); a start your repo lacks
  names none. A taken offer below carries the same trailer, but
  is under the target; your commits carry none. The bookmark's own commit
  is always the top. A conflicted bookmark, or a change id naming two
  commits, reads as divergent, with only the change ids. Every read after
  the first names commits (S48 item 2). It returns facts, and the bookmark it
  found them under; `planRefresh`, `offerEdited` and `offerMoved`
  (`@pineta/rules`) decide what they mean.
- **Every revision's evolog is read, back to the host's newest version**
  (`evologOf`, one `jj evolog -T EVOLOG_ENTRY`; `walkToHost`, pure),
  through each version's predecessor of the same change. Each version an
  operation not the host's made on the way is checked with `sameAs` (the
  description and `jj interdiff`) against the one before it. A rebase jj
  made because you reworded a commit below is your operation (S48 item 7),
  and changes nothing, so it is not an edit. The newest entry is usually
  the host's, so the walk usually stops at once.
- **A review reads by commit id** (ADR-0047): `revisionRead` runs
  `jj log -r <commit> -T REVISION_READ` and returns the parsed JSON,
  unchecked (the host decodes it), and `fileDiff` runs `jj diff --git -r
  <commit> -- root-file:"<path>"`. `REVISION_READ` prints `RevisionReview`'s
  wire shape, `json()` quoting every string (S57). A rename reads by its
  new path, with `{old => new}` as its display path; a binary file reads as
  0 and 0. The diff's path is `root-file:`: a bare path is read from the
  process's directory, and `root:` matches every file under a directory of
  that name. A commit id names one commit, so neither resolves a change id
  or meets a divergent one.
- **A range reads in two commands** (ADR-0056, S70): `jj diff --from --to
  -T RANGE_FILES` gives each file's path, display path and status, one JSON
  object a line, since a `TreeDiffEntry` has no line counts; `jj diff
  --from --to --git` gives the counts, one `diff --git` section per file in
  the same order (`gitDiffCounts`). The two must list as many files, or the
  read fails. A range has no description. `fileDiff` reads a range with
  `--from --to`. A commit stays readable by id after it is abandoned, so a
  lane's revisions can be read after a take or a split.
- **`hostCommitIn`** splits a divergent revision's commits by the user of
  each one's newest evolog operation (`evologOf` with a limit of 1,
  `isHostUser`): the host's is abandoned, yours kept.

## Tests

- **`plan.test.ts`**: the planners, as `jj as host: …`, `jj as you: …` and
  `git …` strings; `walkToHost` over parsed evologs; `repoCommand`'s
  table; and `planObserve` and the fingerprint's parse, as tables.
- **`owner.test.ts`**: the owner against real jj, in throwaway repos: the
  first observation is `all`; a command behind a slow upkeep step runs
  before the upkeep behind it; its own write moves only what it moved, and
  a read in the same step, or after it, sees it; a step that only read
  observes nothing; your `jj describe` is seen through the watch with no
  timer; a pinned read leaves two heads two, and an observation merges
  them; jj's words for an operation that is gone. Only a test of the watch
  writes to the repo while an owner is live: the watch merges two heads, so
  a test that counts them makes them (`diverge`) before an owner starts, or
  after it is closed and idle. Otherwise, the count races the watch, and
  the test fails under load.
- **`repo.test.ts`**: a lane's whole life against jj and git, in throwaway
  repos on the host, with no container: the lane's steps from `lanes`, its
  bundle fetched into your repo (`planBundle`, then `planImport`, whose
  operation is `pineta-host`'s), and every read and plan here. It covers the
  base, a turn, an update with a conflict, forks from a turn and from a copy
  of your `@`, checked for divergence and immutability, and a repo beside a
  fork that the fork's config leaves alone; a commit the agent makes itself,
  with jj and with git, reaching the offer and a branch at its turn, and an
  update merging on it, while a stack's commits are never adopted; an offer
  built, refreshed, left, rewritten by the host with its record lost (S73),
  repaired, taken under your edits and beside them, the next offer, and a
  stack; an offer following a moved tip, your conflicting commit and a moved
  start, each checked against a fresh build; an offer after you committed
  your edits differently, after a taken branch that holds the lane's tip,
  from a branch whose parent was taken after the fork (S72), and from a lane
  after a branch of it was taken before its update (S51, S72); an untraced
  take, read either way until the lane catches up past it, and what catching
  up changes against what the merge changed (S97); and a review of an
  offer's commit (its description, a rename, names with a space and a
  quote, and one file's diff, never a directory's). The gathers are held to
  it as well: each place kind (placed, untraced, a WIP gone), what a take
  reads on a WIP (`gatherTake`), a split's stack bottom first
  (`gatherStack`), `repairOffer` on a divergent offer, and that
  `trailerRevset` finds exactly the commits `hasTrailer` matches. And a
  catch-up past a take of the lane's own work, of its parent's, two takes,
  a conflict both sides made, and a take you edited (S102): the lane holds
  the take's source, so the take is joined to it and the update is clean.
- **`offer-steps.test.ts`**: each decision's steps, as the planners make
  them, and that each `after` carries the decision's place.
- **`apps/pineta/host/offers/refresh.test.ts`** runs the host's own refresh
  (`createRefresh`, a real owner) on the histories S97 found, until a round
  writes nothing: it lives with the host, since this package may not import
  `planRefresh` (`workspace.test.ts`).
- Mutations are in `scripts/mutations/repo.ts`.
