# S215 — your repo's history: what slows a refresh, and how to keep it small

Numbered S214 until 2026-10-15, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0154, ADR-0155

**Question.** Duane's host log showed refreshes that ran for 2-6 s and
waited up to 31 s behind each other. His repo's jj store had grown to
1.9 GB: 62,885 operations, 59,766 `refs/jj/keep`. Is that size what
makes jj slow? Can the host keep the store small on its own, with no
change you would notice? `jj undo` and `jj op restore` must keep working
over recent work, and so must the host's own reading of your repo.

**Kill criterion.** If a refresh's commands cost the same on a pruned copy
of the repo as on the original, the size is not the cause, and pruning is
only about disk space.

**Throw away.** Every copy of the repo (`/tmp/probe/`), and the probe
scripts.

## Answers

1. **Most jj commands do not get slower as the history grows.** On a Linux
   copy of the repo (jj 0.45.1, warm cache), `jj op log -n 1` took
   7-11 ms, and the `jj log` of the offers took 35 ms. A command loads the
   head operation and its view, and nothing older.
2. **The full evolog does get slower: a refresh reads it, and it walks the
   op log.** `sinceHost` reads an offer's whole evolog every time. Since
   evolution history moved into the op log, `jj evolog` walks operations
   back to where the change was made. For two of the six live offers it
   opened 29,199 and 30,143 operation files (strace) and took 0.29-0.51 s.
   With `-n 1` it opened 39 and took 0.05 s. The walk stops at the first
   entry when that entry is the host's, which is the usual case
   (`walkToHost`). So `-n 1` first, and the full read only when the
   newest version is not the host's, keeps the same answer for about a
   tenth of the cost.
3. **The host makes 92% of the operations, about 3,000-8,000 a day.**
   There were 62,964 operations over 26 days: 57,926 by the host
   (`pinetrie-host` and the older `pineta-host`) and 5,035 by duane. The
   newest 20,000 were mostly an offer's build, three operations per lane
   commit: describe 6,073, import git refs 5,878, restore into 5,706, and
   rebase 1,777. Each operation writes a view of about 26 KB, and each
   rebuilt offer writes new commits, each with a `refs/jj/keep` ref and a
   `store/extra` file.
4. **jj does not prune any of it on its own, and `jj util gc` does not
   touch the index.** The jj changelog to 0.46 has no automatic op-log
   pruning. `jj util gc` collects the op store and the git backend.
   `.jj/repo/index` gets one `op_links` file and about one segment per
   operation, and nothing deletes them. The default index store has no
   gc (`lib/src/default_index/store.rs`, read). Only `jj debug reindex`
   clears it.
5. **Keeping seven days measured (`jj op abandon ..<newest op before the
   cut>`, then `jj util gc --expire=now`, then `jj debug reindex`):**

   | | before | 7 days kept |
   |---|---|---|
   | operations | 62,964 | 24,809 |
   | `op_store` | 1.2 GB | 589 MB |
   | `index` | 496 MB (122,533 files) | 1.3 MB (after reindex) |
   | `store/extra` | 256 MB | 3.5 MB |
   | `.git` | 98 MB | 36 MB |
   | `refs/jj/keep` | 59,834 | 17,050 |
   | commits in the index | 60,282 | 25,951 |
   | `git fetch` of a one-commit bundle | 89 ms | 31 ms |
   | full evolog, the oldest offer | 30,143 ops opened, 0.29 s | 24,809 ops opened, 0.26 s |

   The abandon took 14-33 s, since it rewrites every operation it keeps:
   an operation's id hashes its parent. gc took 12 s, and reindex 8.4 s.
   The window makes the full evolog cheaper only in proportion to how
   much of the log it removes. Bounding the read (item 2) is the speed
   fix. Pruning keeps disk, ref count and every walk of the log bounded.
6. **Pruning past an offer's newest host version makes the offer read as
   yours.** jj no longer reads predecessors stored in a commit (changelog,
   0.42). An entry whose operation is abandoned prints no user and no
   predecessors, so the evolog stops there. After the 7-day cut, all six
   offers still reached the host's version, since each had been rebuilt
   minutes before. After abandoning everything but the head, 5 of the 6
   read `reached: false`, that is, edited by you, and the host would never
   touch them again. An offer is refreshed, as a new host version, when
   accepted work moves (`planRefresh`). So only an offer that sits while
   accepted work stays put can fall behind a cut.
