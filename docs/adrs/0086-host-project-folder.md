# ADR-0086 — The host serves the project its command line names, and keeps that project's session in the project

- **Status:** Accepted
- **Area:** `apps/pinetrie/host/TECHNICAL.md`, `packages/lanes/TECHNICAL.md`
- **Evidence:** S108
- **Amends:**
  - ADR-0022: the repo the host runs from is the default project; `pnpm host
    <folder>` names another.
- **Amended by:**
  - ADR-0102: a host started outside `pnpm host` refuses to start without a
    lane runtime; it never works directly.

**Context.** `pnpm host` served pine·trie's own repo, found from where
`server.ts` sits, and kept its session in that repo's `.pinetrie/pinetrie.db`.
Everything below `server.ts` already took any folder: the suites start hosts
on repos of their own. A session records lanes, fork points and directories
of one repo, so a store must not serve two projects. A project's `.pinetrie/`
was excluded from its repo only when lanes had containers, so a store
written there in direct work would be taken into your `@` (S108).

**Decision.**
- **`pnpm host [folder]`** names the project; without it, pine·trie's repo. A
  relative folder is read from `INIT_CWD`, which under pnpm is pine·trie's root
  (S108). A flag, a second argument, a missing folder or a file is refused
  before anything opens.
- **The project is a host option of its own**
  (`StartHostOptions.project`), with whether the agent has tools in it. pi's
  settings and `AGENTS.md` load from the project with tools on or off.
- **The session lives in the project root's `.pinetrie/pinetrie.db`** unless
  `PINETRIE_STORE` says otherwise. The root is jj's workspace root, else
  git's top level, else the folder.
- **`/.pinetrie/` is excluded in any repo before the store opens**
  (`prepareProjectDir`, `packages/lanes/host.ts`). A repo where it cannot be
  (a non-colocated jj repo) is refused, naming `PINETRIE_STORE` and
  `jj git init --colocate`.
- **A root that is your home directory or `/` is refused** by `pnpm host`.
  `prepareHost`, for a host started otherwise, still works directly there.

**Consequences.**
- Each project keeps its own session, snapshots and runtime in its own
  `.pinetrie/`; deleting it starts the project afresh.
- A repo worked in directly now gets `/.pinetrie/` in its exclude file, where
  before only a repo with lanes of their own did.
- Two projects given one `PINETRIE_STORE` would share a session, as before.

**Alternatives rejected.**
- **The store in pine·trie's repo, one file per project.** It never writes into
  the project, but splits a project's state across two repos, since its
  snapshots are in its own `.pinetrie/` (ADR-0034).
- **A user state directory** (`$XDG_STATE_HOME/pinetrie/`): the same split,
  and it moves the session of whoever runs pine·trie on itself.
- **A `PINETRIE_PROJECT` variable.** A folder is what the command acts on.
- **Reading a relative folder from the shell's directory.** pnpm does not
  pass it on (S108).
