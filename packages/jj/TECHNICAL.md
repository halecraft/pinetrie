# `@pinetrie/jj`: technical notes

This package is jj's adapter, whole (ADR-0142): your repo as the host reads
and writes it (the proposed changes, the accepted work, and lanes' refs in it,
ADR-0105, ADR-0104, ADR-0061, all through one owner, ADR-0065); each lane's
own repo, as the `LaneHistory` port `@pinetrie/lanes` defines (A lane's
repo); your repo at startup (`startup.ts`: finding its root, the shared
directories and their exclude lines, your repo's names); and every jj name
(`bookmarkName`, `laneTipName`, `proposedBookmark`, `DEFAULT_REPO`). It declares
`@pinetrie/core`, `@pinetrie/keeper` and `@pinetrie/lanes`
(`workspace.test.ts`); `lanes` never imports it, and runs no jj
(`packages/lanes/boundary.test.ts`). The host wires it as an adapter
(`apps/pinetrie/host/jj/`), chosen by the project's kind
(`apps/pinetrie/host/project.ts`). The client may not depend on it.

What proposed changes or a setup or publish means is decided in
`@pinetrie/rules`, which this package cannot declare: it returns
each decision as a value typed in `@pinetrie/core` (`core/proposed.ts`), this
package reads the facts it is made from and turns it into steps, and the
host connects the two. The rule all three packages keep:

> Core holds the vocabulary (ids, intents, every record's type) and the
> reads of the tree. A format or type that lanes or jj must read, write
> or name lives in core too, since neither can declare @pinetrie/rules.
> What a stored shape says, and how the host changes it, is
> @pinetrie/rules', whoever reads it. One client's own in-flight state
> (its moves, held roots, slot repair, commands out) is
> @pinetrie/session's. What a person sees and can do, and its words, is
> @pinetrie/interface's, for any client; how the page draws it is
> @pinetrie/web's (ADR-0093).

`index.ts` names its exports of your repo: only what other packages use;
a lane's repo (`lane/`) it exports whole. The separate
reads, the one-read path and the step planners stay inside, so the host
reads proposed changes only through a gather and runs only the steps a decision
translates to.

## Where things are

- `owner.ts`: `startRepoOwner`, the one writer of your repo.
- `observe.ts`: what an outside change moved, pure: the fingerprint
  (`fingerprintRead`, `parseFingerprint`) and `planObserve`.
- `step.ts`: `RepoStep`, one command on your repo as data.
- `plan.ts`: the steps, pure: accepted work's setup (`setupProposal`,
  `planSetup`), a publish's catch-up, move and undo
  (`planPublishCatchUp`, `planPublishMove`, `planCatchUpUndo`, ADR-0090),
  proposed changes' build, rebuild, refresh, repair
  and acceptance, lanes' refs (`laneRefSteps`), a bundle's import
  (`planImport`), where proposed changes start (`proposedStart`, `acceptedThreadCommitsRevset`), the
  accepted thread commits' revset (`ACCEPTED_THREAD_COMMITS`, read with `@pinetrie/lanes`' `ACCEPTED_THREAD_COMMIT_ROW` and
  `parseAcceptedThreadCommits`), and the evolog walk
  (`walkToHost`).
- `run.ts`: the runner factory, private to the package.
- `proposed.ts`: the separate reads proposed changes' facts come from, and a
  review's.
- `proposed-gather.ts`: every read a step on proposed changes plans from, one per action
  (`gatherProposedChanges`, `gatherPlace`, `gatherRefresh`, `gatherAcceptance`,
  `gatherStack`, `gatherDescribe`), each returning core's facts. Where proposed changes sit is decided here, once, as an `ProposedChangesPlace`, and so is the read
  path: a refresh of a lane on accepted work takes the one read, every other
  gather the separate reads.
- `proposed-steps.ts`: a decision into steps, pure (`proposedChangesEffects`,
  `rebuildEffects`, `acceptanceEffects`, `describeEffects`), with what the host
  does after (`ProposedChangesEffects.after`).
- `proposed-repair.ts`: `repairProposedChanges`, the one step on proposed changes that read between
  its steps.
- `accepted.ts`: accepted work's facts, a new lane's begin, a WIP's state
  (`wipState`, `readWipState`).
- `shared.ts`: the facts every lane and accepted work share, per operation.
- `lane-read.ts`: one lane's refresh facts in one `jj log` (`gatherLane`).
- `catch-up.ts`: what catching up would change in a lane, its rules and
  its read (`readCatchUp`).
- `file-at.ts`: a file at accepted work, at a lane's tip or at its start
  (`readRepoFile`), the destination's read of `pinetrie.json`.
- `tidy.ts`: `pnpm tidy`'s core (ADR-0155): your op log as facts
  (`readOpLog`), the tidy planned from them (`planTidy`), whether a jj
  command raced it (`isTidyRaced`), the startup line's facts
  (`planTidyHint`), and its gather and steps' runner.
- `startup.ts`: your repo before its owner starts. `prepareProjectDir`
  gathers the root's facts (`jj root`, else git's top level) and plans them
  (`planProjectDir`, `@pinetrie/lanes`), and writes nothing: pine·trie
  keeps its files in the session's directory (ADR-0150). A jj repo with
  no git directory beside it (`git rev-parse --git-dir` from its root
  fails) is refused, `not-colocated` (S108), since lanes' history reaches
  your repo through git. `server.ts` runs it before the session opens, and
  `startHost` again (ADR-0086). `prepareShared` is the shell around
  `planShared`: jj, not git's index, says what is tracked (in a colocated
  repo the index can lag), and it adds unignored shared directories to the
  exclude file, the only lines pine·trie writes in your repo. The lanes'
  ignore file is the host's, not this package's. It takes one list, the
  settled `lanes.shared`. Your repo's
  names (`RepoConfig`, in core, so the host's adapter and this package share
  one shape) are the host's settled values; `isBookmarkName` is
  the parser their kinds wrap. `revisionRead` compares two copies of
  `pinetrie.json` with the host's decoder (`decodeAuthority`), since jj
  declares no config.
- `lane/`: a lane's own repo. `history.ts` (`jjLaneHistory`, the
  `LaneHistory`), `fetch-plan.ts` (`planFetch`: which commits a move's fetch
  into your repo may leave out), `plan.ts` (a fork's setup, the base's
  checkout, a merge's steps and joins, a turn's commit, a bundle, the
  `pre-rename:` renames), `revisions.ts`, `merge.ts`, `bookmarks.ts`,
  `base.ts` (`laneBase`), `names.ts`, `run.ts` (`laneJj`, `jjIn`) and
  `points.ts` (a lane proven jj, and the one way from a point to a commit).
- `fixtures.ts`: what the tests share: a lane's record proven jj
  (`jjLaneFor`).

## The owner (`owner.ts`, ADR-0065)

**The owner is the only thing that knows the head. Writes run on it, and
everything else reads at the head it last saw.**

- **Commands first, upkeep keyed.** `command` is a step someone waits on;
  `later(key)` is upkeep (`refresh:<lane>`, `line`, `observe`, `shared`), at
  most one queued per key, started only when no command waits
  (`@pinetrie/keeper`). A command waits for at most the one step running.
