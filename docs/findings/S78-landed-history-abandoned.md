# S78 — your landed history abandoned when a lane's ref went missing

On 2026-10-02 at 10:48:04, with no command of the user's running, the
commits under `@` came back conflicted in 18 files. Three commits a take
had landed (`wyymlxnv`, `yvmprzss`, `mwzqvmwq`) were no longer ancestors of
`@`, and the commits above them (`mkwnuzpx`, `ltywxrpq`, and `@` itself)
had been rebased onto `nmsuztkr` without them.

**What the operation log held.** Read with `jj op log` and `jj op show`,
all `--ignore-working-copy`, in Pineta's own repo, jj 0.44.0.

| time | operation | effect |
|---|---|---|
| 10:45:22 | snapshot working copy | the last state with the history whole |
| 10:48:04 | `jj git import` (args `-R … --ignore-working-copy git import`, as the user) | `tip@pineta-t-01a0faee…` (cozy-mallard) went from a commit to absent; 151 revisions removed; `mkwnuzpx`, `ltywxrpq` and `@` rewritten |
| 10:48:20 | `jj git import` | `tip@pineta-t-01a0faee…` back at the same commit, with two new lanes' tips (`…fd6e`, a branch of it at the same commit, and `…fd37`); the 150 revisions back, but the rewritten commits not restored |

**Answers.**

1. **The history you had landed was referenced by lanes' remote bookmarks
   alone.** Takes put offers between `@-` and `@`; no local bookmark of
   yours moved with them (`main` was at 2026-09-29). Cozy-mallard had been
   brought up to date past them, so its tip held them as ancestors, and it
   was the only ref that did.
2. **`jj git import` abandons what no git ref reaches, whatever descends
   from it in the working copy.** With the ref absent, jj's default
   `git.abandon-unreachable-commits` abandoned the lane's history and the
   three landed commits with it, and rebased their descendants, `@`
   included, onto the nearest commit another ref still reached. The same
   mechanism as S74's base disk, here in your own repo.
3. **The ref came back 16 s later, and nothing undid the rewrite.** A later
   import restores the remote bookmark and the lane's commits; the commits
   already rebased stay rebased.
4. **Why the ref was missing for an import is not known.** Two lanes were
   being created then (`…fd6e`, a branch of cozy-mallard, and `…fd37`); each
   lane's fetch runs `git fetch` and `jj git import` on a queue of its own,
   and the queues run side by side. An import reading refs while another
   fetch rewrote them is one explanation; it was not reproduced.
5. **Restoring the operation brought the history back.** `jj op restore` to
   10:45:22, run with `--config git.abandon-unreachable-commits=false` so
   that the next import could not abandon it again, then a local bookmark
   `landed` on `ltywxrpq`, so that git refs reach the history without any
   lane. The restore also deleted the two new lanes' refs from git, which
   the view at 10:45:22 did not have; their next fetch writes them again.

**What follows.** Landed history must be reachable from a ref of yours, not
only from lanes' remote bookmarks: ADR-0060's line is that ref. Until it
exists, a local bookmark moved forward after takes (`jj bookmark move landed
--to @-`) is what protects it.
