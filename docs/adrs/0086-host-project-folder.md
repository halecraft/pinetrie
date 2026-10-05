# ADR-0086 — The host serves the project its command line names, and keeps that project's session in the project

**Status:** Accepted. Evidence: S108. Implemented by
`PLAN-2026-10-05-host-project-arg`. Amends ADR-0022: the repo the host runs
from is the default project, not the only one.

**Context.** `pnpm host` served Pineta's own repo, found from where
`server.ts` sits, and kept its session in that repo's `.pineta/pineta.db`.
Everything below `server.ts` already took any folder: the suites start hosts
on repos of their own. A session records lanes, fork points and directories
of one repo, so a store must not serve two projects. A project's `.pineta/`
was excluded from its repo only when lanes had containers, so a store
written there in direct work would be taken into your `@` (S108).

**Decision.**
- **`pnpm host [folder]`** names the project; without it, Pineta's repo. A
  relative folder is read from `INIT_CWD`, which under pnpm is Pineta's root
  (S108). A flag, a second argument, a missing folder or a file is refused
  before anything opens.
- **The project is a host option of its own**
  (`StartHostOptions.project`), with whether the agent has tools in it. pi's
  settings and `AGENTS.md` load from the project with tools on or off.
- **The session lives in the project root's `.pineta/pineta.db`** unless
  `PINETA_STORE` says otherwise. The root is jj's workspace root, else
  git's top level, else the folder.
- **`/.pineta/` is excluded in any repo before the store opens**
  (`prepareProjectDir`, `packages/lanes/host.ts`). A repo where it cannot be
  (a non-colocated jj repo) is refused, naming `PINETA_STORE` and
  `jj git init --colocate`.
- **A root that is your home directory or `/` is refused** by `pnpm host`.
  `prepareHost`, for a host started otherwise, still works directly there.

**Consequences.**
- Each project keeps its own session, snapshots and runtime in its own
  `.pineta/`; deleting it starts the project afresh.
- A repo worked in directly now gets `/.pineta/` in its exclude file, where
  before only a repo with lanes of their own did.
- Two projects given one `PINETA_STORE` would share a session, as before.

**Alternatives rejected.**
- **The store in Pineta's repo, one file per project.** It never writes into
  the project, but splits a project's state across two repos, since its
  snapshots are in its own `.pineta/` (ADR-0034).
- **A user state directory** (`$XDG_STATE_HOME/pineta/`): the same split,
  and it moves the session of whoever runs Pineta on itself.
- **A `PINETA_PROJECT` variable.** A folder is what the command acts on.
- **Reading a relative folder from the shell's directory.** pnpm does not
  pass it on (S108).
