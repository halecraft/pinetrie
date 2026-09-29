# S48 — offers: a thread's work as one commit in your repo, before you take it

Taking a landing today (ADR-0033, ADR-0034) rebases your `@` onto the lane's
merge, so every turn commit the lane made becomes an ancestor of your work,
and immutable there: `pineta/*` is in your repo's `immutable_heads()`, so
you cannot squash what you took. A lane also starts from your `@-`, never
`@`, so work you have not committed is invisible to it. The design under
test replaces both:

- each thread keeps an **offer** in your repo: one mutable commit holding
  the lane's net change, rebased onto your `@-` (or onto a bookmark,
  `pineta-onto`, when you set one), refreshed as the thread works and as you
  do, and visible in `jj log` and jjui before you take it;
- **take** is `jj rebase -r <offer> -B @`;
- the lane's own history stays out of your view.

These probes ask whether jj does what that needs, and where it breaks. jj
0.44.0, throwaway repos, a lane as a separate colocated clone fetched by
bundle as `planFetch` does. The host's commands use `--ignore-working-copy`,
as Pineta's do; yours do not.

**Answers.**

1. **An offer is four host operations, and touches nothing of yours.** The
   host makes an empty commit at the lane's fork point, restores the lane
   tip's files into it (so its diff is exactly the lane's net change),
   rebases it onto `@-` and sets its bookmark. Fetch and offer together took
   about 260 ms. No host operation snapshotted your working copy; your next
   command worked normally, and your uncommitted edits were untouched.
2. **Address the offer by change id, never by commit id, between steps.**
   Each step rewrites the commit. Rebasing by the commit id taken before the
   `restore` rebased the hidden, pre-restore commit, which made a second
   visible commit with the same change id: a divergent offer, from the host's
   own four operations.
3. **The offer previews conflicts with your committed work.** With your
   commit and the lane both editing `a.txt` line 1, the offer was recorded
   conflicted, and `jj resolve --list -r <offer>` named `a.txt`. Your `@`
   stayed clean: nothing reached your files.
4. **Conflicts with your uncommitted edits show only at take.** The offer
   sits on `@-`, below your edits, so an offer touching `b.txt` stayed clean
   while you edited `b.txt`. The host can say so beforehand from file names
   alone: the intersection of `jj diff -r @ --name-only` and the offer's.
5. **Take is `jj rebase -r <offer> -B @`, run as you.** It must update your
   working copy, so it is the one command the host runs without
   `--ignore-working-copy` (a host command with it left a workspace stale,
   in P6). Three cases:
   - an offer clean under edits elsewhere: the offer became `@-`, `@` kept
     your edits, and the files on disk had both;
   - edits in a file the offer touches: the offer stayed clean, and the
     conflict landed in `@`, your change, with jj's markers in the file on
     disk: yours to resolve where you are working;
   - a conflicted offer taken anyway: the offer and `@` were both
     conflicted, the markers on disk. Editing the file in `@` and
     `jj squash --into <offer> root:a.txt` resolved it in the offer, leaving
     `@` clean with only your edits.
6. **Your commits below the offer need the host; your rewrites do not.**
   - A new commit on `@-` (`jj commit`) leaves the offer on the old parent.
     The host refreshes it with `jj rebase -r <offer> -o @-`.
   - Rewriting a commit below it (`jj describe @-`) makes jj rebase the offer
     by itself, still on `@-`.
7. **The host can tell your edit of an offer from jj moving it, with three
   tests against the commit it last wrote for that offer:** the same
   description; an empty `jj interdiff --from <that commit> --to <offer>`
   (interdiff compares what two commits change, ignoring their parents); and
   the offer's parent an ancestor of the host's target (`pineta-onto`, else
   `@-`). Each catches a different edit:
   - after jj's own rebase (your reword of `@-`): all three hold, not edited;
   - after you commit on `@-`: all three hold; the offer is behind, and the
     host refreshes it (answer 6);
   - after you reword the offer: the description differs;
   - after you squash a file into it: interdiff lists the file;
   - after you move it onto another commit yourself: description and
     interdiff are unchanged, and only the parent test fails (P11c).

   The tests compare one offer with its own earlier version, found by its
   change id; no revision is ever looked up by description. Who made the
   commit cannot answer this by itself: jj's rebase of the offer, caused by
   your reword below it, is recorded as your operation (P11d).