7. **Your working copy must be moved with the abandon, or your next `jj`
   fails.** A working copy records the operation it last saw. The host's
   commands carry `--ignore-working-copy`, so that operation lags the head.
   The abandon rewrites it. In a scratch repo, your next `jj st` then
   failed: "seems to be a sibling of the working copy's operation", or
   after gc "Could not read working copy's operation". Each one needs
   `jj workspace update-stale`, and `jj op integrate` would bring the
   abandoned chain back. Two steps avoid it. First a snapshot as you
   (`jj st` with nothing changed made no operation, and moved the working
   copy's operation to the head). Then the abandon without
   `--ignore-working-copy`, which re-points a working copy whose
   operation is a head (`cli/src/commands/operation/abandon.rs`). Your
   next `jj st` was clean. A second workspace of yours is not re-pointed.
8. **A write that loaded the old head before the abandon brings the old
   chain back, and loses nothing.** Simulated with `jj --at-op <old head>
   new` after the abandon: the next command reconciled the two heads, the
   write was kept, and the op log was whole again (42 operations, not 7).
   That is safe only while the abandoned operations are still on disk. A
   gc in the same pass could leave such a write with missing ancestors.
   An editor open on `jj describe` holds its old head for minutes.
9. **On the Mac, the evolog is the slow refresh.** Measured on an APFS
   copy of Duane's repo, macOS 26.7.1, jj 0.45.1
   (`sandbox/trim-timing/run.sh`). `jj op log -n 1` took 20 ms and the
   offers' `jj log` 53 ms. The seven offers' whole evologs took 0.018,
   0.024, 0.026, 0.033, 0.83, 1.05 and 4.57 s, 6.5 s together, about the
   6.1 s the slowest refresh ran. With `-n 1` each took 15-31 ms.

10. **A remote bookmark of the host's own says which version is the
    host's, with no evolog.** The host would keep its version of each
    offer as `pinetrie-offer/<name>@pinetrie-host` (the git ref
    `refs/remotes/pinetrie-host/pinetrie-offer/<name>`), tracked by the
    offer's bookmark. Measured in a scratch colocated repo, jj 0.45.1:
    - **A rewrite moves your bookmark and leaves the host's.** When you
      reworded the WIP below, jj rebased the offer and showed
      `pinetrie-offer/x*`. The host's commit stayed where it was. `jj
      interdiff --from <host's> --to <yours>` was empty and the
      description the same, so this is not an edit. When you changed a
      file in the offer, the interdiff named it (`A y`). `jj bookmark list
      --all-remotes` printed "@pinetrie-host (ahead by 1 commits, behind
      by 1 commits)". In other words, jj itself tells you the offer is no
      longer the host's.
    - **The host moves both with one operation.** The host moved only the
      git ref, then ran `jj git import`, and your tracked bookmark
      followed in that same operation ("import git refs"), as it does
      after a fetch. The marker and the offer cannot be written apart, so
      a restart cannot lose the marker. That is why the evolog was used
      in the first place (S73). If you had edited the offer, the same
      import made the bookmark conflicted (`pinetrie-offer/x??`) instead
      of overwriting your version.
    - **It survives pruning.** After `jj op abandon ..@-` and `jj util gc
      --expire=now`, the host's commit was still there, since a ref holds
      it. The interdiff still read the same.
    - **You delete the offer, and the host's ref stays.** `jj bookmark
      list` showed `pinetrie-offer/x (deleted)` with its
      `@pinetrie-host` target. The host would then forget the ref.
    - **It must be tracked.** An untracked remote bookmark is in
      `builtin_immutable_heads()`. With one, jj refused to reword the WIP
      below the offer: "Commit … is immutable".

11. **What the ref does to the rest of your repo,** in a scratch repo
    with a bare `origin`, jj 0.45.1:
    - **A new offer is one operation.** `jj git import` with
      `--config remotes.pinetrie-host.auto-track-bookmarks=*` made the
      local bookmark and tracked it ("[new] tracked", one operation).
      Without that config the import made no local bookmark, and
      `jj bookmark track` took a second operation.
    - **An offer from before is marked in place.** The ref set to the
      bookmark's commit and imported with the same config: the bookmark
      tracked it, with nothing ahead or behind.
    - **In sync, it does not show.** `jj bookmark list` printed one line
      per offer, as now. The `@pinetrie-host` line appears only with
      `--all-remotes`, or when the two differ.
    - **Your pushes and fetches leave it alone.** `jj git push`, `jj git
      push --tracked` and `jj git fetch` with `origin` never named an
      offer. With `remotes.origin.auto-track-bookmarks=*` and
      `auto-track-created-bookmarks=*` set, an offer made by the import
      still did not track origin, and `--tracked` pushed only `main`.
      **An offer made as today, with `jj bookmark create`, did track
      origin under that config, and `--tracked` would have pushed it.**
      The ref removes a leak that exists now.
    - **A crash between the host's rewrite and its ref move** leaves the
      offer showing `*`, as your edit would. A rebase of the host's moved
      the bookmark (jj moves a bookmark with the commit it rewrites), and
      the ref stayed. The interdiff was empty. `jj evolog -n 2` from the
      bookmark reached the ref's commit, with the host as the user at
      each step. So a mismatch can be told apart by walking the evolog
      only as far as the ref's commit. That walk happens only on a
      mismatch, which in steady state is never.
    - **Archive:** `jj abandon` of the offer left `pinetrie-offer/b
      (deleted)` with its `@pinetrie-host` target. `git update-ref -d`
      on the ref and an import removed both.
    - **You move the bookmark by hand:** `pinetrie-offer/old*`, which is
      read as edited, as now.

12. **A trim on the Mac takes minutes, so the owner cannot wait for it.**
    The same copy kept seven days: 21,822 operations kept and 41,339
    abandoned.

    | step | Mac | Linux (item 5) |
    |---|---|---|
    | `jj op abandon ..<cut>` | 135 s | 14-33 s |
    | `jj util gc --expire=now` | 54 s | 12 s |
    | `jj debug reindex` | 31 s | 8.4 s |

    Afterwards, op store 532 MB, index 1.1 MB, `store` 3.5 MB, `.git` 34 MB,
    15,007 `refs/jj/keep`. The slowest whole evolog fell from 4.57 s to
    0.42 s. Cloning the repo took 90 s.
13. **An abandon costs a time for each operation it keeps, whatever it
    cuts.** In a scratch repo of 8,002 operations on Linux, keeping 500,
    2,000, 4,000 and 7,000 took 0.37, 1.09, 2.00 and 3.27 s, about 0.45 ms
    for each operation kept. On the Mac, 135 s for 21,822 kept is about
    6 ms each: the real repo's views are 26 KB, and APFS is slower. So
    trimming more often does not make a trim shorter. Only a shorter
    window does, or fewer operations a day. At 3,100 a day (the Mac copy's
    last seven days), a day's window would be about 19 s on the Mac.
14. **A write during the abandon doubles the window instead of losing
    anything.** A host write started 0.3 s into a 1.5 s abandon (6,004
    operations, 2,999 kept). The write was kept, and the next command
    reconciled the two heads. The log then held both the old chain and its
    rewritten copy, 9,006 operations. A later trim must cut each chain.
    So an abandon is safe beside a write but wasted by one. Your own
    commands race it too, and the owner cannot hold them.
15. **`jj util gc` without `--expire=now` is safe beside any writer.** It
    keeps every unreachable operation, view and git object whose file is
    newer than two weeks, by mtime (`lib/src/simple_op_store.rs` and
    `lib/src/git_backend.rs`, read, v0.45.1). An object a running command
    has written but not yet linked is new, so it is kept. A write during
    a default gc was kept. With `--expire=now` the same object could be
    deleted, and that is true on the owner too, since your own commands do
    not go through it. jj's `main` has no gc for the index either.

16. **A lane's turns must be imported to be reviewed.** A review of a
    range of turns reads them with jj in your repo (`revisionRead`,
    `fileDiff`). A commit that git holds under a ref jj does not import
    is unknown to jj: `jj log -r <id>` and `jj diff --from --to` both
    said "Revision … doesn't exist". So a turn's fetch needs its import,
    one operation, while turns can be reviewed during a run. Of the newest
    20,000 operations (item 3), the imports were 29%. The offer's rebuild
    after each turn (restore, describe, and some rebases) was most of the
    rest.
17. **`jj undo` undoes the newest operation, whoever made it.** You
    described a commit, the host then made one, and your `jj undo`
    reverted the host's ("Undid operation: … new empty commit"). Your
    commit kept its description. While lanes run, the host makes an
    operation every few seconds, so your undo usually lands on the host's.

18. **Deleting the host's ref with git can abandon your commits;
    `jj bookmark forget` does not.** Measured while planning, jj 0.45.1: an
    offer whose bookmark you had deleted, with a commit of yours on it,
    over your described `@-`. `git update-ref -d` on
    `refs/remotes/pinetrie-host/pinetrie-offer/x`, then `jj git import`:
    "Abandoned 2 commits that are no longer reachable", the offer's and
    your `@-`, and "Rebased 1 descendant commits": your commit, onto the
    root. With `jj bookmark forget --include-remotes pinetrie-offer/x`
    instead, the git ref was gone, the next import said "Nothing changed",
    and your commit kept its parent. In sync, the git delete also deleted
    the tracked bookmark (item 11's archive case). Other measurements made
    while planning:
    - `git update-ref <ref> refs/heads/<name>` takes a ref name as the
      value.
    - `jj bookmark track <name> --remote=pinetrie-host` makes the local
      bookmark when there is none, and writes no operation when it is
      already tracked ("Nothing changed").
    - Moving the host's ref after you deleted the local bookmark leaves
      the bookmark conflicted (`pinetrie-offer/x (conflicted)`). Setting
      the bookmark first (`jj bookmark set --allow-backwards`), then the
      ref from it and an import, leaves the two in sync, with no conflict.
    - `jj bookmark forget --include-remotes` of a name with nothing to
      forget exits 0 and writes no operation.
    - `jj util snapshot` exists, and writes nothing when the working copy
      is clean ("No snapshot needed").

**Other things the host reads by id, which a gc can remove.**

- **An archived lane's history.** Archiving deletes the lane's
  `refs/remotes/pinetrie-<lane>/tip`, so its commits are kept only by the
  operations that saw it. In a scratch repo, after abandon and gc,
  restoring it (`git update-ref` to its commit) failed: "nonexistent
  object". The same history parked under `refs/pinetrie/archived/<lane>`,
  a ref jj does not import and git gc keeps, survived. The restore and
  `jj git import` then worked.
- **A base's source rewritten after a catch-up.** `present()` keeps the
  read from failing, and the start falls back to the one S81 item 7
  describes.
- **A review of a lane's old turns** reads commits by id. They stay as
  long as the lane's tip descends from them. Not measured: whether
  any lane step rewrites turns already fetched.

## What it points to

1. **The host's version of an offer as a remote bookmark** (item 10),
   instead of the evolog. A build or refresh moves
   `refs/remotes/pinetrie-host/pinetrie-offer/<name>` and imports. The
   lane's one `jj log` prints both commits, and when they are the same
   the offer is the host's, with no further read. A stack's top
   commit hashes everything below it, so a matching top covers the
   whole stack. When they differ, each revision is compared with the
   commit of the same change in `::<host's>`, with the description and
   `jj interdiff` (`sameAs`). A divergent change's host commit is the one
   the ref names (`hostCommitIn`). No refresh reads the op log, and an
   unchanged offer's refresh drops from 3 jj processes to 2.
