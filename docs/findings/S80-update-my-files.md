# S80 — "update my files": which rebase, a preview, and conflicts

- **Status:** Answered
- **Led to:** ADR-0061, ADR-0104

`PLAN-2026-10-03-jj-ux`, task 6, asks for an action that brings the
project's work (the integration line, `pinetrie-onto`) into your own work: a
rebase of your commits onto the line, run only when you ask, after a
preview. Probed on a disposable colocated repo, jj 0.44.0, git 2.47. The
script is below; every answer is from its output.

**The repo.** `L0` is the line. Your `Y1` sits on `L0` and changes `g.txt`;
`sibling` and `@` both sit on `Y1`; `@` holds a file not yet snapshotted
(`h.txt`). The line then moves to `L1`, on `L0`, which changes `f.txt` and
`g.txt`.

**Answers.**

1. **`jj rebase -b @ -d <onto>` and `jj rebase -s 'roots(<onto>..@)' -d
   <onto>` move the same commits**: `Y1` and everything above it, `sibling`
   included, which is not an ancestor of `@`. Both name the roots of your
   work above the line and move their descendants with them.
2. **`jj rebase -r '<onto>..@'` is not an alternative.** It moves only
   `Y1` (`@`'s ancestors above the line, and `@`) and reparents what else
   descends from them onto their old parents: `sibling` would lose `Y1`'s
   change. So a preview has to name the other heads that move with your
   work, and the rebase moves them.
3. **A preview can change nothing: `git merge-tree`.** In the colocated
   repo, `git merge-tree --write-tree --name-only --merge-base=<fork point>
   <onto> <@>` exits 1 and names `g.txt` as conflicting; the tree it
   writes, against `@`'s, names the files your working copy would see change
   (`f.txt`, `g.txt`). It writes only a tree object: no ref, no jj
   operation, nothing jj or jjui shows. It previews `@`'s files only: a
   commit lower in the stack can conflict where the top does not, and the
   rebase would mark it.
4. **The preview reads `@` as last snapshotted.** The host's jj never
   snapshots your working copy (`--ignore-working-copy`); the rebase,
   run as you, snapshots first, so `h.txt` moved with `@` and was kept.
   A preview made from a stale `@` can miss a conflict in a file edited
   since the last snapshot.
5. **A conflict does not stop the rebase.** `Y1` conflicts, and so do
   `sibling` and `@`, which inherit it. The markers are in `@`'s files
   only (`g.txt`), in jj's diff style, naming "the rebase destination" and
   "the rebased revision". `jj st` says to resolve at the conflicted
   commit: `jj new Y1`, resolve, `jj squash`. Resolving in `@` alone leaves
   `Y1` and `sibling` conflicted in the log.
6. **The rebase is the user's operation** when run without
   `operation.username`: the op log names the user, as "land my work" does
   (`hostJj`).

**What follows for the ADR.**

- The rebase is `-b @ -d <onto>`, and the preview names every head that
  moves with it, besides `@`.
- The preview is `git merge-tree` against `@`, made after a snapshot the
  user's own jj would make anyway, and it names the files that change and
  those that conflict.
- A conflict resolved by the agent is resolved at the lowest conflicted
  commit, not only in `@`, or the log keeps showing your earlier commits
  conflicted.

**The script.**

```sh
cd /tmp && rm -rf s79 && mkdir s79 && cd s79
jj git init --colocate
cid() { jj log -r "$1" --no-graph -T 'change_id.short()'; }
printf 'a\nb\nc\n' > f.txt; echo base > g.txt
jj commit -m L0; L0=$(cid @-); jj bookmark create pinetrie-onto -r $L0
echo yours > g.txt; jj describe -m Y1; Y1=$(cid @)
jj new $Y1 -m sibling; echo s > s.txt
jj new $Y1; echo h > h.txt; AT=$(cid @)
jj new $L0 -m L1; printf 'a\nB\nc\n' > f.txt; echo line > g.txt; L1=$(cid @)
jj bookmark move pinetrie-onto --to $L1
jj edit $AT
jj log -r 'roots(pinetrie-onto..@)::'      # Y1, sibling, @
jj log -r 'pinetrie-onto..@'               # Y1, @
B=$(jj log -r 'fork_point(pinetrie-onto | @)' --no-graph -T commit_id)
O=$(jj log -r pinetrie-onto --no-graph -T commit_id)
A=$(jj log -r @ --no-graph -T commit_id)
git merge-tree --write-tree --name-only --merge-base=$B $O $A   # g.txt, exit 1
jj rebase -b @ -d pinetrie-onto            # Y1, sibling, @ conflicted; markers in g.txt
```