8. **A host rewrite racing yours makes the offer divergent, and is
   recoverable.** You reworded the offer while the host rebased it from the
   operation before (`--at-operation`): two visible commits with one change
   id, the bookmark conflicted, and jj warned that it could not export the
   bookmark to git. The host's recovery (abandon its own commit, point the
   bookmark at yours) left nothing divergent. It must pick its own commit by
   who made it, never by description: when your edit kept the offer's
   description, both divergent commits matched it (P11a). Run with
   `--config operation.username=pineta-host`, every host operation says so
   in the evolog (`operation.user()`), which told the two apart (P11b). A
   refresh is one operation, so the window is one jj command long; the rule
   "never rewrite an offer you have edited" (answer 7) narrows it further.
9. **`pineta-onto` does what it should.** Take puts the offer on it and
   moves it up:
   - at `@-`: two offers taken in turn stacked under your edits, in the order
     taken (`-A <onto> -B @`); the second, built before the first was taken,
     needed one refresh onto the moved bookmark;
   - on a side branch, not an ancestor of `@`: the offer was built there,
     take moved only bookmarks, and `@` and your files did not change.
10. **A lane may start from your `@`, but not at the `@` commit itself.**
    - Forked at the `@` commit taken at send: the lane saw your uncommitted
      line. But when its work came back, that commit came with it, as an
      ancestor, and your `@` change became divergent: two commits with its
      change id, your current `@` and the one the lane started from.
    - Forked at a copy (a commit on your `@-` with `@`'s files, made in the
      lane, with a change id of its own): the lane saw your uncommitted line;
      nothing in your repo became divergent; the offer, built from the copy,
      held only the lane's change (`a.txt`, not your `c.txt`); and taken,
      your files had both your later edits and the lane's.
11. **A lane's history can live in your repo as a remote bookmark, out of
    sight and immutable, with no config.** Fetched into
    `refs/remotes/pineta-<lane>/<bookmark>` and imported, it showed as
    `lane@pineta-t1` with no remote in your git config. jj's builtin
    `immutable_heads()` includes untracked remote bookmarks, so its commits
    were immutable with no config line, and they did not appear in your
    default `jj log`; the offer built from it did. Today's local bookmark
    (`pineta/lane`) shows every turn in your default log, and is mutable
    without the line Pineta adds to your config. On request:
    `jj log -r '::remote_bookmarks(remote=glob:"pineta-*") ~ ::@'`.
12. **A stack is checked by files, exactly.** A stack rebuilt in the lane
    from the fork point, one revision per file, had no file differing from
    the lane's tip (`jj diff --from <tip> --to <top> --summary` empty). A
    stack missing one file's change showed `M b.txt`.
13. **Noticing your jj operations is cheap.** `.jj/repo/op_heads/heads`
    holds one file named for the current operation; it changed on a
    snapshot and on a commit, and not on a read with nothing to snapshot.
    Reading the current operation with `--ignore-working-copy` took 14 ms.