2. **History upkeep on the owner,** an upkeep key like `refresh:` (a
   `later("history")`), run when idle. With item 1, no offer depends on
   the op log, so the cut is a plain window:
   - **Window:** keep a set number of days of operations, which is how far
     back you can undo. Prune when the log holds twice the window, so each
     operation is rewritten about once (item 5's cost).
   - **Steps:** a snapshot as you, then `jj op abandon ..<cut>` as the
     host, without `--ignore-working-copy` (item 7).
   - **Collect on the next run, not this one:** `jj util gc --expire=now`,
     then `jj debug reindex` (items 4 and 8). The reindex is jj's one
     debug command in the cycle.
   - **Archive parks a lane's tip** under `refs/pinetrie/archived/<lane>`
     instead of deleting it.
   - `docs/the-jujutsu-repo.md` says how many days your op log keeps.

Item 11 settles the rest. A new offer is the ref and one import, with
`auto-track-bookmarks` for `pinetrie-host` on the command. An offer built
before is marked once at a host start, after today's check says it is
the host's. A mismatch walks the evolog only as far as the ref's commit,
which tells a crash from your edit.

## How it was measured

`.jj` and `.git` were copied from Duane's working copy
(`/mnt/host-working-copy`) to a Linux lane while his host ran. The op
heads were copied first, then everything missing, so that the head
operation was present. A second copy was pruned to 7 days, timed, then
collected. The evolog of every offer was read with the host's
`EVOLOG_ENTRY`, before and after, and walked with `parseEvolog` and
`walkToHost` from `packages/jj/plan.ts`. Items 7, 8 and the archived lane
were run in scratch colocated repos, with host operations made as
`operation.username=pinetrie-host` with `--ignore-working-copy`, as the
host makes them. The repo's own config (`immutable_heads()`) was not in
the copy, and the host's reads name their revsets in full.