- **Every command the owner runs is timed** (`runnerFor`'s `watch`, which
  every owner runner and its `executeRepo` share): one longer than
  `slowCommandMs` (500 ms) goes to `onSlowCommand`, by the arguments its
  caller gave, with no runner flags. A slow step (`onSlow`) then names the
  command that made it slow.
- **Only the owner runs a `RepoStep`** (`RepoOps.execute`), but for a
  tidy's (`executeTidy`), which runs while no host, and so no owner, serves
  the repo. The package exports no other runner: a step gets `RepoOps` (`jj`
  as the host, `jjAsYou`, `git`, `execute`), a read gets `RepoReads`.
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
  reads the fingerprint: accepted work's bookmark, the WIP bookmarks, the
  publish bookmark (`main`, ADR-0076), the proposed changes' bookmarks, the lanes'
  `pinetrie-*` remote bookmarks, each with its commit (a conflicted one with
  all its targets), and `@`'s commit. A bookmark of yours outside those is
  not read, so moving it moves nothing. The publish bookmark moving is
  `Moved.published`, not `all`: no proposed changes depend on it, so it refreshes
  accepted work's record alone (`planMarks`). Accepted work's bookmark
  moving is also `Moved.acceptedMoved`, which the host's base snapshot
  follows (ADR-0090), wherever the move came from. `planObserve` says what
  moved; the listeners hear it, and the fingerprint advances. The first
  observation reports `all`, and not `acceptedMoved`, since startup reads
  the base itself; a listener that subscribes after it hears one `all` of
  its own, likewise without `acceptedMoved`.
- **The watch** (`fs.watch` on `op_heads/heads`, S87 items 5 and 6) and a
  `readdir` every 5 s as its backstop: neither starts jj. Heads that are
  exactly the last observed one do nothing; anything else queues an
  observation. `.jj/repo` is a file naming the repo in a secondary
  workspace (`headsDir`). `close()` stops both and refuses every step.
- **`importLane`** is `planImport` as a command: the host's operation
  (`pinetrie-host`, S87 item 7), in the order the bundles were made. Its
  `jj git import` passes `--ignore-working-copy`, which leaves your working
  copy unsnapshotted: 12-47 ms, against about 100 ms with the snapshot (S44
  item 8).

## Shared facts and one read per lane (`shared.ts`, `lane-read.ts`)

**An operation id names the repo exactly, so what every lane reads at one
operation is read once and kept until the head moves.**

- **A lane with no ref in your repo is `"none"`** to `gatherLane` and
  `gatherRefresh`: one that never committed was never fetched. No
  `pinetrie.base` is written for it, and the page reads catching up as
  `unknown` (`catchUpNow`, `@pinetrie/rules`), never as caught up.
- **`SharedFacts`**, per operation (`RepoOps.shared()`): accepted work's facts
  (`acceptedFacts`, for accepted work's record), the accepted thread commits on the
  line (`ACCEPTED_THREAD_COMMITS`: a `Pinetrie-Source` or `Pinetrie-Thread`
  trailer), split into those naming sources (`acceptedThreadCommits`) and
  those that name none for some lane (`untraced`,
  `untracedLanes`, S97), and the files `@` changes (`editing`). The owner keeps one set, keyed by the head as it
  is at the moment of reading: the one file in the heads directory; any
  other (an outside write, two heads) is observed first. A write in the same
  step observes, so a read after it reads a fresh set.
- **`yourEdits` is `files ∩ editing`**, decided in `proposedChangesRecord`
  (`@pinetrie/rules`): no lane reads `@`. `@` alone moving rewrites every open
  record's from one shared read (`planYourEdits`).
- **A lane on accepted work is read in one `jj log`** (`laneRead`): its tip, the
  newest commit carrying `Pinetrie-Base`, the newest accepted commit in its
  history, the proposed changes' region (`::<bookmark> ~ ::<line>`), and the
  accepted thread commits and this lane's untraced ones not under its base; each row with
  its parents, its flags (`contained_in` each revset: tip, bookmark, region,
  base, under the base, accepted, untraced), whether it is divergent or
  conflicted, its files (in the region) and its description as JSON.
  `planLaneRead` (pure) says the base, the start and the proposed changes from them: an
  untraced accepted thread commit above the base makes the start `untraced`. "Under the base" stands for
  `acceptedThreadCommitsRevset`'s `~ ::present(<base source>)`: the base commit merged that
  source, and an accepted thread commit is a accepted commit.
- **What the rows cannot say is read only when needed:** the start, when a
  accepted source above the base names more (`readStart`); a stack's files,
  and the top's conflicted files when it conflicts, with the files
  conflicted where its ledger says it starts (`readStartConflicts`,
  ADR-0072): `conflictCause` reads both. An unconflicted proposed changes pays
  nothing. Proposed changes whose top are the host's version (the row's `H` flag)
  reads nothing more about who made it; any other reads each revision's
  evolog (`revisionSinceHost`). Whether the lane's work changes any
  file (`filesTouched`) is read unless the start is untraced. The second is asked of
  the lane's own work, never read from the proposed changes' files: those are a diff
  against the target, empty once accepted work holds the lane's work, which
  still changes files. Read from them, such proposed changes were withdrawn and built
  again on every observation, without end (S89).
- **The budget:** unchanged proposed changes' refresh runs at most 2 jj processes,
  and no evolog (`repo.test.ts` counts 2: the read and `filesTouched`);
  S89 measured 18 before, and 3 with the evolog (ADR-0154). A lane whose base moved runs two more, once per move,
  and one more for each further head of its proposed changes' start.
- **One rule decides both.** `repo.test.ts` holds `gatherLane` beside the
  separate reads (`laneTipIn`, `laneBase`, `startOfProposed`, `readProposedChanges`,
  `filesTouched`, `readCatchUp`) at every proposed changes it builds, accepts, follows, repairs and
  stacks, and expects the same values. A lane on a WIP reads the separate
  way (`wipFacts`): its target and state need more of your repo. Which way
  a lane is read is `gatherRefresh`'s choice; the host never makes it.
  Whether one read could serve every lane is S100.

## What catching up would change (`catch-up.ts`, S97, S102)

**The page's ↓, a base's news and `catch_up`'s refusals read one forecast,
made in your repo before any update runs, and it must name the files the
update's merge will change.**

- **One module, rules beside the read** (as `planLaneRead` beside
  `gatherLane`): `planCatchUpRead`, `catchUpHolds` and `catchUpChangedFiles`
  are pure; `catchUpFiles` reads the diffs and `readCatchUp` runs the rest.
  Both gathers call `readCatchUp`: `gatherLane`, and `placeOf` for every
  other gather.
- **The target is one value** (`CatchUpTarget`): accepted work's commit,
  merged, or a WIP's commit, copied. `placeOf` builds it from the WIP's
  state, a landed WIP's update merging accepted work; `gatherLane` reads
  lanes on accepted work only. The stored `CatchUpRead.to` is its commit.
- **Read once per move.** It is read only once the base has moved from the
  lane's base start, and kept (`known`: the page's `pinetrie.base`, as a
  memo) while the lane's tip and the target's commit stay: `planCatchUpRead`
  decides. The commits it diffs from are decided from the tip and the base,
  so the memo needs no other key.
