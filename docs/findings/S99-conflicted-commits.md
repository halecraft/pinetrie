# S99 — git reads a conflicted jj commit as every side's tree, and an offer that starts conflicted keeps the conflict

**Status:** Answered. Served `PLAN-2026-10-04-catch-up-parent`.

**Question.** A thread's resolution turn counted "2084 files", in a repo of
694 tracked files. A branch of that thread, cloned while its parent's
catch-up was still conflicted, resolved the same conflict as its parent,
and its offer then conflicted with the project, which already held the
parent's identical resolution. Where do the 2084 paths come from, and why
does an offer conflict where both sides hold the same text?

**Kill criterion.** If `git diff --name-only` between a conflicted commit
and its resolution lists only the resolved file, the count comes from
somewhere else.

**Throw away.** A scratch repo in `/tmp`, made with `jj git init --colocate`.

**Answers.**

1. **Git reads a conflicted jj commit as a tree of every side.** jj stores
   a conflicted commit for git as directories `.jjconflict-base-<n>/` and
   `.jjconflict-side-<n>/`, each holding the whole tree, and a file
   `JJ-CONFLICT-README`. In the thread's lane, `git diff --name-only`
   from the commit before the update to the conflicted merge listed 694
   paths under each of `.jjconflict-base-0`, `-side-0` and `-side-1`, the
   README, and the real changes.
2. **The 2084 is that tree, deleted.** From the conflicted merge to the
   resolution, git listed 2084 paths: 3 × 694 = 2082 under `.jjconflict-*`,
   `JJ-CONFLICT-README`, and `docs/pinetrie.md`, the one file resolved.
   `changedPaths` (`packages/lanes/revisions.ts`) read a turn's paths with
   `git diff`, so the turn's revision record held all of them, and the
   ask's file count (`workStats`) was their number.
3. **jj's own diff names the file.** In the scratch repo, two sides changed
   `d/f.txt`, their merge conflicted, and a commit resolved it. `git diff
   --name-only` from the merge to the resolution listed 8 paths, every one
   under `.jjconflict-*`. `jj diff --from <merge> --to <resolution> -T
   'json(path) ++ "\n"'`, run from `d/`, printed `"d/f.txt"` alone: a
   diff entry's `path` is from the repo's root, whatever the process's
   directory, unlike `--name-only`'s. So `changedPaths` reads jj's diff
   with that template.
4. **An offer whose start is conflicted carries the conflict's terms.** The
   branch's offer starts at the parent's conflicted merge `M`, whose tree jj
   holds as `ours + theirs − base`: the parent's work, plus the project
   commit it merged, minus their base. The offer is rebuilt on the line
   `L` as `tip + L − M`. jj showed the result as three sides, the offer's
   tip, `L` against the project commit, and the base against the parent's
   work, and could not cancel them, though the branch and the parent had
   resolved the file the same way. The conflict was the start's, not the
   branch's work.
5. **Merging the parent's resolution conflicts too, for the same reason.**
   In `repo.test.ts`, a branch cloned at a conflicted catch-up resolved the
   file as its parent did, and `jj new <branch> <parent>` still left the
   file conflicted: the merge's base is the conflicted commit, so jj holds
   five terms (both resolutions, the base's three) and cancels none, though
   the two sides are byte for byte the same. Both sides holding a file
   alike decides it whatever the base, so an update now takes such a file
   from the side merged in (`heldAlike`, `mergeUpdate`), and the merge is
   clean.
6. **Then the offer is empty.** The merge puts the parent's taken source,
   and any newer `Pinetrie-Base` of the parent's, in the branch's history, so
   the offer's start (`offerStart`) moves above them, and the branch's work
   from there changes no file. `PLAN-2026-10-04-catch-up-parent` adds that
   catch-up (ADR-0072), and an offer now says when every file it conflicts
   in was already conflicted where it starts.
