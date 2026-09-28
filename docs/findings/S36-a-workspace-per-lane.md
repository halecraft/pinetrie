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

14. **Node's `fs.cp` does not clone on macOS** (measured, Node 24.19, root
    `node_modules`, 31 427 entries). With `mode: COPYFILE_FICLONE` it took
    9.0 s and used 569 MB: a full copy. `COPYFILE_FICLONE_FORCE` failed with
    `ENOSYS`. `/bin/cp -c -R` on the same tree took 5.8 s and 13 MB. A
    copy-on-write copy has to come from the platform's own tool.

15. **Initializing a project is one command either way** (measured, jj
    0.44, throwaway repos). In a git repo without `.jj`,
    `jj git init --colocate` imported it; `git status` afterwards still said
    `On branch main`, clean. In a plain directory, `jj git init` created both
    `.git` and `.jj`: colocated is the default.
16. **`.git/info/exclude` keeps workspaces out of snapshots without touching
    a tracked file** (measured). With `/workspace/` in it, a file under
    `workspace/t-x/` did not appear in `jj st`.

17. **Only jj can say where a jj repo is** (observed, read-only, in
    `~/halecraft/kyneta/workspace/pineta`, a secondary workspace nested in
    the Kyneta repo). There `.jj/repo` is a *file* holding
    `../../../.jj/repo`, not a directory, so a check for `.jj/repo/` finds no
    repo. From `packages/schema` inside it, `git rev-parse --show-toplevel`
    answered `~/halecraft/kyneta`, the outer repo, while
    `jj workspace root --ignore-working-copy` answered the workspace. Outside
    any repo, jj exits 1 with "There is no jj repo in". Every lane's
    workspace has this nested shape.

So `update-stale` is not a routine step: nothing in a lane's normal life
rewrites another lane's history, provided run revisions are immutable and folds
are merges. It remains a guard at a run's start, a no-op unless someone
rewrote a lane deliberately (item 7's hazard applies only to edits not yet
snapshotted, and the previous run's end snapshotted everything).

## Addendum 2: before the plan

Measured after ADR-0032 and ADR-0033 were written, to settle what they left
open. jj behaviour in a throwaway repo under `/tmp`; the suites in a Pineta
workspace under `sandbox/`.

18. **pi takes each lane's directory from the run's `Context`** (measured, a
    scripted model, `MemoryStorage`). `toolContext` as a function of the
    `Context`, and the directory passed with `withContextValue`:
    - two lanes prompted at once each ran `bash pwd` in their own directory;
    - the system prompt, a function of the tool context, named each lane's;
    - after a crash (a second harness over the same storage, the first one's
      tool call never returning), `prompt` on the lane failed `LaneBusy`
      ("already has an active operation"). `resume` succeeded. It did not run
      the hanging call again but recorded it as interrupted, and the resumed
      run's next tool call ran in the directory in `resume`'s `Context`.

    So every call that drives a lane (`prompt`, `resume`) must carry the
    lane's directory. `packages/pi/agent.ts` says `LaneBusy` cannot arise,
    but after a crash it does, until something calls `resume`.
19. **Repo-level immutability through a bookmark protects a lane's base from
    you** (measured). With `bookmarks(glob:"pineta/*")` in the repo's
    `immutable_heads()` and `pineta/t-1` on the lane's base `P` (your `@-`),
    `jj squash` into `@-` and `jj describe -r @-` were refused ("Commit … is
    immutable"). Editing and describing `@`, and `jj new`, worked.
20. **Landing works end to end** (measured). The lane committed a change to a
    line, and you committed a different change to it and kept editing.
    - The lane's `jj new <its revision> <your @->` conflicted on that line;
      it resolved the line and committed.
    - Your `jj rebase -r @ -d <merge>` put your `@` on the merge. Your
      uncommitted file came along, the shared file held both changes, and
      nothing conflicted.
    - The lane stayed fresh, your `@` stayed editable, and the merge, now
      your `@-`, was immutable.
21. **`JJ_EDITOR=false` makes an editor-wanting command fail at once**
    (measured): `jj describe` with no message failed in 0.4 s, "Editor 'false'
    exited with exit status: 1".
22. **`.git/info/exclude` applies in a secondary workspace too** (measured,
    with a control). With `/workspace/` excluded, neither the colocated
    workspace nor a secondary one listed `workspace/…` in `jj st`; without
    the line, both did.
23. **`jj git push --all` would push the lanes' bookmarks** (measured,
    `--dry-run` to a local bare remote): `pineta/t-1` was listed beside
    `main`.
24. **A git worktree cannot be colocated, and a subdirectory project
    initializes at git's top level** (measured). In a worktree (`.git` a file
    naming `.git/worktrees/…`), `jj git init --colocate` failed: "Cannot
    create a colocated jj repo inside a Git worktree". From a subdirectory of
    a git repo, `jj workspace root` found nothing and git named the top
    level. `jj -R <top> git init` failed, because `-R` needs an existing repo,
    so init must run with the top level as its working directory. Afterwards
    `jj workspace root` from the subdirectory named the top level, and
    `git status` was clean on `main`.
