# S108 — `pnpm host <folder>` reaches the host, a relative folder can only be read from pine·trie's root, and a store in a project needs `/.pinetrie/` excluded first

- **Status:** Answered
- **Led to:** ADR-0086, ADR-0107

**Question.** Can `pnpm host <folder>` name the project the host serves?
What does the host see of the argument and of the directory it was typed
in? And where can the session's store live in a project that is not pine·trie
without your repo picking it up?

**Kill criterion.** If pnpm does not pass the argument through the root
script's `pnpm --filter … run host`, the folder must come from a variable.

**Throw away.** A pnpm workspace and jj repos made in `/tmp` for the probes,
deleted after.

**Answers.**

1. **The argument arrives.** pnpm 10.18: a root script
   `pnpm --filter a run host`, run as `pnpm host ../x ~/y` from a subfolder,
   gave the package's script `['../x', '/root/y']`. The shell expanded `~`;
   `pnpm host -- ../x` gave `['../x']`, the `--` dropped.
2. **The directory it was typed in does not.** The package's script runs in
   the package's directory (`apps/pinetrie` for the host), and `INIT_CWD` was
   the workspace root, not the subfolder: the root script's own `pnpm`
   resets it. A relative folder can only be read from pine·trie's root.
3. **jj takes an unexcluded store into `@`.** jj 0.44, in a fresh repo
   (`jj git init`, which colocates by default): a file written to
   `.pinetrie/pinetrie.db` showed as `A .pinetrie/pinetrie.db` in `jj st`. With
   `/.pinetrie/` in `.git/info/exclude` first, `jj st` showed no changes.
4. **A non-colocated repo has no `.git` to exclude in.** In a
   `jj git init --no-colocate` repo, `git rev-parse --git-path info/exclude`
   fails, so `excludeInYours` cannot write. jj does read
   `.jj/repo/store/git/info/exclude`: with `/.pinetrie/` there before the file
   was written, `jj st` showed no changes. ADR-0086 does not use this, since
   lanes mode already refuses such repos for the same reason; finding that
   file means asking jj for its git directory.
