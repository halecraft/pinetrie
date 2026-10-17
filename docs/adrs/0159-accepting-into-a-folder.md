# ADR-0159 — Accepting a folder project's proposed changes writes what was shown into the project's folder, from one stream out of its merged state, under a journal, and never replaces a file it has not checked

- **Status:** Accepted (Duane, 2026-10-16)
- **Area:** `apps/pinetrie/host/TECHNICAL.md`, `packages/folder/TECHNICAL.md`
- **Evidence:** S149, S150, S185, S192
- **Amends:**
  - ADR-0142: a folder lane's proposed changes are the merge of accepted
    work's newest state and the lane's tip, made when either moves, and an
    accept writes that merge as reviewed, refused unless it is still what the
    person was shown; the merged state's files reach the project's folder as
    one stream from the disks role, staged in a reserved directory inside the
    folder; the journal's shape and its recovery are decided; a write through
    a file held across an accept is kept as a state of its own beside the
    accept, not on accepted work's line; restore is the same write, on the
    page's plan.

**Context.**

- ADR-0142 decided an accept writes a folder project's proposed changes
  into the project's folder, by the steps S192 measured: move the old file
  aside, check it, link the new one in, and keep the aside until the
  folder's next quiet read. It left four things open:
  - **What the person accepted.** Proposed changes are computed against
    accepted work's newest state when they are built. The folder can move
    between the review and the press; a jj project refuses an acceptance
    whose proposed changes now bring other work (`NOT_AS_SHOWN`, ADR-0065).
    And a review of accepted work's newest against the lane's tip shows,
    for a lane not caught up, the person's own edits since its start as
    reverted, while a merge at the press keeps them: what is written would
    not be what was reviewed.
  - **How the bytes travel.** The merged state is a snapshot in the lane
    VM's disks role; the project's folder is on the Mac (or the Linux
    host), mounted read-only into the disks role. ADR-0142 keeps every
    write to the folder in the host's own code
    (`apps/pinetrie/host/folder/`).
  - **The journal's shape,** and what a host that stopped part way does.
  - **Where a held file's late write goes.** ADR-0142 says "a state of
    yours, concurrent with the accept"; a state on accepted work's line
    would be read as accepted work moving.
- A lane's channel already carries bytes to the host for a bundle, and the
  channel's `streamCommand` streams a command's stdout without holding it.

**Decision.**

- **A folder lane's proposed changes are a merge, made before the review:**
  whenever accepted work's newest state or the lane's tip moves, the host
  merges the tip onto the newest by the path merge, on the project's
  queue, into a snapshot named by the two (the shown merge). The proposed
  changes' files, review, description and conflicts are the newest
  against that merge, so a lane not caught up shows the person's edits
  kept, as the accept will write them. A conflicted merge is shown with its
  markers, and its accept refused until the thread catches up, as a jj
  project's conflicted proposed changes are.
- **An accept names what it was shown,** `{ start, tip }` of the folder
  proposed changes it saw, which name the shown merge. It is refused
  `NOT_AS_SHOWN`, with its words, when accepted work's newest state or the
  lane's tip is another now, and refused when the merge conflicts.
  Otherwise it writes the shown merge as it is, merging nothing at the
  press, and the shown merge becomes the accept's state, its parents the
  newest and the tip; so what is written is what was reviewed.
- **What a catch-up would change in the lane is read from the same merge:**
  the paths where the shown merge differs from the lane's tip.
- **The merged state's changed files travel as one stream:** the disks
  role writes a tar of them from the merged snapshot to its stdout, and
  the host extracts it, by the system's `tar`, into a reserved directory
  inside the project's folder, `.pinetrie-accept-<id>/`. Being inside the
  folder, it is on the folder's own file system, so S192's links work.
  Tar keeps each file's executable bit and each symlink as one.
- **ADR-0142's steps then run from that directory,** one accept at a time
  on the project's queue, beside the folder's reads.
- **The journal is a record in the session's store** (`pinetrie.accept`),
  written before the first path is moved and updated as the accept
  passes each step: its lane, its staging directory, and per path its
  target, its aside's name, the staged file's inode, and whether it is
  linked. A host that starts with a journal open finishes the accept when
  every path was linked, and otherwise puts it back: removes each link
  whose inode is the staged file's, links each aside back where nothing
  stands, and refuses nothing it did not write. Recovery is planned from
  the journal and what the folder holds, then carried out.
- **A held file's late write is a concurrent save:** an aside that
  changed by the next quiet read is recorded as a state of its own,
  `StateMade` `concurrent`, its one parent the accept's state, holding the
  accept's content with that path as the aside held it. It is not on
  accepted work's line, so it moves nothing and no lane merges it; the
  page's history shows it beside the accept, and a restore makes it
  accepted work. The aside is deleted once its state is recorded.
- **What the folder cannot hold refuses the accept before anything is
  written,** naming the path, as ADR-0142 lists: a name that differs only
  in case or Unicode form from another, on a disk that treats them as
  one (probed in the staging directory); a name that is not UTF-8; a
  symlink whose target leaves the folder.
- **Restore is the same write** with an earlier state as its content; its
  command and its page are the folder page's (ADR-0142, "Your folder has a
  history").

**Consequences.**

- A folder project's accept button is live; the refusal that stood for it
  (`ERR.FOLDER_ACCEPT_LATER`) and its words go.
- The accept has laws of its own, in `packages/folder/TECHNICAL.md`, each
  tested under its sentence: the race S192 measured is part of the suite,
  on whichever file system it runs.
- Each move of accepted work or of a lane's tip costs every lane whose
  proposed changes it touches a merge and a snapshot, kept until the next;
  the live set keeps each shown merge, and the sweep deletes one that no
  proposed changes name and no accept made a state.
- An accept costs a tar stream of its changed files across the lane VM's
  channel on the Mac, and one copy into the folder's file system; large
  media costs its size twice, once each way of the stream.
- **Left open:** bundles (`.app`, `.logicx`) written as one value, and
  the history page's design, which restore's command waits for.

**Alternatives rejected.**

- **Mounting the project's folder read-write in the disks role,** and
  writing from the VM: S192 measured links and renames on APFS and btrfs,
  not across virtiofs; and ADR-0142 keeps every write to the folder in
  the host's code.
- **One read call per file through lanehost's channel:** a JSON message
  per file, each limited in size; a tar stream carries any size.
- **Staging in the session's directory:** it may be on another volume
  than the folder, where a link fails.
- **A held file's late write on accepted work's line:** every lane would
  be told accepted work moved, and merge a stale copy over the accept.
- **Accepting against the folder's newest state whatever was shown:** the
  person would accept work they never reviewed.
- **Reviewing the newest against the tip, and merging at the press:** a
  lane not caught up shows the person's edits as reverted, and the
  accept keeps them; what is written is not what was reviewed.
- **Refusing an accept until the lane has caught up:** every save of the
  person's moves accepted work's newest, so nearly every accept would wait
  on a catch-up first.
