# S56 — an agent that commits in its lane

After each assistant message whose tools changed tracked files, the host
commits the lane's working copy (`commitTurn`, ADR-0032) and moves the lane's
bookmark, `pineta/<lane>`, to the commit. The offer is fetched from that
bookmark (ADR-0038), and a branch at a message runs `jj new` on the nearest
recorded commit, on a clone of that message's disk (ADR-0034). This probe asks
what happens when the agent commits itself, with `jj commit` or `git commit`,
in a turn.

jj 0.44.0 and git 2.47.3, in a lane, in throwaway repos: a repo of yours and
a lane's repo, with the lane's steps run on the host, as
`packages/lanes/lanes.test.ts` runs them. The test is "a commit the agent
makes itself is the turn's revision", one case for jj and one for git.

**Answers.**

1. **The host records no revision for the turn.** After the agent's commit C,
   `@` is empty, so `commitTurn` finds nothing changed and returns null. The
   bookmark stays on the previous turn's commit B. With `git commit`, jj
   imports the moved `HEAD` at its next command and puts an empty `@` on C,
   so the result is the same.
2. **The offer lacks C.** Your repo fetched the lane's bookmark, and its tip
   held `a.txt` and `base.txt`, not the agent's `b.txt`. A later turn that
   changes files commits on top of C and carries it along. If C came in a
   run's last turn, the offer lacks it until the next run changes a file.
3. **A branch at that turn loses C, silently.** The turn's record has the
   turn's snapshot and no commit, so the nearest commit above is B: the
   pairing `nearestRevision` makes on purpose for a turn that changed only
   ignored files (`packages/core/work.test.ts`, "a turn that changed only
   ignored files"). The fork's `jj new B` on the cloned disk removed `b.txt`.
   Nothing reported an error.

**Consequences.** Telling the agent to leave commits to Pineta (ADR-0046) is
not enough, since an agent may still commit from habit or because a person
asks. The host adopts the agent's commit as the turn's revision when it
descends from the lane's bookmark (`planTurnCommit`, ADR-0032 as amended).

## Method

`packages/lanes/lanes.test.ts`, with the host's `commitTurn` as it was before
adoption. Each case:

1. your repo with one commit, the lane's base disk from it, and `planForkSetup`;
2. a turn writing `a.txt`, committed by `commitTurn` (B);
3. `b.txt` written and committed by the agent, with `jj commit -m mine` or
   `git add b.txt && git commit -m mine`, then `commitTurn` for that turn;
4. `planFetch` into your repo, and `jj file list` of the lane's tip there;
5. the lane's directory copied, and `planForkSetup` on the turn's commit, or B
   when the turn recorded none.

With soft assertions, every case failed all three checks: `commitTurn`
returned null, the tip's files were `a.txt` and `base.txt`, and `b.txt` was
missing from the fork.
