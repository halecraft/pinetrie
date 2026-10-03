# S83 — reading an update's sides in one `jj log`, and what a fetch by id skips

`PLAN-2026-10-03-update-fcis` reads both sides of an update's merge in one
`jj log` per side, where it read once per conflicted file, and drops
`fork_point` from its revsets. This records the probes it rests on, with
jj 0.44.0 (the lane image's `JJ_VERSION`) and git 2.47, in throwaway repos.

**Q1. Can one `jj log` say which of several files each revision touched?**
Yes. With the files as the log's path arguments and again in the template,

```
jj log --no-graph --reversed -r <range> \
  -T '"{\"description\":" ++ json(description) ++ ",\"paths\":[" ++
      self.diff("root:\"a.txt\" | root:\"sub/b c.txt\"").files().map(|f| json(f.path())).join(",") ++ "]}\n"' \
  'root:"a.txt" | root:"sub/b c.txt"'
```

prints one JSON object per revision that touched any of them, each listing
only those files it touched. A revision touching only another file is not
printed. Run from a subdirectory, `f.path()` is from the repo's root
(`sub/b c.txt`, not `b c.txt`). A description with a tab and quotes, and a
path with a space, come back intact through `JSON.parse`. `self.diff()`
takes a string literal only: `self.diff(fileset)` is a parse error.

**Q2. Is `fork_point(a | b)..b` the same set as `a..b`?** Yes. Checked on a
criss-cross history, where `fork_point` names two commits: both forms gave
the same commits, in both directions. The ancestors of `fork_point(a | b)`
are the commits both sides share, so `::b ~ ::fork_point(a | b)` is
`::b ~ ::a`.

**Q3. Does `fetchById` fail when it names a commit only the lane has?** No.
Its `git fetch <your repo> +<a>:… +<b>:…` runs when the lane lacks any of
them, and `git fetch` skips a wanted commit the fetching repo already holds:
with `<a>` only in the source and `<b>` only in the destination, it exits 0.
So an update that named the lane's previous copy for a WIP's copy did not
fail; it named a commit it never needed. `planWipCopy` now fetches nothing,
and its callers name what the lane may lack.
