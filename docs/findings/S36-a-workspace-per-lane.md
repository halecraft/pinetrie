# S36 — what a jj workspace per lane costs, and where it breaks

**Answers.**
1. **`jj workspace add` is cheap: 0.2 s for this repo's 178 tracked files.**
   The expensive part is dependencies.
2. **An APFS clone gives a workspace its own `node_modules` in about 6 s and
   11 MB.** `/bin/cp -c -R` over the root's and every package's
   `node_modules` (493 MB) took 5.8 s and used 10.7 MB of disk. It needs
   `/bin/cp`: the `cp` on this machine's `PATH` is GNU's, which has no `-c`.
3. **Symlinking `node_modules` back to your working copy would test the wrong
   code, silently.** pnpm links workspace packages relatively
   (`packages/client/node_modules/@pineta/core -> ../../../core`), and Node
   resolves a symlink to its real path before resolving from it. A workspace
   whose `packages/client/node_modules` pointed into your working copy would
   import your `packages/core`, not the agent's edited one. A clone keeps the
   relative links, so they resolve inside the workspace (measured: `realpath`
   of `@pineta/core` from the clone is the clone's `packages/core`).
   `node_modules` is also written to (`.vite`, `.cache`), so a shared one
   would be shared writes.
4. **A clone runs the workspace's own code** (measured). An export appended to
   the workspace's `packages/core` was visible to `import("@pineta/core")`
   from the workspace's `packages/client`. `LANE_PREFIX` changed to `"x-"` in
   the workspace failed 3 of its 343 tests, while your working copy passed.
   The unit suite took 2.9 s in the workspace.
5. **Links that leave the repo break at a different depth, and a relink step
   fixes them.** The `link:` dependencies on Kyneta are relative
   (`../../../../../kyneta/…` from `packages/pi/node_modules/@kyneta`), so
   under `sandbox/ws-probe/` all 18 of them dangled. Re-pointing every symlink
   whose relative target leaves the workspace to an absolute path, resolved
   from the source tree's matching location, took 44 ms, and
   `@kyneta/schema` then resolved.
6. **Concurrent snapshots are safe.** 20 `jj util snapshot`s at once, half
   from each workspace, while files were written in one: all succeeded, every
   file landed in the workspace's working-copy commit, no change diverged.
   Files under a gitignored directory never reach the default workspace's
   snapshot.
7. **A rewrite of a workspace's ancestor from elsewhere, while it has edits
   not yet snapshotted, diverges its working-copy change and takes those
   edits off its disk.** Sequence: the workspace's base was rewritten from the
   default workspace (`jj restore --into`, a content change), a file was then
   written in the workspace, and `jj workspace update-stale` was run there. It
   reported "Concurrent modification detected, resolving automatically". The
   working-copy change became divergent: one commit held the new file, the
   other, which the workspace then checked out, did not, so the file left
   the disk. Nothing was lost from the repo, since the file is in the other
   commit, but the agent's directory no longer holds its own edit.
   - Any jj command in the stale workspace (`jj st`) fails with "The working
     copy is stale" until `update-stale`.
   - A rewrite that changes only a description does not stale the workspace;
     jj 0.44 carries it along silently.
   - So a lane cannot fork from your live `@`: every snapshot of your working
     copy rewrites `@` and rebases every lane above it. A lane forked from a
     commit you rarely rewrite still meets this whenever you do.
8. **A symlink swap cannot keep the agent's directory invisible.** With a
   lane's directory as a symlink swapped atomically (`rename`) from the repo
   root to a workspace:
   - `bash` spawned with `cwd` at the link, as pi's `NodeExecutionEnv` does,
     prints the real path even for plain `pwd`: pi passes the host's
     environment, so the inherited `PWD` does not match and bash
     recomputes it. `jj root` and Node's `process.cwd()` print the real path
     too. The agent learns the real path at its first command.
   - A command started after the swap runs in the new directory; one started
     before it stays in the old one (a watcher, a dev server).

## What this means for the design

- Creating the workspace with its lane costs about 6 s and 11 MB here, most
  of it the clone. Creating it at the agent's first write saves that for
  read-only threads, at the price of a switch mid-run that the agent can see
  (item 8).
- Lanes must not fork from a commit that is rewritten routinely (item 7).
  The host must snapshot a lane's workspace often (after each file-changing
  tool call and at each run's end), so that little is ever outside a commit,
  and run `update-stale` only between runs.
- Per-repo setup after `workspace add` is required, and is generic: clone
  every `node_modules`, then relink what leaves the workspace.

## Addendum: keeping lanes fresh without `update-stale`

A **run revision** is the commit the host makes in a lane's workspace when a
run ends (`jj commit`), recording the lane's files then; the run's last entry
points at it. A new lane starts its workspace from the nearest run revision
at or above its fork point, and a fold merges the source's latest one.

A workspace goes stale only when something outside it rewrites its
working-copy commit or an ancestor of it. Three workspaces on a throwaway
base: A, a lane with a run revision `C`; B, a lane forked from `C`; T, a fold
target.

9. **An immutable run revision keeps a lane from staling another** (measured).
   With `immutable_heads()` extended to the run revisions in A's
   workspace-level config (`jj config set --workspace`), `jj squash` and
   `jj describe -r @-` from A were refused ("Commit … is immutable");
   `jj new` on top of `C` worked; B stayed fresh. The control: with the
   config unset, `jj squash --into C` from A rebased B's commits and B's
   next `jj st` failed as stale.
10. **Workspace-level config protects only from that workspace, and outlives
    it.** A `jj describe` of `C` from the default workspace, which had no such
    config, succeeded. The config file is not in the workspace directory but
    at `~/.config/jj/workspaces/<id>/config.toml`, and `jj workspace forget`
    leaves it there.
11. **A fold as a merge rewrites nothing** (measured). `jj new <T's
    run revision> <B's run revision>` in T's workspace made a merge commit; B's
    run revision kept its commit id and stayed visible, and A and B stayed
    fresh. A file both sides changed was written to T's disk as a jj conflict
    (`<<<<<<<`, a diff from the base to one side, the other side's
    snapshot). Resolving it was an ordinary edit.
12. **A repeated fold takes only what is new** (measured). After T resolved
    and committed a run revision, and B committed one with one more file, a second merge brought
    only that file, with no conflict.
13. **A jj command that wants an editor hangs a shell with no terminal.**
    `jj squash --into C` from A, both commits described, opened `nvim` on a
    description file and waited until killed; the squash was not applied.
    `--use-destination-message` avoided it. An agent's `bash` has no terminal,
    so a lane's environment needs a non-interactive editor (for example
    `JJ_EDITOR=false`), or the agent's command hangs until its timeout.

