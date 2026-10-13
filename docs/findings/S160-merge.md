# S160 — Merging two states path by path agrees with jj on 99.8% of the paths both sides changed in 313 of pine·trie's merges; what it lacks is a tree-level step: directory against file, modes as their own field, and renames, which neither it nor jj follows

Numbered S156 until 2026-10-11, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0135, ADR-0142

**Question.** In pine·trie's model, offer, accept and catch up are merges of
states. The plan is a merge of pine·trie's own, path by path, under these
laws:
- a path changed on one side only takes that side;
- the same change on both sides is taken once;
- otherwise the type's merge runs: diff3 for text (here
  `git merge-file`, with an empty base for two files added at one path),
  and a conflict, kept as a value, for anything else.

Does that agree with jj's merge on the same inputs? Where it does not,
which one is right? And can text merges be handed to jj, so that jj is a
merge type inside the model rather than the model itself?

**Kill criterion.** If agreement needs jj's whole-commit context, beyond
what a path-by-path merge sees (renames being the likely case), then the
merge type for text is jj's, and the codec is used both ways at every
merge.

**Throw away.** `docs/findings/S160-merge/merge.py`:
- `history` runs every two-parent merge in duane's repo, from a mirror of
  `/mnt/host-working-copy`, through three merges:
  - the path-by-path merge;
  - jj, as `jj new p1 p2`;
  - git's own merge, `git merge-tree`, which follows renames.

  Each is compared with the merge commit that was recorded.
- `synthetic` runs constructed cases through all three.

The results are `results-history-313.json` and `results-synthetic.json`.
The figures come from the first full run, of 313 merges, which took about
five minutes.

A second run reused the jj repo, which by then held the first run's own
merges (kept by jj's `refs/jj/keep`). It counted every merge three times,
and a third run, slower still, was stopped after 46 minutes. The
disagreements in `results-history-313.json` are the second run's list,
keeping only the original merges. Their counts match the first run's
totals.

Run in a lane with jj 0.45.1 (empty config) and git 2.47.3.

## Answers

1. **On real merges, the path-by-path merge agrees with jj almost
   everywhere.**
   - **The merges:** 313, each with a single merge base. Between them,
     35,651 paths were changed on one side only, and 5,788 on both sides.
     113 merges had no path changed on both.
   - **The path-by-path merge's results** on the 5,788:
     - 5,132 clean;
     - 614 conflicts in text;
     - 40 deletions against edits;
     - 2 binaries.
   - **Against the others:**
     - **jj** agreed on 5,775 (99.78%). Its 13 disagreements were in two
       merges.
     - **git's merge** agreed on 5,762 (99.55%).
     - **The recorded merge** kept 5,075 of the 5,132 clean results
       (98.9%). The rest were changed in the merge commit itself: a
       resolution, or work done in the same commit.
   - **Every conflict outside the paths both sides changed** came from
     renames: jj found such conflicts in one merge, git in five.
2. **Where they differ, and which was right.** The recorded merge is
   taken as the answer, where it matches one of the three.

   | paths | path by path | jj | git | the recorded merge matches |
   |---|---|---|---|---|
   | 23 | conflict: deleted against edited | conflict | clean | git in 8, none in 15 |
   | 12 | clean | conflict | clean | none |
   | 2 | clean | clean | conflict | path by path, and jj |
   | 1 | conflict (text) | clean | clean | jj and git |

   - **The 23 are renames.** One side moved a file (an ADR into
     `docs/adrs/archive/`, a package to a new name) and the other edited
     it. git followed the move and applied the edit. The path-by-path
     merge and jj both saw a deletion against an edit. Where the recorded
     merge matches any of the three, it matches git.
   - **The 2 are a rename git made up.** It paired files that were not one
     file moved, and the recorded merge agrees with the path-by-path merge
     and jj.
   - **The 12 are one merge (`94944fd901e7`).** jj reported a conflict in
     each of 12 files that both of git's merges joined cleanly. The
     recorded merge matches neither: it kept one side's text. The cause of
     jj's conflicts was not looked into.
   - **The 1** is `git merge-file` finding a conflict that jj's merge and
     git's merge both resolve, as the recorded merge does. It is a
     difference in the diff algorithm, not in the laws.
3. **The constructed cases show what a merge by path misses**
   (`results-synthetic.json`):

   | case | path by path | jj | git |
   |---|---|---|---|
   | edits apart in one file | clean | clean | clean |
   | edits to one line | conflict | conflict | conflict |
   | the same edit on both sides | clean | clean | clean |
   | deleted against edited | conflict | conflict | conflict |
   | renamed against edited | conflict; the renamed copy lacks the edit | the same | **clean, with the edit in the renamed file** |
   | renamed two ways | clean, both copies kept | the same | conflict |
   | a directory against a file at one path | **no conflict found: the tree it gives cannot exist** | conflict | conflict |
   | binary on both sides | conflict | conflict | conflict |
   | added on both sides at one path | conflict | conflict | conflict |
   | mode on one side, content on the other | **conflict** | clean, both kept | clean, both kept |

**Against the kill criterion.** It does not fire. jj merges by path too:
it doesn't follow renames, and it agrees with the path-by-path merge
wherever renames are not involved. So there is no context jj has that the
model's merge lacks. Renames are context neither has. git's merge has it,
and it was right in every case where the recorded merge agrees with any
of the three, but it also invented a rename twice.

**What the model's merge needs, beyond the laws as written.**
1. **A tree-level check, before merging by path.** Two paths can each be
   clean and still not fit together: one side adds `d/f.txt` while the
   other adds a file `d`. The merge must check that the result is a tree.
   jj and git both do.
2. **The mode as its own three-way field.** One side changing the mode and
   the other the content is not a conflict.
3. **Renames, as an optional step over the two diffs.** Pair each side's
   deletions with its additions by content similarity, as git does, and
   carry the other side's edit across. That is a pure function of the two
   diffs and needs no VCS. Here it decided 23 paths of 5,788 (0.4%), and
   it was wrong twice. So a rename it infers should be shown as a guess,
   or kept as a conflict with the guess offered as a resolution.
4. **Content merges can come from either tool.** `git merge-file` (diff3)
   and jj's merge differ on one path in 5,788 and in one unusual merge.
   For text, the model can use either one as its merge type. jj adds
   nothing a merge by path lacks, so it doesn't have to be the model.
