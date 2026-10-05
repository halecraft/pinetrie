# S49 — an offer updated in place while its thread works

ADR-0038 builds a thread's offer afresh whenever the lane moves under an
unedited single offer: abandon the old commit, make a new one at the start,
restore the lane tip's files into it, rebase it onto the target, set the
bookmark, describe it. That is six operations in your repo, and a new change
id, after every commit the lane makes, which is after every tool call. In
use (2026-09-29), one thread working for ten minutes rebuilt its offer every
20 to 30 seconds: your `jj op log` filled with `pinetrie-host` operations, and
jjui showed a different commit each time, under the placeholder line.

This probe asks whether the offer can be updated in place instead, keeping
its change id. It cannot simply take the new tip's files: after the rebase
onto your target, the offer's tree is your target plus the lane's change,
not the lane's tip. So the update is three operations: rebase it back onto
its start, restore the new tip into it, rebase it onto the target.

jj 0.44.0, throwaway repos, a lane as a separate colocated clone fetched by
bundle, as in S48 (`sandbox/s48/lib.sh`). Probe: `sandbox/s49/p1.sh`, run by
`sandbox/s49/probe.sh`.

**Answers.**

1. **The update keeps the offer's change id and bookmark, in three
   operations.** `jj rebase -r <offer> -o <start>`, `jj restore --from <tip>
   --into <offer>`, `jj rebase -r <offer> -o <target>`, all with
   `--ignore-working-copy` and addressed by change id (S48 item 2). The
   bookmark moves with the rewritten commit. Your `@` was untouched: the
   offer is a child of your `@-`, never an ancestor of `@`.
2. **It is the offer a fresh build makes.** Against an offer built afresh
   from the new tip beside it, the tree was the same and `jj interdiff` was
   empty, in three cases: your committed work elsewhere (P1a; your edit to
   `c.txt` stays in the offer's tree, and out of its diff), your committed
   work conflicting with the lane's (P1b; conflicted before and after), and
   a turn that undid the conflicting edit (P1c; the conflict went away, and
   the offer's diff lost the file).
3. **The evolog keeps every step.** The offer's evolog lists each rebase and
   restore, so jjui shows one commit with a history, not a new commit per
   turn (P1d). The host's edit test (S48 item 7) compares against the
   commit it last wrote, so the host records the new commit after each
   update, as after a build.
4. **It is correct from a moved start too.** Where an offer starts moves
   without the lane moving when you take part of its work, as a parent
   thread's offer delivers a branch's inherited turns. Following onto the
   new start (P1e: you took turn 1 of two) kept the change id, left only
   turn 2's file in the offer, and gave the tree a fresh build from the new
   start gives. The restore was a no-op there, and jj recorded no operation
   for it: two operations, not three.
5. **When the start reaches the tip, a follow leaves an empty commit** (P1f:
   you took everything). So an offer with nothing left is withdrawn, not
   followed.
