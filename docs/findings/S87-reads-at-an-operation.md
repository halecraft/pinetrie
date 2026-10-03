# S87 — a jj read pinned to an operation writes nothing

**Question.** S57 item 6 found that a plain jj read, run while the repo has
divergent operation heads, reconciles them: it writes an operation and
rebases descendants. That is why the host's reads of your repo wait on its
one queue, behind its writes. Does a read with `--at-op <id>` write too, or
does it only read the repo as that operation left it?

**Answer.** jj 0.44.0, a throwaway repo (`jj git init`, one commit `base`).

1. `jj describe -m x`, then `jj --at-op <base's op> describe -m y`, left
   two operation heads (`.jj/repo/op_heads/heads` held 2 files).
2. `jj --ignore-working-copy --at-op <one head> log` printed that head's
   history (`x`, `base`) and nothing else, and the heads stayed 2.
3. A plain `jj --ignore-working-copy log` printed "Concurrent modification
   detected, resolving automatically", showed both sides (`y`, `x`, `base`),
   and left 1 head, as S57 found.

4. **`jj op log` reconciles too.** With two heads, `jj --ignore-working-copy
   op log --no-graph -n 1 -T id` printed "Concurrent modification
   detected", wrote `reconcile divergent operations`, and printed that
   operation's id: one command both merges the heads and names the result.
5. **The heads are file names.** `.jj/repo/op_heads/heads` holds one empty
   file per head, named by the operation's full id, the same id
   `op log -T id` prints. A program can read the heads with `readdir`,
   without starting jj.
6. **Node's `fs.watch` sees each operation (macOS).** Watching that
   directory, each jj write fired `rename` events (the new head added, the
   old one removed, a `lock` file) within a millisecond, and a plain
   `jj log` with one head fired none.
7. **Pineta's repo, 2026-10-03.** Of 2,000 operations, 5 were
   `pineta-host`'s `reconcile divergent operations`, each about 70 ms after
   an `import git refs`: the fetch's `jj git import` (`importInto`, run on
   a lane's fetch queue, not the offers' queue) ran beside an offer's
   write. Those 471 imports are recorded as `duane`, not `pineta-host`:
   `importInto` passes no `operation.username`.

So a read pinned to an operation id is pure: it neither reconciles nor
writes, whatever else runs beside it. A program that reads the op head's id
first (`jj op log --no-graph -n 1 -T id`, itself a read that can reconcile)
and then reads at that id sees one consistent repo across all its reads.

## Method

```
jj git init .; echo a > f; jj commit -m base
base=$(jj op log --no-graph -n1 -T id)
jj describe -m x
jj --at-op $base describe -m y          # two op heads
h=$(ls .jj/repo/op_heads/heads | head -1)
jj --ignore-working-copy --at-op $h log  # heads: still 2
jj --ignore-working-copy log             # reconciles; heads: 1
```

Items 4–6 used fresh repos made the same way; item 6 ran a Node script
with `fs.watch(".jj/repo/op_heads/heads")` beside `jj describe`, `jj log`
and `jj new`. Item 7 read `jj op log -T 'user ++ description'` in Pineta's
repo.

## Not tested

- Cost: whether `--at-op` loads slower than the head on a large op log.
- An id abbreviated or garbage-collected (`jj op abandon`) between the two
  reads: the read should then fail, exit non-zero, and be retried at the
  new head.
