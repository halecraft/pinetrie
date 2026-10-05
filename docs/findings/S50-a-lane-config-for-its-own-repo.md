# S50 — a lane's jj config, for its own repo only

A lane's container sets `JJ_CONFIG=/workspace/.pinetrie-lane/jj.toml`, which
makes the fork's inherited history immutable (S42 item 4, ADR-0034). The
variable reaches every jj command in the container, not only the lane's repo.
In a lane, `pnpm run verify` failed: 3 tests in `packages/lanes/lanes.test.ts`
and the Node e2e's `committedProject`, each making a throwaway repo under
`/tmp`. This probe asks why, and whether jj can confine the setting to one
repo.

jj 0.44.0, in a lane. Throwaway repos under `/tmp/scope`, each `jj git init`
and one commit, with `JJ_CONFIG` pointing at a file of the probe's own.

**Answers.**

1. **A config naming a commit a repo lacks breaks that repo.** Under the
   lane's file, a fresh repo's `jj commit` printed
   ``Config error: Invalid `revset-aliases.immutable_heads()` ``, "Revision
   `<id>` doesn't exist". `jj log` with a template failed the same way, after
   a "Warning: In template expression". Every command that resolves
   `immutable_heads()` fails, which is nearly every command.
2. **jj scopes part of a config file to one repo:**

   ```toml
   [[--scope]]
   --when.repositories = ["/workspace"]
   [--scope.revset-aliases]
   "immutable_heads()" = "builtin_immutable_heads() | <fork commit>"
   ```

   With the scope naming `/tmp/scope/lane`:

   | repo | gets the setting |
   |---|---|
   | `/tmp/scope/lane` | yes; `jj describe` on the fork commit gave "Commit … is immutable" |
   | the same repo through a symlink, or with `-R` from `/` | yes |
   | a second workspace of it (`jj workspace add /tmp/scope/ws2`) | yes: jj matches the repo, not the working copy's directory |
   | `/tmp/scope/lane2` | no: jj compares whole path components, not strings |
   | `/tmp/scope/other` | no, and `jj commit` succeeded |
   | `/tmp/scope/lane/nested`, a repo inside it | yes, and it failed as in item 1 |

3. **The file still forks with the disk.** The scope names a path, and every
   lane's repo is at `/workspace`, so a fork's inherited file applies to the
   fork's repo until the fork's setup writes its own (`planForkSetup`).

**Consequence.** `forkConfig` writes the setting inside a scope naming
`/workspace` (`packages/lanes/plan.ts`). Other repos in a lane are left
alone. A repo nested inside `/workspace` still gets it. A lane made before
this change keeps its unscoped file, since only a fork's setup writes it.
