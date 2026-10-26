# S348 — A host with no jj serves a folder project once the lane image's jj version is a value of its own; a jj repo with no jj is read as a folder

- **Status:** Answered
- **Led to:** ADR-0216

A project can be a folder with no repo (`packages/lanes/project-dir.ts`),
and pine·trie is meant to be of use there without jj installed: jj
missing should be a warning at start, not a refusal. Nothing has run a
host without jj.

## Brief

**Size:** S · **Depends on:** nothing

**Question.** With no `jj` on the host's `PATH`, on the Mac:

1. Where does a host with tools, serving a folder project, stop?
2. Past that, does a lane start, run a command, show its proposed
   changes, and accept them into the folder?
3. What does the host make of a jj repo when jj is missing?
4. Does `pinetrie serve` reach `listening`, through the invocation and
   the sessions registry, which the suite's hosts skip?

**Kill criterion.** If a folder project needs jj on the host beyond one
place, jj stays a requirement for 0.1.0 and the README says so.

**Throw away.** The scenario, the patch to `hostJjVersion`, the folders,
stores and sessions.

## Answers

Run 2026-10-26 on Duane's Mac (macOS, Apple silicon, Node 24, jj 0.45.1
at `/opt/homebrew/bin/jj`, the only jj on `PATH`). jj was hidden by
replacing `/opt/homebrew/bin` in `PATH` with a directory of links to
everything in it but `jj`; `jj --version` then failed with `ENOENT`.

1. **The start stops at the lane images.** A disposable lanes-suite
   scenario started a host with tools on a plain folder through
   `startHost`, with the scripted model. Every step through `lane-work`
   passed (the lane VM, the store, the project, the model, the roots,
   lanes' configs and ssh); then `✗ the lane images: jj --version failed
   (exit -1): spawn jj ENOENT`, thrown by `hostJjVersion`
   (`packages/lanes/image.ts`), which pins the default image's jj to the
   host's. The host does not start.
2. **Past the version, the folder project needs no jj.** With
   `hostJjVersion` patched to return `0.45.1` when `jj` fails, the same
   scenario passed all four checks: the host started; a thread's lane
   wrote `b.txt` and ran `cat a.txt b.txt`; its proposed changes were
   `{"kind":"folder","files":["b.txt"],…}` against accepted work of kind
   `folder`; the accept answered `accepted` and wrote `b.txt` into the
   folder. No log line named jj. The lane's image carries its own jj,
   which the folder lane does not need from the host.
3. **A jj repo with no jj is read as a folder project, silently.**
   `prepareProjectDir` (`packages/jj/startup.ts`) asks `jj workspace
   root`, and any failure, `ENOENT` among them, reads as "no jj repo";
   git's top level then names the root. A probe on a fresh `jj git init
   --colocate` repo gave `{"kind":"jj",…}` with jj and
   `{"kind":"folder",…}` without it. Served so, its lanes are folder
   lanes, an accept writes files straight into the jj working copy, and
   once jj is back the host refuses those lanes as another history's
   (`foreignLaneWords`, the `lanes/folder` scenario's last check).
4. **`serve` reaches `listening`.** `node apps/pinetrie/bin.ts serve
   <folder>`, with the patch, jj hidden, and its own `XDG_DATA_HOME` and
   `XDG_CONFIG_HOME`, ran every step of the checklist, the lane runtime
   built, and listened; nothing in the invocation or the sessions
   registry ran jj.

5. **`jj git init --colocate` leaves a git repo as a git user had it.**
   Asked after Duane's answer that a git repo without jj is served by
   making it colocated. On a repo with a commit on `main`, an edited
   file and a staged new one, under jj 0.45.1: after the init, `git
   status --short` and `git branch --show-current` (`main`) were as
   before, `.jj` did not show in `git status` (jj ignores it from inside
   `.jj`), and `.git/info/exclude` was unchanged. A `git commit -a` after
   it worked, and the next jj command imported it ("Reset the working
   copy parent to the new Git HEAD"), leaving jj's earlier working-copy
   commit as a side head in `jj log`.
6. **jj will not colocate a git worktree.** In a folder made by `git
   worktree add`, `jj git init --colocate` printed "Cannot create a
   colocated jj repo inside a Git worktree" with a hint to init the main
   repo or use `jj workspace add`, and created nothing.

7. **jj says "no repo" in its own words, and exit 1 alone does not.**
   `jj workspace root --ignore-working-copy`, jj 0.45.1, run in each
   case:
   - a folder in no repo, its subfolder, and `-R` naming one: exit 1,
     stderr `Error: There is no jj repo in "<path>"`;
   - a repo's subfolder: exit 0, the repo's root; a second workspace
     (`jj workspace add`, whose `.jj/repo` is a file naming the first's):
     exit 0, its own root;
   - a `.jj` with its store deleted, and an empty `.jj`: exit 0, the
     folder. With `--ignore-working-copy` jj does not load the repo to
     answer, so a broken repo is found by the next command that does;
   - an unreadable `.jj/repo`: exit 255, `Internal error: Failed to
     determine the secure config for a repo`;
   - an unparseable config (`JJ_CONFIG`), in a repo or out of one:
     exit 1, `Config error: Configuration cannot be parsed as TOML
     document`.

   So "no jj repo" is exit 1 with stderr starting `Error: There is no jj
   repo in`; every other failure, exit 1 among them, is jj failing, and
   `prepareProjectDir` today reads each of them as a folder.

**Read from source, not run:** Xcode's command line tools are found by
`xcrun --find swiftc` (`packages/vm/swift.ts`), asked only when the
launcher or the image builder must be built, and refused at the
`lane-machine` step in `vmWords`' words. The Docker CLI and buildx are
refused at the same step on the Mac (`dockerWords`). Neither was run on
a Mac without them.

**So:** jj can be a warning for a folder project. Two changes make it
one: the default image's jj version must not come from the host alone
(a version kept in the code, used when the host has none), and a folder
that holds a `.jj` directory while jj is missing must not be read as a
folder project.

Duane's answer (2026-10-26) goes further than the question: pine·trie
serves version control through jj, so a folder with `.jj` or `.git` and
no jj is refused, and a git repo without jj is made colocated (items 5
and 6) rather than served as a folder.