- **The forecast diffs from where the next proposed changes would start**
  (`catchUpHolds`, S102 item 11). It names the files
  catching up would change in a lane: those the base's commit `to` has
  differently from each commit the lane holds of its history
  (`jj diff --from <held> --to <to>`), and from the lane's tip
  (`jj diff --from <tip> --to <to>`), decided by `catchUpChangedFiles`. On
  accepted work the held commits are the proposed changes' start, which holds every
  accepted source the lane has: the sources `mergeBase` joins before it
  merges, so an acceptance of the lane's own work counts for nothing even
  after the lane edited it again. Diffed from the base's start instead, it
  counted every file the lane touched since. The start has two heads when
  the lane caught up between its proposed changes and the acceptance (the base's
  commit and the source). A file then counts only when `to` differs from
  both. A union would count every file of the acceptance again, and the
  intersection misses a file only when accepted work puts it back to the
  base's exactly. A WIP's copy, and an untraced start, diff from the base's
  start: for a WIP the target is the WIP's commit, and the copy has its
  files.
  `repo.test.ts` holds it against `mergeUpdate`'s files on accepted work
  and on a WIP, your own acceptance, the lane editing it again, and the
  start with two heads.
- **Read as the merge reads its files** (`changedPaths`, `@pinetrie/lanes`),
  from the repo's root, so the forecast and `mergeUpdate`'s `files`
  compare; a jj failure is null, which the page reads as `unknown`.

## Steps and runners (`step.ts`, `run.ts`)

- **A repo plan never names the root.** It returns `RepoStep`s: `jj` as
  `host` or `you`, or `git`, with its arguments. Only the owner runs them.
  A `RepoStep` has no `in`, so `lanes`' `execute` cannot take one, nor a
  `LaneStep` run here.
- **One runner factory** (`runnerFor`, through `repoCommand`, pure and
  tested as a table) adds what each runner needs: `-R <root>` and jj's
  `--no-pager --color=never` to every jj; as the host,
  `--ignore-working-copy` and `operation.username=pinetrie-host`, from the
  repo's root, so paths jj prints are the repo's; pinned, `--at-op <id>`
  and `--ignore-working-copy`; as you, nothing more, from the host's own
  directory; git from the repo's root.
- **A plain read can write.** With divergent operation heads, any jj command
  that loads the repo reconciles them, writing an operation and rebasing
  descendants (S57). That is why every read outside the owner is pinned.
- **Startup reads your repo before the owner exists** (`startup.ts`):
  `prepareProjectDir` and `prepareShared` read it with `jjIn` and git from
  its root, and only `prepareShared` writes, to its exclude file; nothing
  else runs yet. The
  adapter's `identity` reads your jj config (`user.name`) with `jjIn` too:
  config, not the repo.

## Proposed changes in your repo (`proposed.ts`, `proposed-gather.ts`, `proposed-steps.ts`, `plan.ts`, ADR-0105, ADR-0039)

- **The host runs no jj on proposed changes.** Each of its steps on proposed changes are a gather
  here, a decision in `@pinetrie/rules`, a translation here (`proposedChangesEffects` and
  the rest), then the steps on the owner. A decision carries the facts its
  steps need (a `Placed`, the proposed changes, its changes), so each kind has one
  translation and none that runs nothing because a case cannot occur.

- **Proposed changes' bookmark is `pinetrie-proposed/<name>`**, the thread's two-word
  name (`proposedBookmark`). Every step finds the proposed changes by it: one built under
  another name is not found, and a new one is built.