25. **The whole gate passes in a workspace, and two e2e runs do not
    collide** (measured). In a workspace set up by clone and relink (7.6 s in
    all):

    | lint | typecheck | test | conformance | e2e |
    |---|---|---|---|---|
    | 1.5 s | 4.2 s | 3.8 s | 1.1 s | 28.3 s |

    All passed. e2e run at the same moment in the workspace and in your
    working copy passed in both, with no `EADDRINUSE`: the suite's host takes
    `port: 0`. The development host defaults to 7391, so two lanes each
    starting it would collide without `PINETA_PORT=0`. The browser suite was
    not run: it needs a Playwright server outside the sandbox.
26. **A turn revision costs about a tenth of a second** (measured, the
    Pineta workspace, 493 MB of ignored `node_modules`, 5 runs each): 84 ms
    for a snapshot and the check that nothing changed, 144 ms for a snapshot
    and `jj commit`.
27. **`pnpm install --offline` beats cloning, where the store has the
    packages** (measured). In a fresh workspace, with pnpm's own store
    (`pnpm store path`, here `~/Library/pnpm/store/v10`),
    `pnpm install --offline --frozen-lockfile` took 2.3–2.8 s and 6.7 MB of
    disk; pnpm itself imports copy-on-write where it can. Its `link:`
    dependencies dangled as the clone's did, the same relink fixed all 18,
    and the unit suite passed (344 tests). It installs from the workspace's
    own lockfile, so a lane's dependencies match its base. With a store
    missing a package, it failed in 0.6 s with `ERR_PNPM_NO_OFFLINE_TARBALL`.
28. **A jj command run from the wrong directory acts on the repo around it.**
    Observed by accident: `jj workspace add` failed silently (its parent
    directory did not exist, and its output was discarded). Each `cd` into it
    then failed, and the commands meant for the probe ran in `sandbox/`,
    inside Pineta's repo. There they committed your working-copy change as
    "turn: resolve" and set a `pineta/t-1` bookmark. `jj op restore` to the
    snapshot before them undid both, with your `@` back at its commit id and
    no file changed. Also:
    - `jj … | head` exits 3 (a broken pipe), which `pipefail` reports as a
      failure;
    - an earlier `jj abandon` printed "Abandoned 8 commits" but recorded no
      operation. Its exit status and the rest of its output were not kept, so
      why is unknown; the commits were abandoned again.

    So the host runs every jj command with `-R <root>`, never relying on its
    working directory, and checks each command's exit status rather than
    its output.

## Not measured

- The browser suite in a workspace (it needs a Playwright server outside
  the sandbox).
- Cloning or installing on Linux (`cp --reflink=auto` on btrfs, XFS and
  ext4).

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