So `update-stale` is not a routine step: nothing in a lane's normal life
rewrites another lane's history, provided run revisions are immutable and folds
are merges. It remains a guard at a run's start, a no-op unless someone
rewrote a lane deliberately (item 7's hazard applies only to edits not yet
snapshotted, and the previous run's end snapshotted everything).

## Not measured

- `pnpm install --offline --frozen-lockfile` in a fresh workspace, as an
  alternative to cloning.
- pi routing a per-lane working directory through the run's `Context` to
  `toolContext`, including a run resumed after a restart.
- Whether a workspace directory inside the repo but *not* gitignored is kept
  out of the default workspace's snapshot (the probe used `sandbox/`, which
  is ignored).
- The e2e and browser suites in a workspace (ports, Playwright).
- `immutable_heads()` in repo-level config instead, which would also protect
  run revisions from the default workspace, and cost a line in your repo's
  config.

## Method

A throwaway commit on `@-` (`jj new @- --no-edit`), a workspace on it at
`sandbox/ws-probe` (`jj workspace add --name s36-probe -r <base>`), then:
clone, relink, import check, unit suite with and without a planted break,
parallel snapshots via `xargs -P 20`, the base rewritten from the default
workspace with `jj restore --from @ --into <base> <file>`, and a Node script
spawning `bash` at a symlink swapped mid-command. Afterwards the workspace was
forgotten and its three commits abandoned; none was an ancestor of `@`, which
was unchanged.

## Why it was asked

A workspace per lane (ADR-0019) was to be designed as automatic. Whether to
create it with the lane or at the agent's first write depended on what a
workspace costs, and whether the switch at a first write could be hidden from
the agent.
