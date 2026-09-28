# `@pineta/workspaces` — technical notes

A lane's jj workspace, and the project it lives in (ADR-0032, ADR-0033). The
one package that runs `jj`, `git`, `pnpm` and `cp`. It declares only
`@pineta/core` (`workspace.test.ts`), and the client may not depend on it.
Evidence for nearly every rule here is `docs/findings/S36-a-workspace-per-lane.md`.

## Running jj (`run.ts`)

- **Every jj command takes `-R <root>`.** A jj command run from the wrong
  directory acts on whatever repo surrounds it: during S36, commands meant for
  a throwaway repo committed a change in Pineta's own (item 28). `-R` must
  name a workspace root *exactly*: a directory inside one is "no jj repo".
- **Two calls run from a directory instead, with no `-R`:** asking where the
  repo is (`jj workspace root`, from the host's directory), and
  `jj git init`, since `-R` needs a repo to exist (item 24).
- **A path argument is read from the process's directory, not `-R`'s.**
  `jj log … shared.txt` from elsewhere fails "Invalid file pattern". Name
  files with the `root:"…"` fileset, as `sideHistory` does.
- **Decide from exit status, never from printed text.** Output a program
  reads comes from a `-T` template (`commit_id`, `empty`, `name`,
  `if(conflict, path)`). `execFile` reads all of it: jj exits 3 on a broken
  pipe, so `jj … | head` fails under `pipefail`.
- **`JJ_EDITOR=false`** (`NO_EDITOR`, from core) makes a command that wants an
  editor fail at once rather than hang a shell with no terminal (items 13,
  21). A lane's shell gets the same environment (`packages/pi/lanes.ts`).

## Finding the project (`project.ts`)

Only jj can say where a jj repo is: a secondary workspace's `.jj/repo` is a
file, and from a jj workspace nested in another repo, git names the outer one
(item 17). So `gatherProject` asks jj, then git only when jj finds nothing, and
no code here looks for `.jj` or `.git`.

`planProject` decides: jj's root is used; else git's top level is initialized
(colocated); else the host's directory is. Never your home directory or `/`,
whichever step would reach it: a home directory that is a dotfiles repo is what
git names for any project below it with no repo of its own. jj's own init is
the last word: in a git worktree it refuses to colocate (item 24), and the
project then works directly, with jj's refusal as the reason.

`prepareProject` then:
- adds `/workspace/` to git's exclude file, found with
  `git rev-parse --git-path info/exclude`, so no tracked file changes (item
  16). It applies in secondary workspaces too (item 22). A jj repo with no git
  directory beside it has nowhere to exclude it, and works directly.
- extends the repo's `immutable_heads()` with `bookmarks(glob:"pineta/*")`,
  keeping whatever it was (`planImmutable`). `jj config get` returns the
  effective value, jj's built-in default included.

**A repo's own tools may still see `workspace/`.** Git and jj ignore it; a
linter that walks the tree does not unless told. Pineta's `biome.json` excludes
it; a repo Pineta runs on may need the same.

## A lane's workspace (`workspace.ts`, `where.ts`)

- **The bookmark is the only record of a lane's newest revision.**
  `pineta/<lane>` is set at the lane's base, and moved by every revision
  (`commitTurn`, `mergeYours`). `ensureWorkspace` re-adds a lost directory at
  it; nothing in the session stores a second copy that could disagree.
- **`planEnsure`** is pure: a healthy workspace gets only the stale guard
  (`jj workspace update-stale`, a no-op unless someone overrode immutability);
  a missing one is forgotten if jj still lists it, cleared if a stray
  directory is in the way, and added at the bookmark. With no bookmark there
  is nothing to add, and the caller says so.
- **A base with several parents** (your `@` is a merge) is committed once,
  empty, by `createWorkspace`, so a lane's base is one commit.
- **`planWhere`** says where a lane works and which roots are "others": every
  other own-copy lane's directory, and the project root. The lane's own
  directory is inside the project, so matching must let the longest root win
  (`rewritePaths`, `foreignRoot` in core), or the project would claim the
  lane's own paths.

## Revisions (`revisions.ts`)

`commitTurn` snapshots; if `@` is `empty`, it commits nothing and returns
null; else `jj commit` with the title and two trailers, `Pineta-Entry` and
`Pineta-Lane`, then moves the bookmark. A turn revision costs about 84 ms
unchanged and 144 ms with a commit (item 26). `entryOfMessage` reads the entry
trailer back, which landing uses to name why each side changed a file.

## Landing (`merge.ts`)

- **The merge is committed at once**, with nothing to resolve too. An empty
  merge would otherwise stay the lane's working copy, which every snapshot
  rewrites, and the bookmark would point at one side only: taking it would
  drop your commit out of `@`'s ancestry. The jj-backed test lands cleanly
  after both sides moved on and checks both are under the bookmark; a
  mutation (`scripts/mutations/workspaces.ts`) shows it can fail.
- **Your work already in the lane** makes `mergeYours` return no merge: the
  run then checks what is there.
- **Conflicts** are read with `jj file list -T 'if(conflict, path ++ "\n")'`,
  never `jj resolve --list`'s printed text.
- **`takeInto`** is `jj rebase -r @ -d <result>` in your working copy: your
  uncommitted changes stay in `@`. Refusing it once your `@-` moved is
  `planTake`'s, in marginalia.

## Setup (`setup.ts`)

- **A pnpm repo installs from pnpm's own store, offline**
  (`pnpm install --offline --frozen-lockfile --store-dir <pnpm store path>`):
  2–3 s and about 7 MB here, from the lane's own lockfile, copy-on-write where
  the platform can (item 27). If the store lacks a package, it installs online.
- **Any other repo clones your `node_modules`** with `cloneTree`, the one
  function that differs by platform: `/bin/cp -c -R` on macOS (clonefile),
  `cp -R --reflink=auto` on Linux. Node's `fs.cp` is no substitute: it copied
  in full on macOS (item 14). `probeClone` tells the host which it gets.
- **Then `planRelink`**: every symlink whose relative target leaves the
  workspace (`link:` dependencies outside the repo, like Pineta's on Kyneta)
  is re-pointed absolutely to where it led from your working copy. pnpm's
  `.pnpm` store links stay: they are inside `node_modules`.

## Tests

`workspaces.test.ts` has the planners' unit tests and one test that runs a
lane's whole life against jj itself, in a throwaway repo, in about 2 s:
initialize, create, turn, lose and recreate the directory, land with a
conflict, resolve, take, land cleanly, forget. It needs `jj` on the machine,
as the e2e suites do.
