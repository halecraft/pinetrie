# S180 — `.gitignore` reads the same without a repo: git with a git directory of its own, rg and fd with `--no-require-git`, and npm `ignore` all agree with git on every path; a lane's own git variables leak in, and must be dropped

- **Status:** Answered
- **Led to:** ADR-0142

**Question.** In a folder project, a lane's `/workspace` holds no repo
(ADR-0142). Today a turn's classes ask `git check-ignore --no-index` in the
lane's repo, and the search tools run rg and fd, which read `.gitignore`
only inside a git repo. Without a repo:
1. Does `git check-ignore --no-index`, run with a git directory of
   pine·trie's own outside the folder (`GIT_DIR`, `GIT_WORK_TREE`), say
   exactly what git says in a real repo with the same `.gitignore` files?
   That includes nested files, negations, anchored and `**` patterns,
   directory-only patterns, and a file re-included inside an ignored
   directory.
2. Which of the person's or the machine's settings leak in (a global
   `core.excludesFile`, `~/.config/git/ignore`), and how are they turned
   off?
3. Do `rg --files --hidden --no-require-git` and
   `fd -H --no-require-git` list exactly the files git calls not ignored?
   Which further flags make them agree, and what do they still read that
   git does not (`.ignore`, `.rgignore`, `.fdignore`)?
4. Does a matcher in TypeScript (npm `ignore`, walked per directory) agree
   with git, so that the oracle could be pure and need no call into the
   lane?

**Kill criterion.**
- If check-ignore with its own git directory disagrees with a real repo
  on any path, the oracle needs a real (hidden) repo in the lane, and
  ADR-0142's "no repo" is wrong.
- If rg or fd cannot be made to agree, the search tools must filter
  their output through the oracle.
- If the TypeScript matcher disagrees on any path, the oracle stays git,
  run in the lane.

**Throw away.** `docs/findings/S180-ignores-without-a-repo/probe.py` and
its results. The reference is a real `git init` with an empty index, the
same `.gitignore` files, and the person's and the system's config off:
`git ls-files --others --exclude-standard` lists what is not ignored. The
corpora are a synthetic tree of the hard cases, pine·trie's own tree with
`node_modules` installed, and flask with a virtualenv and its build.

Run in a lane on the Mac's VM (Debian 13, arm64): git 2.47.3, rg 15.2.0,
fd 10.5.0, npm `ignore` 7.0.12, Node 24.21. The results are
`results-<corpus>.json` beside the probe.

## Answers

| corpus | files | ignored | own git directory | rg, as today | rg `--no-require-git` | fd, as today | fd `--no-require-git` | npm `ignore` |
|---|---|---|---|---|---|---|---|---|
| synthetic (hard cases) | 46 | 28 | agrees | misses 28 | agrees¹ | misses 28 | agrees | agrees |
| pine·trie, `node_modules` installed | 40,485 | 21,220 | agrees | misses 20,066 | agrees²  | misses 21,220 | agrees² | agrees |
| flask, `.venv`, tests run | 1,256 | 1,020 | agrees | misses 1,016 | agrees | misses 1,020 | agrees | agrees |

¹ rg never lists a symlink it does not follow; that is not an ignore.
² Apart from the 45 files pine·trie's own `/.ignore` hides from search
(`docs/*/archive/`). rg drops them with `--no-ignore-dot`; fd has no flag
for `.ignore` alone.

1. **git needs no repo in the folder.** `git check-ignore --no-index`
   with `GIT_DIR` set to an empty bare repo outside the folder, and
   `GIT_WORK_TREE` set to the folder, agreed with a real repo on every
   path of all three corpora. That covered nested files, negations,
   re-inclusion refused inside an ignored directory (`build/keep.txt`),
   `**`, anchored and directory-only patterns, escapes, trailing spaces
   and non-ASCII names. It took 85 ms for 40,485 paths. `git ls-files -o
   --exclude-standard` with the same directory agreed too, in 49 ms.
2. **The leak is pine·trie's own.** The first run in this lane disagreed
   with nothing, because the reference was wrong too: the lane's
   `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0=core.excludesFile` and
   `GIT_CONFIG_SYSTEM` (`packages/lanes/TECHNICAL.md`, "No repo may track
   a shared directory") reached both, and ignored `.pinetrie-lane/`'s
   17,737 files (`results-pinetrie-with-lane-git-env.json`). The oracle
   must run with every `GIT_CONFIG*` variable dropped, with
   `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`, and
   `.pinetrie-lane/` must leave states by ADR-0142's list of paths, not
   by an ignore. The person's global excludes are off the same way.
3. **rg and fd agree with `--no-require-git`.** As `packages/pi/search.ts`
   runs them today, with no repo, they read no `.gitignore` at all: the
   agent's grep and find would search all of `node_modules` and `.venv`.
   With `--no-require-git` they agree with git on every path, except that
   they also read `.ignore` (rg and fd) and `.rgignore` or `.fdignore`.
   Those only hide more from search, never less, so classes and search
   still agree on what is source. Add `--no-ignore-global` and
   `--no-ignore-parent` so that neither the person's config nor a folder
   above the lane reaches search. A corpus inside another repo
   (`/workspace/sandbox`) found that repo's `.git` above it: rg then
   reads `.gitignore` even without the flag.
4. **npm `ignore`, one matcher per `.gitignore` walked from the root,
   agreed with git on every path** of all three corpora, in 83 ms for
   40,485 paths. It needs the ancestor rule spelled out: an ignored
   directory hides everything under it, whatever a deeper negation says.
   So the oracle can be pure, in `@pinetrie/rules`, over the
   `.gitignore` files of a state, read through the states port. That
   saves the turn's round trip into the lane. Agreement with git stays a
   test, against this probe's synthetic tree and git itself.

**Kill criterion:** not met. No repo is needed in the folder or the lane.
