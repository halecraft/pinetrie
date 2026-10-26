# ADR-0150 — A lane keeps the kind of history it was made with; a project that changes kind leaves the other kind's lanes refused and intact; and a session's store has one place, whatever its project's kind

- **Status:** Accepted (Duane, 2026-10-15)
- **Area:** `docs/01-architecture.md`, `apps/pinetrie/host/TECHNICAL.md`
- **Amends:**
  - ADR-0142: a lane's history has one kind, on its record, and a project's
    change of kind refuses the lanes of the other kind, as whole lanes, until
    a conversion that is still left open.
  - ADR-0086: a jj project's session is no longer kept in its `.pinetrie/`:
    every project's store is in its session's directory.
  - ADR-0118: its move of the session out of the project is built for every
    project, before folder projects are served.
  - ADR-0149: a session's directory holds its store for both kinds, so a
    folder that gains or loses jj keeps its session.
- **Amended by:**
  - ADR-0216: pine·trie writes one thing in your folder besides the exclude
    file's lines: a git repo's `.jj`, made once.

**Context.**

- **A project's kind is decided at each host start** (`planProjectDir`). A
  person can change it between starts: `jj git init --colocate` in a folder
  project, or deleting `.jj` from a jj project. ADR-0142 leaves a change of
  kind open, and ADR-0149 keeps the session, since it is found by the
  folder's path.
- **A lane's history is of one kind for its whole life:** its disk holds a
  jj repo or it does not, from the moment it is made, and a branch clones
  its parent's disk. Its stored points mean commits or snapshots by that
  kind.
- **Walking a folder project to jj and back** found four gaps:
  - a folder project's store is in its session's directory (ADR-0142), a
    jj project's in `.pinetrie/` (ADR-0086), so after a change the host
    opens an empty store and every thread seems gone;
  - a lane of the other kind would start a run whose every tool call
    fails;
  - the destination's records of the other kind (offers, accepted work,
    bases) stay in the store, and the page shows them;
  - the folder's states could be deleted by, or collide with, a jj host's
    snapshots while the project is jj.

**Decision.**

- **A lane keeps the kind of history it was made with,** on its record
  (`LaneRecord.history`): a lane from its base takes the project's kind,
  a branch its parent's.
- **A lane of a kind other than the project's is refused, whole:**
  - no run starts on it, and no catch-up, split or offer action acts on
    it. The refusal comes where a run is decided, before it starts, and
    says why: "this thread's work was made when the project had no jj
    repo", or the reverse;
  - the page shows it in the thread's column, from the project's kind
    (`ProjectRecord.kind`, written at every start) and the lane's;
  - its disk, its records and its history are kept as they are. A branch
    of it is of its kind, and is refused too.
- **Lanes of the other kind work again if the project returns to their
  kind.** A folder's line of states resumes where it stopped: the next
  read of the folder is a state whose parent is the line's last, so a
  merge base recorded before the change is still a common ancestor.
- **A session's store is in its session's directory,**
  `$XDG_DATA_HOME/pinetrie/sessions/<name>/`, for every project, jj
  projects included. An existing jj project's store moves there once.
  `PINETRIE_STORE` still overrides. `.pinetrie/` keeps only what a jj
  project's lanes need from your repo.
- **The destination's records are its kind's:** at start, the host deletes
  every offer, accepted-work and base record of a kind other than the
  project's. They are caches, rebuilt if the kind returns.
- **A folder project's states are named apart from a jj project's
  snapshots,** and only the folder adapter's sweep deletes them. While the
  project is jj they are kept.
- **Converting a lane between kinds stays open** (ADR-0142, "Left open").
  It acts on the lane's record: its disk committed or snapshotted, then its
  `history` set.

**Consequences.**

- A change of kind loses nothing: every thread is where it was, the
  other kind's lanes are refused with words, and new lanes work.
- Work in a lane of the other kind, not yet accepted, waits on its own
  disk until the project returns to its kind, or until a conversion exists.
  A jj lane's tip in your repo goes with `.jj` if you delete it; the lane's
  own disk keeps its history.
- Built in steps: the lane's kind on its record and the refusal of the
  other kind's lanes first; the store's move, the sweep of the other kind's
  records and the states' names before folder projects are served.
- A folder's states kept through a jj period cost the space S184
  measured: the content their saves rewrote.

**Alternatives rejected.**

- **Converting every lane when the kind changes:** it would decide, at a
  host's start, what to do with work in progress across every thread; ADR-0142
  leaves conversion open for that reason.
- **The kind on every point:** a lane already holds it, once.
- **Keeping a jj project's store in `.pinetrie/`:** a change of kind would
  look like a lost session.
- **Keeping the other kind's destination records:** the page would show
  offers no destination holds.