14. **An offer cannot be named `pineta/…` while Pineta's line is in your
    config.** With `bookmarks(glob:"pineta/*")` in `immutable_heads()`, an
    offer at `pineta/offer/t1` could not be described or taken ("Commit … is
    immutable"). Answer 11 removes the line; until then offers are
    `pineta-offer/<thread>`.

## What this means for the design

- **Build:** empty commit at the fork point, restore the lane's tip, rebase
  onto `pineta-onto` or `@-`, bookmark; by change id throughout;
  `--ignore-working-copy` throughout.
- **Refresh:** on a new operation head (answer 13), if the offer's target
  moved, and only if you have not edited the offer (answer 7's three
  tests). A divergent offer after a race is repaired by keeping yours, the
  host's commit known by its operation user (answer 8).
- **Identity:** an offer is its change id and its bookmark; the host's
  operations carry the user `pineta-host`. No step finds a revision by its
  description.
- **Take:** `jj rebase -r <offer> -A <onto> -B @` when the target is an
  ancestor of `@`, else a bookmark move; run as you; then `pineta-onto`
  moves to the offer.
- **Preview:** the offer's conflict state against your committed work
  (answer 3), plus the file-name check against your uncommitted edits
  (answer 4).
- **Lanes from `@`:** fork at a copy of `@` with its own change id, made in
  the lane (answer 10).
- **Lane history:** remote bookmarks under `pineta-<lane>`, which also
  retires Pineta's line in your repo's config (answer 11), and with it the
  naming limit of answer 14.
- **Stacks:** accepted only when the top matches the lane's tip file for
  file (answer 12).

## Not measured

- jjui itself. It reads `jj log` with its own revset; offers are mutable
  commits on `@-`, so they appear in its default view, but no jjui was run.
- A real race between two processes, rather than one forced with
  `--at-operation`.
- Pineta's containers: the lane here is a directory, fetched by the same
  bundle and `git fetch` steps. The jj operations in your repo are the same.
- Repeat offers after a take ("delivered up to"), and an agent writing a
  stack.

## Addendum: before implementation

Six questions `PLAN-2026-09-28-offers` raised, answered before it starts.
Probes `p12.sh` to `p17.mjs`.

15. **Where an offer starts, as ADR-0038 defines it, is one revset:**
    `heads(::<tip> & ::(<target> | <delivered> | <copies>))`, where
    `<delivered>` is every lane commit a take delivered and `<copies>` every
    copy of your `@` made in a lane. Every case gave the right files:
    - a lane from your `@-`, after you committed meanwhile: from `base`, the
      lane's two files;
    - a lane from a copy of your `@`: from the copy, only the lane's file,
      not your uncommitted `c.txt`;
    - a lane after an update merged a copy into it: from that copy, the
      lane's files, not your merged work;
    - a branch of a lane you never took: from `base`, its parent's file and
      its own;
    - the same branch after you took the parent: from the parent's
      delivered commit, only its own file; taken onto your history, clean.
16. **Several heads start the offer from their merge,** and the rebase
    collapses it. A lane from one copy, then updated with a later copy, had
    two heads, neither above the other. `jj new --no-edit <heads>` made the
    offer a merge of both; after `jj rebase -r <offer> -o @-` it had one
    parent, your `@-`, and only the lane's files.
17. **A copy counts as a commit you have, or the offer returns your own
    edits.** Without the copies in the revset, the offer of a lane forked
    from a copy started at `base` and carried your uncommitted `c.txt` as
    well as the lane's `a.txt` (P12b, run without them).
18. **A stack becomes the offer by rebuilding, not by `jj duplicate`.** The
    host made one new commit per lane revision on your `@-`, restored that
    revision's files into it, and described it with the revision's message:
    each held exactly its revision's file, all were mutable, and the top
    matched the lane's tip (`jj interdiff`, no file). `jj duplicate` of the
    same range worked too, but it reports which commit became which only as
    text, so the host could not name its results. Each new commit is found by
    a nonce description, unique to the step, replaced at once: the offer's
    own build needs the same, since `jj new` has no template. Taking the
    stack is `jj rebase -r <bottom>::<top> -A @- -B @`: both revisions under
    `@`, `@` clean, your uncommitted line kept.
19. **Commits lanes build on stay immutable in your repo, as ADR-0032
    wants.** A remote bookmark makes its ancestors immutable, your `base`
    included: the commit a lane forked from cannot be rewritten by accident,
    as with the old config line. The copy of your `@` a root lane starts from
    is lane history, so your own `@` stays mutable.
20. **Archiving and restoring a lane's history is two ref updates.**
    `git update-ref -d refs/remotes/pineta-<lane>/tip` and a
    `jj --ignore-working-copy git import` removed the remote bookmark; the
    tip became hidden and stayed readable by id. Re-creating the ref and
    importing brought it back: nothing divergent, nothing in your default
    log.
21. **Retiring the old layout must move each lane's history first.**
    Deleting a local `pineta/*` bookmark leaves its commits visible: they
    appeared in your default log once the config line was gone. Pointing
    `refs/remotes/pineta-<lane>/tip` at each bookmark's commit, importing,
    then deleting the local bookmarks and the line, left your default log as
    it was, and the lanes' history one `jj log` away. The line is removed by
    text, keeping anything else you wrote there (`builtin_immutable_heads() |
    tags()` stayed); when only the builtin remains, the repo's setting is
    unset. A config change is not a jj operation: only the bookmark deletion
    appears in the op log.
22. **Commit messages can come from pi-ai without touching a run's script.**
    A second faux provider, registered beside the run's in one `Models`,
    answered two `completeSimple` requests from a factory that re-queues
    itself; the run's provider still had both its scripted replies, and gave
    the first next.

## Method

`sandbox/s48/` (ignored): `lib.sh` holds the helpers (`setup_you`,
`setup_lane`, `fetch_lane` as `planFetch`, `make_offer`), and `p1.sh` to
`p15.sh` and `p17.mjs` one probe each; `probe.sh` runs them all. `p17.mjs`
imports pi-ai from `packages/pi`'s dependencies. Each starts from fresh
repos under `/tmp/s48`, with `JJ_CONFIG` pointing at a config of its own,
and runs from there: the git shim refuses to run inside a jj repo.
