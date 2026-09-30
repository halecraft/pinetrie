# S57 — reading an offer's revisions and diffs from jj

**Question.** A column's review (ADR-0047) shows each revision of an offer:
its description, its files with their line counts, and each file's diff. Can
the host read these from your repo with jj alone, in a shape a program can
trust, fast enough to answer on request? And may those reads run beside the
host's own jj commands?

**Answers.** jj 0.44.0, a throwaway repo with a modified file, a removed
file, a rename, a binary file, a file under a directory, and paths holding a
space and a quote.

1. **Per-file stats come from a template.** `self.diff().stat().files()` is a
   list of `DiffStatEntry`, with `path()`, `display_diff_path()`, `status()`,
   `lines_added()` and `lines_removed()`. `json(…)` quotes a string exactly as
   JSON does (`"we\"ird"`, `"two\n\nbody line\n…"`), so one template prints
   the wire shape itself:

   ```
   "{\"description\":" ++ json(description) ++ ",\"files\":[" ++
   self.diff().stat().files().map(|f| "{\"path\":" ++ json(f.path()) ++
   ",\"shown\":" ++ json(f.display_diff_path()) ++ ",\"change\":" ++
   json(f.status()) ++ ",\"added\":" ++ f.lines_added() ++ ",\"removed\":" ++
   f.lines_removed() ++ "}").join(",") ++ "]}"
   ```

   Its output parsed with `JSON.parse`, every file present.
2. **Renames and binaries.** A rename reads as `renamed`, `path()` the new
   path, `display_diff_path()` `{w => w2}`, 0 and 0. A binary file reads as
   `added` (or `modified`) with 0 and 0, and its git diff is
   `Binary files /dev/null and b/bin.dat differ`.
3. **One file's diff.** `jj diff --git -r <commit> -- 'root-file:"<path>"'`
   gives that file's diff alone. A quote in the path, escaped `\"` (as
   `JSON.stringify` writes it), works. For a rename, the new path alone gives
   the rename's header lines.
4. **`root:` is a prefix, `root-file:` one file.** `root:"dir"` gave the diff
   of `dir/f`; `root-file:"dir"` gave nothing, exit 0.
5. **A commit that is not there fails.** `jj log -r <unknown commit id>`
   exits 1: "Revision … doesn't exist".
6. **A read can write.** Two divergent operation heads were made with
   `jj --at-op <old> describe …`. A plain `jj log --ignore-working-copy`
   printed "Concurrent modification detected, resolving automatically",
   "Rebased 2 descendant commits onto commits rewritten by other operation",
   and left one head, `reconcile divergent operations`. So the host's reads
   of your repo must not run beside its writes: they share its queue.
7. **Cost.** Stats for a revision adding 30,000 lines took 7 ms. That file's
   diff was 927 KB and took 28 ms.

## Method

A repo from `jj git init`, one commit `base`, then one commit changing the
files above, with a description holding a body and a `Pineta-Entry` trailer.
Each answer is one command against that commit's id, run with
`--ignore-working-copy`, as the host's reads are (`hostOps`).

## Not tested

- A revision whose parent is a merge (a stack's bottom when your `@-` is a
  merge). `self.diff()` is a commit's diff against its parents' merged tree,
  as `jj diff -r` is, so it should read the same.
- Paths with control characters: `planOfferRead` refuses them before any jj
  command.
- Other jj versions. The template needs `DiffStatEntry`'s methods; an older
  jj fails the command, which the host answers 502.