- **Every host command on your repo carries `--ignore-working-copy` and
  `--config operation.username=pinetrie-host`** (`as: "host"`, `RepoOps.jj`): it
  never snapshots your working copy, and the evolog says which commits the
  host made (S48 items 1 and 8). The import of a lane's bundle is the host's
  too (`planImport`), so it is `pinetrie-host`'s in your op log (S87 item 7),
  and so is a publish's move of the publish bookmark alone
  (`planPublishMove`, ADR-0076), which changes no file and is anyone's
  command.
  A publish's catch-up (`planPublishCatchUp`: `jj rebase -b @ -d <accepted>`) is
  one exception, since it changes the working copy; an accepting move is the
  other: `jj bookmark move <accepted> <publish> --to @-` moves accepted work to your
  commits, your act, so it runs as you (`as: "you"`, ADR-0090), and its
  undo (`planCatchUpUndo`) too. Accepted work's config is set as you too: `jj
  config set` is not an operation.
- **A publish's undo is `jj op revert` of the catch-up's operation, never
  `jj op restore`** (S111): a restore to the operation before deletes from
  disk an edit made since, where a revert keeps it (an edit in between
  leaves `@` divergent, which the window of one jj process makes rare).
  The operation is `SharedFacts.op` after the catch-up's `execute`
  observed it. Two bookmarks in one `jj bookmark move` move in one
  operation, and a refusal of either moves neither (S111), so the move
  itself needs no undo.
- **Accepted work is immutable** (`immutableHeads`, written to the repo's config
  only by setup): `present(<accepted>)`, and the proposed changes on
  it, joined to the repo's own definition. `present()`, or a repo without
  the bookmark fails every jj command (S77 item 3). The host's rewrites of proposed changes pass `--ignore-immutable` (`rewrite`); a bookmark move rewrites
  no commit and needs none (S77 item 7). An immutable head is out of jj's
  default log, so setup adds the proposed changes to the repo's `revsets.log` too
  (`logRevset`), or jj and jjui would not show them (S77 item 8).
- **Proposed changes are built by nonce, never by a commit id kept between steps**
  (`planProposedChanges`): `jj new` has no template, so each commit is named by a
  unique description (`nonceRevset`) until its last step describes it
  (S48 item 18). A step given an old commit id acts on a hidden commit and
  forks the change (S48 item 2).
- **Single proposed changes are a stack of one**: `planProposedChanges` makes one commit per
  source, each with that source's files restored, on the one before; the
  first on the start (a merge when the start names several heads), then all
  rebased onto the target. A stack's sources are the agent's revisions.
- **Where proposed changes start is read from the repo** (`startOfProposed`,
  `proposedStart`, ADR-0104): `heads(::tip & (<base start> | ::(<sources>)))`.
  The base start is the commit the lane's newest `Pinetrie-Base` names
  (`laneBase`); for a lane with none, from before accepted work, the newest line
  commit in the tip's history. The sources are the lane commits that
  accepted proposed changes' `Pinetrie-Source` trailers name, in `::<accepted>` and in `::<wip>`
  for a lane on a WIP, minus `::present(<base source>)` (`acceptedThreadCommitsRevset`,
  read by `acceptedThreadCommitFacts` with the lane's untraced ones), each `present()`: one never fetched here names
  nothing you have. A squash of two accepted proposed changes keep both trailer
  paragraphs, and `trailerValues` reads every one; jj's `trailers` template
  reads only the last (S77 item 6).
- **Every trailer revset also matches `Pineta-*`** (`pre-rename:`, core's
  `trailers.ts`): proposed changes accepted before the rename carry `Pineta-Source`,
  and an old lane's next proposed changes would otherwise start below them and put
  their files back over yours (`repo.test.ts`, pre-rename). A `Pineta-Base`
  on `pineta-onto` reads as accepted work, as any base off the WIP prefix
  does (`messageBase`, ADR-0100).
- **`pre-proposed:` renames each `pinetrie-offer/<name>` to
  `pinetrie-proposed/<name>`, once** (`pre-proposed.ts`, ADR-0156, S217):
  the first command a starting host puts on the owner, before its first
  observation, so the renames mark no refresh. Gathered from one `jj
  bookmark list -a` of the old prefix (a local row, its conflict, and each
  remote's) and the two config values; planned pure
  (`planProposedRename`); executed in this order:
  - one `jj bookmark rename` per old local bookmark whose new name is
    absent. It keeps a conflicted bookmark's sides and adds no evolog
    entry. A name held under both is left, and the startup line says so.
  - `markSteps` of the renamed ones that had a host version and are not
    conflicted, then `forgetSteps` of every old host version whose local
    bookmark was renamed or is gone. A rename leaves the tracked remote
    bookmark under the old name; deleting its ref in git instead would
    abandon what only it held. A conflicted one is marked by its refresh
    once repaired.
  - the old glob (`RETIRED_OFFER_BOOKMARKS`, built as setup built it)
    replaced by `PROPOSED_BOOKMARKS` in `immutable_heads()` and
    `revsets.log`, as you.

  A bookmark under the old prefix on any other remote is yours, pushed:
  left, and named on the startup line. Each step is planned from what the
  repo holds, so a start that stopped part way finishes on the next.
  Delete it once Duane's repo has passed it.
- **A source accepted below the base's source is not part of the start**
  (S81). A base's `source` (`CommitBase`) is the commit of yours the lane merged whole:
  the one its `Pinetrie-Base` names (the WIP's commit, never the copy, which
  descends from no accepted thread commit), else `start`. Proposed changes keep the diff from
  its start's merge to the tip, so a start the target holds as another
  commit is subtracted from the target. An accepted thread commit and a
  later catch-up are both heads, and their merge conflicts wherever accepted work
  changed the accepted lines since: proposed changes conflicted where its lane had nothing left to
  resolve. `present()` around the base's source keeps a commit lost to
  `jj util gc` from failing every refresh; it then excludes nothing.
- **Every revision of proposed changes carry the host's trailers and its ledger**
  (`proposedMessage`, core's `trailers.ts`): `Pinetrie-Thread`, `Pinetrie-Lane`,
  `Pinetrie-Entry`, then `Pinetrie-Source: <tip>` and `Pinetrie-Start`, in one
  paragraph, on its WIP line and kept through a description. The source is
  the lane tip the whole proposed changes hold, a stack's revisions included:
  accepted, it says you have that tip.
- **`acceptedFacts` previews catching the working copy up** (`yours.catchUp`, S80):
  `git merge-tree --write-tree --name-only --merge-base=<fork point> <accepted>
  <@>` exits 1 on conflicts and prints the merged tree, the conflicting
  paths, a blank line, then its messages; the tree against `@`'s names the
  files that change. It writes only a tree object. It reads `@` as last
  snapshotted: the host never snapshots the working copy. Null when nothing is
  behind, or `@` shares no commit with accepted work but the root. `-b @`
  moves every head on your work, which the preview counts: `-r` would
  strip them of the commits under them. `yours.conflicts` counts your
  conflicted commits above accepted work, and lists `@`'s conflicted files; a
  publish's second round reads it again after the catch-up, since a commit
  of yours that `@`'s tree resolves can conflict where the preview of `@`
  says nothing. `yours.ahead` is `::@- ~ ::<accepted>`, whether or not `@-`
  descends from accepted work: what a publish accepts once caught up.
- **`filesTouched`** says whether a lane's work since its start changes any
  file: `none`, `some` or `unknown` (ADR-0067). From one start, `jj diff
  --from <start> --to <tip>`: the diff a build restores, so the two always
  agree. From several, `jj diff -r '(<start>)..<tip>'`, which diffs a range
  from its roots' parents, merged, to its tip. jj refuses a range with gaps,
  as after a catch-up merged an accepted thread commit (S97): the merge is in the range and
  one of its parents is not. A refusal, or an untraced start, is
  `unknown`, which never builds proposed changes. A known start is never empty
  (`NonEmpty`, core): `readStart` reads `proposedStart`'s heads, which hold
  the base's start, since `laneBase` reads it from the tip's own history.
- **An untraced accepted thread commit** is one whose paragraph names a
  thread and a lane but no source (`untracedLanes`, core): proposed changes
  accepted before proposed changes carried their ledger. Above a lane's base, it makes the lane's start `untraced`
  (`StartRead`), since no start can leave out what it brought: nothing is
  proposed until the lane catches up past it, which puts it under the base.
  A turn's commit names no thread, so it is never one. Only the lane's own
  accepted thread commits are matched, by `Pinetrie-Lane`: an untraced one of
  a lane it forked from is not found.
- **An untraced place leaves a gap** (`untouched`, ADR-0067): on a lane
  whose start is untraced, divergent proposed changes are not repaired and proposed changes
  you edited is not recorded again; nothing runs, and its record stays as
  it was, until the lane catches up past the accepted thread commit. Only proposed changes the host
  made is withdrawn there. `RefreshDecision` names it, so nothing reaches
  it by accident.
- **`startOfProposed` is the one path to a start**, or to `untraced`. Every
  gather reaches it, the one read included (`gatherLane`'s `readStart`,
  which `startOfProposed` reads its start with too): the host's refresh, its `squash` and `refresh` actions and
  `stackSpan` all plan from it: a start from
  another rule would read as a moved start to `planRefresh`, and a split
  would build on it. The exclusion above is inside it: sources read any
  other way bring S81's conflicted start back.
- **Proposed changes are rebuilt from its lane in place** (`planRebuildProposed`, S49): `rebase -s`
  back onto the start, `restore --from <tip>`, `rebase -s` onto the target.
  Restoring where it sits would give it the tip's tree, dropping your work
  under it. The change id and bookmark stay, and jj records no operation for
  a restore that changes nothing. `planProposedChanges` and the rebuild both end with
  `planRefreshProposed`'s rebase.
- **An acceptance is a forward bookmark move**
  (`planAcceptanceSteps`, ADR-0104): `jj bookmark move <destination>
  --to <top>` as the host, then the proposed changes' bookmark and the host's version
  forgotten (`forgetSteps`), once the destination holds the proposed changes. It never
  rebases and never touches your `@`. An acceptance and a publish each move bookmarks with `moveForward`, which never
  passes `--allow-backwards`: jj refuses a move that is not forward, so a
  stale move fails rather than drops commits (S77 item 1). A colocated
  repo's git ref follows a host move made with `--ignore-working-copy`
  (`repo.test.ts`, publish).
- **An archived lane's history is parked** (`laneRefSteps`,
  `laneParkedRef`): before its ref is deleted, `git fetch . +<tip ref>*:<park>*`
  copies it under `refs/pinetrie/archived/<lane>`, which jj does not import
  and git keeps through a gc. The pattern matches nothing for a lane never
  fetched, where an `update-ref` from a missing ref would fail. A restore
  writes the tip ref, then deletes the park.
- **`readProposedChanges` reads proposed changes from your repo alone** (`ProposedChangesInRepo`,
  ADR-0104): nothing the host remembers is needed, so a lost record costs
  nothing. Its revisions (`proposedRevisions`) are what is under the bookmark,
  not already under the target, and carries the thread's trailer:
  `(::<bookmark> ~ ::<target>) & (description(regex:"(?m)^Pinetrie-Thread:
  <name>$") | <bookmark>)`. Conflicted proposed changes' `startConflicts` are the
  files conflicted at each commit its `Pinetrie-Start` names
  (`readStartConflicts`, shared with `gatherLane`); a start your repo lacks
  names none. Accepted proposed changes below carry the same trailer, but
  is under the target; your commits carry none. The bookmark's own commit
  is always the top. A conflicted bookmark, or a change id naming two
  commits, reads as divergent, with only the change ids. Every read after
  the first names commits (S48 item 2). It returns facts, and the bookmark it
  found them under; `planRefresh`, `isProposedEdited` and `isProposedMoved`
  (`@pinetrie/rules`) decide what they mean.
- **The host's version of each proposed changes are a tracked remote bookmark,
  `pinetrie-proposed/<name>@pinetrie-host`** (ADR-0154, S215 items 10, 11 and
  18; `HOST_REMOTE`, `hostProposedRef`, `hostProposedRevset`). Its top equal to the
  bookmark's (`ProposedChangesNow.marked`) is the whole stack the host's, since a
  commit id hashes all below it: nothing more is read. jj shows proposed changes
  you changed as `pinetrie-proposed/<name>*`. The ref keeps the host's
  version through any gc, so proposed changes depend on nothing in the op log.
- **Every decision that moves proposed changes end with one mark** (`markSteps`,
  added once per decision in `proposed-steps.ts`): `git update-ref` from the
  proposed changes' own `refs/heads/<bookmark>`, which jj exports after every host
  command, so no step names a commit id; `jj git import`, which moves a
  tracked bookmark with its remote; `jj bookmark track`, which tracks it the
  first time, writes nothing after, and repairs a jj command of yours that
  imported the ref first, untracked. An untracked remote bookmark is in
  `builtin_immutable_heads()`: the WIP under the proposed changes would become
  immutable to you. jj exports no conflicted bookmark, so a mark is planned
  only for proposed changes read whole. New proposed changes' bookmark is still made with
  `bookmark set` (`planProposedChanges`), and the mark after its describes copies it.
- **The host's version is removed only by `forgetSteps`** (`jj bookmark
  forget --include-remotes`): an acceptance, a withdraw, and a `forget`
  decision with `hostLeft` (your proposed bookmark gone, its version left).
  **Never delete a remote ref of your repo in git:** the next `jj git
  import` abandons every commit only it held and rebases what is on them.
  Measured, it abandoned proposed changes you had deleted, your `@-` under your
  commit on it, and rebased your commit onto the root (S215 item 18;
  `repo.test.ts`, the forget). Before a rebuild nothing is forgotten: the
  build's `bookmark set` then the mark brings a deleted bookmark and its
  version back together, where moving the ref alone would leave the
  bookmark conflicted.
- **Who made a revision, when the proposed changes are not marked**
  (`revisionSinceHost`, its next read chosen by `planSinceHost`, pure):
  the evolog back to the host's newest version (`evologOf`, one `jj evolog
  -T EVOLOG_ENTRY`; `walkToHost`, pure), through each version's
  predecessor of the same change. Each version an operation not the host's
  made on the way is checked with `sameAs` (the description and `jj
  interdiff`) against the one before it. A rebase jj made because you
  reworded a commit below is your operation (S48 item 7), and changes
  nothing, so it is not an edit. A host step that stopped before its mark
  is found here as the host's, and the refresh's `mark` decision marks it;
  so is proposed changes built before proposed changes had a version. A walk the op log can
  no longer finish (a tidy cut its operations: the entry prints no user and
  no predecessors) compares the revision with the commit of its change in
  the host's version (`comparedWithHost`), read from the version's
  nearest ancestors and matched by change id, since the version is often
  hidden and `change_id()` names visible commits only.
- **A review reads by commit id** (ADR-0047): `revisionRead` runs
  `jj log -r <commit> -T REVISION_READ` and returns the parsed JSON,
  unchecked (the host decodes it), and `fileDiff` runs `jj diff --git -r
  <commit> -- root-file:"<path>"`. `REVISION_READ` prints `RevisionReview`'s
  wire shape, `json()` quoting every string (S57), and each file's
  `bytes_delta()`. A rename reads by its new path, with `{old => new}` as
  its display path; a binary file reads as 0 and 0.
- **A review says what each file holds** (`review-content.ts`, ADR-0165):
  a file with lines, or a move, is lines. Any other is read from your repo
  (`RepoReads.jjBytes`, `jj file show` streamed at the observed head):
  each needed side's first 8,000 bytes for core's `fileContent`, its size
  from the revision's delta where the stats carry one (`JjStatSize`), so
  `planJjReviewContent` reads a modified file whole on one side only; a
  range's `TreeDiffEntry` has no stat, so its sides are counted whole. A
  revision's stats without a delta are a misread, and the review fails.
- **A review serves a file's bytes** (`jjFileBytes`): `jj file show` of
  the side's commit (a revision's parent for `before`), its first bytes
  read to type it, then streamed on; none where the side holds no file. The diff's path is `root-file:`: a bare path is read from the
  process's directory, and `root:` matches every file under a directory of
  that name. A commit id names one commit, so neither resolves a change id
  or meets a divergent one.
- **A range reads in two commands** (ADR-0106, S70): `jj diff --from --to
  -T RANGE_FILES` gives each file's path, display path and status, one JSON
  object a line, since a `TreeDiffEntry` has no line counts; `jj diff
  --from --to --git` gives the counts, one `diff --git` section per file in
  the same order (`gitDiffCounts`). The two must list as many files, or the
  read fails. A range has no description. `fileDiff` reads a range with
  `--from --to`. A commit stays readable by id after it is abandoned, so a
  lane's revisions can be read after an acceptance or a split.
- **`hostCommitIn`** splits a divergent revision's commits: the host's is
  the one in the host's version, when that names exactly one, else by the
  user of each one's newest evolog operation (`evologOf` with a limit of 1,
  `isHostUser`). A race can leave the version behind both, since a mark
  copies no conflicted bookmark. The host's is abandoned, yours kept, and
  the version stays where it was, so the proposed changes read as yours.

## A tidy of your op log (`tidy.ts`, ADR-0155, S215)

- **A tidy is planned from your op log alone** (`planTidy`): the cut is the
  newest operation older than the window; jj's root operation is never one
  (`parseOpLog` leaves it out). Its steps run as you: `jj util snapshot`,
  so your working copy's operation is the head; `jj op abandon ..<cut>`
  without `--ignore-working-copy`, so jj re-points the working copy at the
  rewritten head (with it, your next `jj` finds a stale or sibling working
  copy, S215 item 7); `jj debug reindex`, since gc never clears
  `.jj/repo/index`; `jj util gc` at jj's own expiry, never `--expire=now`,
  which could delete an object a command of yours was still writing (S215
  item 15).
- **The whole log is read**: `jj op log --reversed -n 1` gives the newest
  operation, since `-n` applies before the reversal. About a second for
  63,000 operations on Linux.
- **An abandon costs a time for each operation it keeps** (S215 item 13):
  `expectMs` is the kept count times 6 ms, the Mac's measure.
- **A raced tidy is counted, never timed** (`isTidyRaced`): a command that
  loaded the head before the abandon and wrote after brings the cut chain
  back beside its rewritten copy, so the log holds more than the kept
  operations and the snapshot. Nothing is lost; the next tidy cuts it.
- **It runs only while no host serves the repo:** the caller holds the
  session store's lock (`apps/pinetrie/host/tidy.ts`); `planTidy` refuses
  `served`, and a repo with a second workspace, which the abandon would
  leave stale.

## A lane's repo (`lane/`)

What jj's adapter does in a lane's own repo: `jjLaneHistory` (`lane/history.ts`)
is its `LaneHistory`, over the lane's runners, and its pure planners are
`lane/plan.ts`'s. `@pinetrie/lanes` runs no jj: it plans a fork and the base
with the steps this package gives it (`ForkSetup`, `BaseCheckout`).

- **A point becomes a commit only in a lane proven jj** (`lane/points.ts`,
  ADR-0150). `proveJjLane` is the one maker of a `JjLane` (its brand is
  unexported). It answers tagged, the lane under `kind: "jj"` beside a
  `ForeignLane` or a `NoCopy`, never told apart by a missing field: a
  record that gained `kind` would otherwise read as proven, unseen by the
  compiler. `commitFromPoint` takes a `JjLane`, so a point from a port or from
  storage is read as a commit only where the lane it belongs to keeps a jj
  history. A commit becomes a point freely (`pointFromCommit`, core).
  `jjLaneHistory` takes a `JjLane`, proved once by the host's adapter when the
  registry asks for the history, and its planners (`planForkSetup`,
  `planMerge`) convert inside.
- **Reads of your repo stay in commits.** `laneBase`, the proposed changes' gathers,
  `catch-up.ts` and `readRepoFile` read `CommitBase` (`LaneBaseOf<CommitId>`);
  `commitTurn` and `mergeUpdate` answer `TurnCommittedOf<CommitId>` and
  `MergedOf<CommitId>`. `jjLaneHistory` converts at the port (`baseFromCommits`,
  `turnFromCommits`, `mergedFromCommits`); the host's adapter converts a
  base a port carried back with its lane's proof (`baseInCommits`), and a
  review's range with the lane `planReviewRead` named (`CommitSpan`).
  WIPs, proposed changes and accepted work's own records are jj's alone, and stay
  `CommitId` throughout.

- **Every method is gather, a pure planner, then execute.** The planners
  are unit-tested (`lane/plan.test.ts`, `lane/fetch-plan.test.ts`); the
  effects, by the port suite (`lane/history.test.ts`, Tests).
- **A move your repo needs to hear of hands back its fetch as `follow`**
  (`recordTurn`, `merge`): `planFetch` decides which commits the bundle may
  leave out (a turn's bookmark before it; a clean merge's `ours` and `from`;
  a mark's `ours`; nothing for a conflicted merge, whose resolution's turns
  fetch the lane). The caller fires it after the snapshot step it queues,
  so the bundle never runs before the snapshot, and lane work never learns
  that your repo needs telling. It is never named `then`: `await` would
  take the result for a promise.
- **`afterRestore`** gives a disk restored from a snapshot the names the
  host reads now (`oldNamesOnDisk`, `planOldNamesOnDisk`, `pre-rename:`).

### Forks

- **A fork with no revision above it starts from its thread's base**
  (`planForkSetup`, ADR-0104): on accepted work, an empty commit on accepted work's
  commit (`planAcceptedStart`); on a WIP, a copy of the WIP made in the lane
  (`planWipCopy`): a commit on accepted commit under the WIP, with the WIP's
  files restored. Never the WIP's own commits: the lane's tip, a remote
  bookmark and immutable in your repo, would make them immutable too (S48
  item 11), and your WIP would freeze. Either commit carries
  `Pinetrie-Base: <bookmark>@<commit>` (`baseMessage`), the lane's ledger of
  its base.
- **`jj new` runs first in a fork's setup** (`planForkSetup`), after
  `planFork`'s `pre-rename:` removal of `/workspace/.pineta-lane`
  (`packages/lanes/TECHNICAL.md`, Forks), which `jj new` would otherwise
  snapshot into the working copy the clone carries. A clone carries its
  parent's working-copy change. Without `jj new`, the fork's first turn reuses
  that change's id, and your repo sees a divergent change (S42 item 2).
  `repo.test.ts` (`@pinetrie/jj`) forks a lane's repo and checks that your repo has no
  `divergent()`. Its mutation drops `jj new`.
- **Inherited history is immutable in the fork.** Its config is a file on its
  own disk (`JJ_CONFIG=/workspace/.pinetrie-lane/jj.toml`), so forks of forks
  inherit it. It sets `immutable_heads()` to
  `builtin_immutable_heads() | <fork commit>` (`forkConfig`). A parent's fork
  point is an ancestor of its child's, so nothing needs reading from the lane.
  jj's `--repo` config lives in the home directory, which in a lane is the
  container's own and not on its disk.
- **That setting applies to `/workspace` only.** `JJ_CONFIG` reaches every
  jj command in the container, and a repo that lacks the fork commit fails
  every command under it (S50). So `forkConfig` writes it in a
  `[[--scope]]` with `--when.repositories = ["/workspace"]`. jj matches the
  repo and every path under it, so a repo nested inside `/workspace` still
  gets it. A lane made before the scope keeps its unscoped file: only a
  fork's setup writes it.
- **A base with several parents** (your `@` is a merge) is committed once,
  empty, so the lane's bookmark names one commit.

### Moving commits

- **By commit id, into a lane**: `fetchById` fetches from `/mnt/host-working-copy` only when
  the disk lacks the commit, and puts the commit on a branch
  (`refs/heads/pinetrie/fetched/<i>`). jj imports only branches, remote branches
  and tags, so it does not see a commit fetched with no ref (S44 item 7).
  When your `@-` was rewritten, that branch moves sideways, and the import
  (`--ignore-working-copy`) abandons the commit it named and rebases its
  descendants. On a base copied from the one before, the working-copy
  commit is one of them, so the working copy goes stale: `planBaseCheckout`
  runs `jj workspace update-stale` before `jj new`, which does nothing when
  it is fresh (S74).
  It fetches every commit it names when the disk lacks any, and git skips a
  wanted commit the disk already holds, so naming one of the lane's own is
  harmless, though a caller names only what the lane may lack (S83).
- **By bundle, into your repo** (`planBundle` in a lane, then `planImport`
  in yours): `git bundle create -` in the lane, written to a host file
  through the channel as bytes, then, in your repo, `git fetch <file>
  +refs/heads/pinetrie/<lane>:refs/remotes/pinetrie-<lane>/tip`.
  The bundle excludes what your repo has (`^<have>`). A bundle of the whole
  history is 1.1 MB and 253 ms on pine·trie's repo, against 8 KB and 29 ms for
  one commit (S43 item 8).
- **In your repo a lane's history is a remote bookmark**, `tip@pinetrie-<lane>`
  (ADR-0105). jj imports a ref under `refs/remotes/` with no git remote
  configured, keeps its commits out of your default log, and treats them,
  and their ancestors, as immutable with its builtin config (S48 items 11 and
  19). `laneRefSteps` (`@pinetrie/jj`) is the one writer of the ref besides
  the fetch: archiving deletes it, restoring writes it back. In the lane's
  own repo the bookmark stays a local `pinetrie/<lane>`; `laneTipIn`
  (`@pinetrie/jj`) reads the one in yours, `readLaneBookmark` the lane's.
- **Every fetch into a colocated repo ends with
  `jj --ignore-working-copy git import`**, in your repo as the host
  (`planImport`). A jj command run with
  `--ignore-working-copy` imports no git refs. A plain `jj git import`
  snapshots the working copy as well, recording your uncommitted edits into
  `@`: 107 ms against 12–47 ms (S44 item 8).
- **A fresh disk's checkout is `git init` and `jj git init --colocate`,**
  then a fetch by id (`planBaseCheckout`). `jj git clone` refuses a directory that is not empty, and a
  fresh volume holds `lost+found` (S44 item 6). A clone would also fetch every
  bookmark and check out nothing (S43 item 5).
- **`PINETRIE_GIT=1`** is set on every host command `run` starts. A git shim
  that refuses git writes in a jj repo when an agent is driving lets it
  through. The agent's own commands run through pi's environment, never
  through `run`, so they never carry it.


### Running jj and git (`lane/run.ts`)

- **Every jj command takes `-R <root>`**: `laneJj(runner)` with `-R
  /workspace` in a lane, and `@pinetrie/jj`'s runners on your repo. A jj
  command run from the wrong directory acts on whatever repo surrounds it
  (S36 item 28). `jjIn` alone runs from a directory: to ask where a repo is,
  and for the startup reads (`startup.ts`).
- **A path argument is read from the process's directory, not `-R`'s.** Name
  files with the `root:"…"` fileset, as `revisionsIn` and `conflictContent`
  do.
- **One bookmark in a revset is `bookmarkRevset(name)`**: `bookmarks(exact:…)`
  with the name quoted (`revsetName`), so a name is never parsed as a
  revset.
- **The host's trailers** (`Pinetrie-Thread`, `Pinetrie-Lane`, `Pinetrie-Entry`,
  `Pinetrie-Base` and proposed changes' ledger) are written and read in one file,
  core's `trailers.ts`: a turn's message (`revisionMessage`,
  `entryOfMessage`), a base's (`baseMessage`, `parseBase`, `messageBase`), proposed changes', and the revset that finds commits by one (`trailerRevset`, here
  in `newestBase`). A format lanes or jj must read or write lives in
  core.
  - **The readers also read `Pineta-*`** (`READ`, `pre-rename:`): commits
    made before the rename are immutable. Writers write `Pinetrie-*` only.
  - **A base is read by kind, never by accepted work's bookmark**
    (`messageBase`, ADR-0100): a name with the WIP prefix is that WIP, any other
    is accepted work. New bases write `accepted@<commit>`; one written as
    `pinetrie-onto@` or `pineta-onto@` reads as accepted work too, with no
    special case, and so would one under any later name of the bookmark.
    `planLaneRead` and `laneBase` take the kind from it.
- **Decide from exit status, never from printed text.** Output a program
  reads comes from a `-T` template. `execFile` reads all of it: jj exits 3 on
  a broken pipe.
- **`JJ_EDITOR=false`** (`NO_EDITOR`, from core) makes a command that wants
  an editor fail at once rather than hang (S36 items 13, 21). A lane's
  container sets the same variables.


### Revisions and updates (`lane/revisions.ts`, `lane/merge.ts`)

- **`commitTurn`** snapshots, reads `@`'s `empty` and its parents in one
  `jj log`, and decides with `planTurnCommit`:
  - `@` has changes: `jj commit` with the title and two trailers,
    `Pinetrie-Entry` and `Pinetrie-Lane`, then the lane's bookmark moves there;
  - `@` is empty and its one parent descends from the bookmark: the agent
    committed in the turn, with jj or git, and that commit is the turn's
    revision. The bookmark moves to it, untouched, without trailers (S56).
    Without this, the proposed changes lacked the commit, and a branch at the turn ran
    `jj new` on the bookmark's commit and lost its files;
  - otherwise null. A parent on another line (a split's stack, built on the
    proposed changes' start) or a merge is never adopted.

  `LaneHistory.commit` reads the bookmark first and passes it, the one copy
  of that pair; `recordTurn` returns it as the turn's `newest`, which
  `turnDone` records. The ancestry query (`isAncestor`) runs only when `@`
  is empty and its one parent is not the bookmark: most turns change
  nothing, and cost no extra command. The same `jj log` reads `@`'s and
  each parent's `conflict`, so `commitTurn` also says whether the turn's
  commit, or the bookmark when it has none, is conflicted; only then does
  `turnDone` list the files (`readConflictedFiles`) into the record, which a
  branch's warning reads (ADR-0072).
- **`copyFacts`** (ADR-0080) reads where the working copy sits against the
  lane's bookmark, after a snapshot: `@`'s parents, the bookmark, and
  whether the one parent descends from it (`isAncestor`, asked only when it
  is not the bookmark). Every catch-up checks it before it merges
  (`readyToMerge`, then `planCopyReady`, `@pinetrie/core`, the one maker of
  the `ReadyCopy` a merge takes): a split's stack as the working copy is
  off the lane's line.
- **`commitToBookmark`** is the one tail of every commit the host makes in
  a lane: `jj commit`, read `@-`, move the lane's bookmark. `commitTurn`,
  `mergeBase` and the mark of a move to accepted work all end with it.
- **`changedPaths`** is a turn's paths, from the bookmark before it to its
  commit, made or adopted, which its revision records (ADR-0106): `jj diff
  -T PATH_LINE`, `json(path)` a line, which is from the repo's root
  whatever the process's directory, and quotes any character (S70). An
  update's changed files use it too. **Not git:** git reads a conflicted jj
  commit as every side's whole tree under `.jjconflict-base-<n>/` and
  `.jjconflict-side-<n>/`, plus `JJ-CONFLICT-README`, so a turn that
  resolved one file in a repo of 694 counted 2084 (S99).
- **`readConflictedFiles(jj, rev)`** is the one read of a commit's conflicted
  files (`jj file list -T 'if(conflict, …)'`), in a lane and in your repo;
  it throws, and a caller that reads none on failure says so at the call.
  `conflictsIn` snapshots the lane first, then reads `@`.
- **An update merges the thread's base** (`mergeBase`, ADR-0104): the
  line's commit, or a fresh copy of the WIP (`planWipCopy`) made on the
  lane's previous copy, so conflicts the lane already resolved do not come
  back. Or the newest commit of the thread it branched from (`planMerge`'s
  `parent`, ADR-0072), merged as accepted work's commit is but with no
  `Pinetrie-Base`: ancestry says what the lane holds of it. Accepted work's merge carries `Pinetrie-Base`, a WIP's copy its own, and
  `newestBase` reads the newest one in a lane's history: its base, and
  where its proposed changes start. `laneBase` reads it in the lane's own repo too
  (`bookmarkRevset`), where a lane with none is null: that repo has no
  line bookmark to find a start on.
- **An accepted thread commit the lane holds is joined to its source
  first** (`planJoins`, `mergeBase`, S102, ADR-0079). An accepted thread
  commit is a copy of a lane's work on accepted work, naming the commit it
  copies (`Pinetrie-Source`). Merged as history says, its base is that
  commit's `Pinetrie-Start`, from before that work, so the work came in
  twice: any edit accepted work made to it since conflicted. So a join, a commit
  merging the source with the accepted thread commit (the same changes,
  so clean), goes first, and the update merges the lane, the last join and
  the base in one commit.
  - **Which accepted thread commits:** those in `::<from> ~ ::<ours>` (`ACCEPTED_THREAD_COMMIT_ROW`, one `jj
    log`) naming any source the lane holds, a squash's included (S77 item
    6), read with `present()`.
  - **The order:** oldest first, each join on the last, so a later one's
    base holds the earlier ones.
  - **A conflicted join is abandoned:** an acceptance of proposed changes you edited where
    the lane wrote, merged as before.
  - **A join carries no trailer:** bases and accepted thread commits are
    found by theirs.
  - **The update's titles and a conflict's `theirs` leave the accepted thread commits out**
    (`withoutAcceptedThreadCommits`), and keep accepted work's commits under them.
  - **A WIP's copy has no accepted thread commit in its history,** so a WIP thread joins
    nothing.
  - **The host's forecast starts from the same sources** (`catchUpFiles`,
    `@pinetrie/jj`): it diffs from the proposed changes' start, which holds them,
    not from the base's start (S102 item 11).
- **`mergeUpdate` is an update's whole run in a lane** after its edits,
  on the lane's queue (`LaneHistory.merge` commits the edits, plans the
  merge with `planMerge`, then runs it): `planMerge`'s steps (a fetch of accepted work's commit,
  or of the WIP's commit and its copy), the merge, a mark naming accepted work
  when a thread moves there with nothing to merge, then what the merge left:
  its files and the titles of what came in (`readTitles`, one log), or each
  conflicted file's content and the revisions on each side that touched
  them. A WIP's copy fetches only the WIP's commit: its parent is the
  lane's own.
- **`revisionsIn` reads a side of a merge in one `jj log`**: the range's
  revisions that touched any of the files, each with those it touched, from
  `self.diff("<fileset>").files()` as JSON per line (S83). A side needs no
  `fork_point`: `fork_point(a | b)..b` is `a..b`, even with several fork
  points (S83).
- **The merge is committed at once,** even with nothing to resolve.
  Otherwise an empty merge stays the lane's working copy, which every snapshot
  rewrites. A mutation shows `repo.test.ts` fails without it.
- **Conflicts** are read with `readConflictedFiles`, and a conflicted file's
  content with `jj file show`: the host cannot read a lane's disk.
- **A file both sides hold alike is merged as it is** (`heldAlike`): jj
  keeps a conflict when the merge's base is itself conflicted, as when a
  branch cloned at a conflicted catch-up and its parent resolved it alike
  (S99). `mergeUpdate` restores such files from the side merged in into the
  merge (`jj restore --into`, the bookmark following), then reads the
  conflicts again. With a clean base jj already takes them.
- **A clean update's changed files come from `changedPaths`**, the turn's
  read.

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
  operation is `pinetrie-host`'s), and every read and plan here. It covers the
  base, a turn, an update with a conflict, forks from a turn and from a copy
  of your `@`, checked for divergence and immutability, and a repo beside a
  fork that the fork's config leaves alone (S50); a commit the agent makes
  itself, with jj and with git (S56), reaching the proposed changes and a branch at its turn, and an
  update merging on it, while a stack's commits are never adopted; proposed changes
  built, refreshed, left, rewritten by the host with its record lost (S73),
  repaired, accepted under your edits and beside them, the next proposed changes, and a
  stack; proposed changes following a moved tip, your conflicting commit and a moved
  start, each checked against a fresh build; proposed changes after you committed
  your edits differently, after an accepted branch that holds the lane's
  tip, from a branch whose parent was accepted after the fork (S72), and
  from a lane after a branch of it was accepted before its update (S51,
  S72); an untraced accepted thread commit, read either way until the lane catches up past it, and what catching
  up changes against what the merge changed (S97), and after the lane
  edited its accepted work again, with one start and two (S102 item 11);
  and a review of proposed changes' commit (its description, a rename, names with a space and a
  quote, and one file's diff, never a directory's). The gathers are held to
  it as well: each place kind (placed, untraced, a WIP gone), what an
  acceptance reads on a WIP (`gatherAcceptance`), a split's stack bottom first
  (`gatherStack`), `repairProposedChanges` on divergent proposed changes, and that
  `trailerRevset` finds exactly the commits `hasTrailer` matches. And a
  catch-up past an accepted thread commit of the lane's own work, of its
  parent's, two of them, a conflict both sides made, and an acceptance of
  proposed changes you edited (S102): the lane holds the accepted thread commit's
  source, so that commit is joined to it and the update is clean. Then a
  lane's ref deleted and imported again, which keeps the history under
  accepted work (S78); a branch cloned from a conflicted catch-up, whose
  proposed changes' conflict came with its copy (S99); and a base refreshed after your
  `@-` was rewritten, not built on (S74).
- **`tidy.test.ts`**: `planTidy`, `isTidyRaced`, `planTidyHint` and
  `parseOpLog` as values; then real jj, on repos with operations dated
  long ago (`debug.operation-timestamp`): the log cut to the window with
  your working copy fresh after, and a write that loaded the head before the
  abandon kept, the tidy read as raced.
- **`proposed-steps.test.ts`**: each decision's steps, as the planners make
  them, each that moves proposed changes ending in one mark, and that each `after`
  carries the decision's place.
- **`repo.test.ts`, the host's version of proposed changes**: built proposed changes are its
  version, tracked, read with no evolog; your change to its file reads as
  yours; a host rebase without its mark is the host's, by the evolog and,
  once the op log is cut, by the version; proposed changes from before versions
  reads as the host's and one mark makes it the version; the forget after
  you deleted proposed changes' bookmark and built on it leaves your commits
  where they are (the mutation that deletes the ref in git fails it); an
  acceptance leaves neither bookmark nor version; an archived lane's
  history survives a cut and collected op log, and restores.
- **`lane/history.test.ts`** is the port suite
  (`@pinetrie/lanes/testing`'s `historySuite`) against `jjLaneHistory`: lanes as
  throwaway repos on the host, their runners mapping `/workspace` and
  `/mnt/host-working-copy` to directories, your repo beside them, and each
  fetch a real bundle and import. A folder project's adapter runs the same
  suite, which holds only what both kinds keep; jj's own beside it here: a
  turn and a clean merge each schedule one fetch, and a copy off its line
  (a split's stack) is refused a merge. Each of its tests is the `expect` of a mutation in
  `scripts/mutations/jj.ts` or `core.ts` (`portSuite`).
- **`lane/plan.test.ts`, `lane/fetch-plan.test.ts`,
  `lane/revisions.test.ts`, `startup.test.ts`**: a lane's planners, which
  commits a move fetches, a turn's paths and a copy's facts against jj, and
  the startup's root and kind, and repo names.
- **`apps/pinetrie/host/jj/proposed/refresh.test.ts`** runs the host's own refresh
  (`createRefresh`, a real owner) on the histories S97 found, until a round
  writes nothing: it lives with the host, since this package may not import
  `planRefresh` (`workspace.test.ts`).
- Mutations are in `scripts/mutations/jj.ts`.
