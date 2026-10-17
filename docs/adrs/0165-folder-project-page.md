# ADR-0165 — A folder project's page shows accepted work's history and restores any kept state of it, reviews files as files, and chooses a conflict's version

- **Status:** Accepted (Duane, 2026-10-17)
- **Area:** `packages/interface/TECHNICAL.md`, `packages/web/TECHNICAL.md`,
  `apps/pinetrie/host/TECHNICAL.md`, `packages/folder/TECHNICAL.md`
- **Evidence:** S149, S185, S192
- **Amends:**
  - ADR-0142: its history page is designed. A restore is written by the same
    steps as an accept, and refused unless accepted work is still what the
    person was shown. A review tells text, images and other files apart by
    their content. A rename is inferred only where a file's bytes are
    unchanged, and only to show it. A conflict's version can be chosen on the
    page. A resolution is a state of the lane's own.
  - ADR-0159: the history page it left open is this one; its journal records a
    restore as well as an accept.
  - ADR-0047: a review of either kind of project tells images and other binary
    files from text by their bytes.

**Context.**

- ADR-0142 gives a folder project a history: every save and accept is a
  state, and "any state of it can be restored". It left the page to design.
  ADR-0159 built the accept. The write it uses (stage, move aside, check,
  link) takes any state as its content.
- The states are `STATE` records in the session's document, which the page
  already reads. Which snapshots are still kept is decided by the host's
  live set (`@pinetrie/folder`'s `live.ts`). That package uses Node's
  crypto, so the page cannot import it.
- A review reads files as text alone: an image shows "0 lines", and so
  does any other binary file. A file that only moved shows as a deletion and
  an addition.
- A lane's conflict is closed only by the agent's `resolve_conflict`. The
  person can choose a version only by asking the agent to.
- A resolution writes into the lane's disk and records nothing. One made
  outside a run leaves the disk ahead of the lane's newest state until the
  next turn.

**Decision.**

- **The history is a page of its own** (`#history`), opened from the
  footer of a folder project, where a jj project has its publish button.
  It lists accepted work's line, newest first, along first parents: each
  state's who, when and how it was made. A concurrent save is shown under
  the accept it was written beside. Each entry's changes are its review from
  its first parent, read as the entry comes into view. States whose
  snapshots are no longer kept are counted at the list's end, with no
  review or restore.
- **The host says which states are kept,** on accepted work's record
  (`FolderAcceptedRecord.kept`): the states the sweep's live set keeps
  whose snapshots exist. One step writes it and sweeps, whenever accepted
  work moves and at each run's end. The page never works out the rule
  itself.
- **A restore is a new state** (`made: restore`, its one parent accepted
  work's newest), with an earlier kept state's content. It is written into
  the project's folder by ADR-0159's steps, journal included, on the
  project's queue, after the same inline read. It names what it was shown:
  accepted work's newest when the person confirmed. It is refused
  `NOT_AS_SHOWN` when accepted work has moved since. The page shows, before
  the press, what it will change: a review from accepted work's newest to
  the restored state. A restore is undone by restoring the state before
  it.
- **A review may read any two of accepted work's states:** line states
  and concurrent saves, which are the project's own. A conflict's base
  with its ours or its theirs may be read too.
- **A review tells content apart by its bytes, in either kind of
  project:** a side that is text has its diff, as now. An image (PNG, JPEG, GIF or WebP, by its first bytes,
  never its name) is shown before and after, side by side. Any other file
  shows its sizes, with each version to open. The bytes are served under
  the review's own URLs and permission. Images are served as their type,
  anything else as an attachment, every one with `nosniff` and a sandbox
  CSP, as blobs are. One function tells content from a file's first bytes;
  a folder project's disks role and a jj project's reads both call it.
- **A rename is shown where a file's bytes did not change:** a path gone
  and a path added whose content is equal are one row, `{old => new}`. A
  conflict whose path one side moved, unchanged, says where it went. A
  merge never applies a rename: ADR-0142 keeps it a hint.
- **A conflict's version can be chosen on the page.** The thread's conflicts
  pane shows, for each path, the thread's change and accepted work's change
  from their base, and three choices: keep the thread's file as it stands,
  take accepted work's, or take the version both began from. A choice is
  `LaneHistory.resolve`, as the agent's tool is. It is refused while the
  thread runs. The thread is told by a fact.
- **A resolution is a state of the lane's own** (`made: resolve`, one
  parent the lane's newest), whoever made it. The lane's newest then holds
  what its disk holds, and its proposed changes are built from it.
- **Words for people say "accepted work",** never a jj word (commit,
  bookmark, revision, repo, stack, WIP, publish) on a folder project's
  page. One check reads every label a folder project's views produce.

**Consequences.**

- A designer gets undo across every save and accept: open the history,
  look at a state's changes, restore it.
- Each review row carries what its content is (`ReviewFile.content`), so
  the review's wire version moves on. A jj review reads the first bytes of
  each file its stats count as no lines, and serves a file's bytes from
  its commit.
- A resolution costs a snapshot. A resolution made inside a run splits that
  run's work across two states, which an ask's review, a range across both,
  still reads whole.
- The journal of ADR-0159 is renamed for both of its writes
  (`pinetrie.folder-write`). It is switched over by hand: a host stopped with
  no accept in flight and no aside kept has none.
- **Left open:** applying a change across a rename that was also edited;
  showing renames to the agent; a jj project's history page.

**Alternatives rejected.**

- **The history in a column's pane:** a pane is a thread's, and accepted
  work is no thread's.
- **The page working out which snapshots are kept:** it would copy the live
  set's rule, which would drift from the sweep's; and the rule's package is
  Node's.
- **A restore with no check of what was shown:** a save made between the
  preview and the press would be replaced by content the person never
  looked at against it. It would survive as a state, but the person would
  have restored something they did not review.
- **Types by file name:** a name says nothing of its bytes, and a page
  told `image/svg+xml` by a name could be made to run a script.
- **Renames inferred by similarity, as git does:** a guess the review
  would present as a fact. Equal bytes are proof.
- **A page resolution recorded at the next turn:** until then, the lane's
  proposed changes and catch-ups read a state without it.
