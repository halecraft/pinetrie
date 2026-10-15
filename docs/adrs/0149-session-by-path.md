# ADR-0149 — A session is found by its folder's real path, and named for people: a registry maps one to the other, and a moved folder is attached again by name

- **Status:** Accepted (Duane, 2026-10-14)
- **Area:** `packages/config/TECHNICAL.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Amends:**
  - ADR-0118: a session's directory is
    `$XDG_DATA_HOME/pinetrie/sessions/<name>/`, and its name comes from the
    registry, found by the folder's real path. `PINETRIE_SESSION` attaches a
    folder to a session by name.
  - ADR-0146: the local layer is keyed by the session's name from the
    registry, not by the project folder's name.
  - ADR-0142: a folder project's data is in its session's directory,
    `$XDG_DATA_HOME/pinetrie/sessions/<name>/`.

**Context.**

- **A session has no identity of its own yet.** ADR-0118 puts a session's
  directory at `$XDG_DATA_HOME/pinetrie/<session>/`, named for its first
  source. ADR-0146 keys the local config layer by the session, and until
  ADR-0118's session lands, by the project folder's name
  (`path.basename(root)`, `apps/pinetrie/host/server.ts`). Two folders
  with one name share a local file; a renamed folder loses its own.
- **For a folder project that is not enough.** ADR-0142 moves its store,
  lane runtime and ignore file out of the folder, into the session's
  directory. Keyed by the folder's name, two folders called `website`
  would share one session's threads and snapshots.
- **Nothing can be kept in the folder** (ADR-0142, ADR-0146), so the key
  cannot be an id written there, as jj keeps its `config-id` in
  `.jj/repo/`.
- **A folder's device and inode were considered** and set aside: they
  survive a rename, but whether they survive what people do to folders on
  a Mac (a move across volumes, a restore, a remount) would need a spike,
  for a case a person can mend in one command.

**Decision.**

- **A session is found by its folder's real path:** absolute, through
  symlinks (`fs.realpath.native`), so a link and its target are one
  session. On a disk that ignores case, the name as it is on disk.
- **A session has a name, for people:** lowercase, one path segment, made
  from the folder's name when the session is made (`Client Site` →
  `client-site`). When another session holds that name, a two-word suffix
  from the thread names' generator tells them apart (`website-quiet-fox`).
  The name is what a person sees and types: in its directories, the
  startup lines and the setup page.
- **One registry maps the two:** `$XDG_DATA_HOME/pinetrie/sessions.json`,
  each entry a real path, its session's name, and when it was last served.
  A name is unique in it, checked when an entry is written. Finding a
  session is a lookup by path; nothing is scanned.
- **A session's directories are named by its name:**
  - its data, `$XDG_DATA_HOME/pinetrie/sessions/<name>/`;
  - its local config, `$XDG_CONFIG_HOME/pinetrie/sessions/<name>/pinetrie.json`
    (ADR-0146's local layer).
- **A folder no entry holds starts a new session,** unless
  `PINETRIE_SESSION` names one: that session is attached to this path, its
  entry's path moved. The host's startup lines say which:
  `[host] session website (~/work/website)`, or, for a new session whose
  name another path held before, where that one was and how to attach it.
- **Renaming a session** changes its name in the registry and moves its two
  directories, while no host serves it.
- **`PINETRIE_STORE` still overrides the store** (ADR-0118). A jj project's
  store stays in its `.pinetrie/` (ADR-0086) until ADR-0118's move is
  built; its local layer follows the registry from now on.

**Consequences.**

- Two folders with one name are two sessions, each with its own local
  config, and a folder project's data never mixes with another's.
- **Moving or renaming a folder loses its session** until it is attached
  again: `PINETRIE_SESSION=website pnpm dev ~/new/place`. A copied folder
  is a new session, as a copy is a new project.
- **An existing local file moves once:** a local layer at
  `sessions/<folder name>/` today is the new session's when the folder's
  first entry is written under that name.
- `configPlaces` (`packages/config/places.ts`) takes the session's name
  from the registry, read before the layers are, at the host's start.
- No spike: real paths, and APFS keeping a name's case on disk, are
  checked by unit tests where the registry is built.

**Alternatives rejected.**

- **The folder's name as the key** (today's stand-in): two folders with one
  name share a session.
- **The folder's device and inode:** they follow a rename, but on the Mac
  a device number can change on remount, and an inode across a move to
  another volume or a restore does not hold; the cases need a spike and
  more machinery (volume UUIDs), to save one command after a move.
- **An id written in the folder:** ADR-0142 and ADR-0146 keep the folder
  free of pine·trie's files, and a copy would carry the id with it.
- **A command-line flag to attach** (`--session`): `pnpm dev` and `pnpm
  serve` refuse any flag (ADR-0086, ADR-0148); `PINETRIE_SESSION`, which
  ADR-0118 already names, does the job.
- **Numbered suffixes** (`website-2`): they say nothing about which
  website.
