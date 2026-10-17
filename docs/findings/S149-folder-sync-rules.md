# S149 — What syncing a person's folder with a thread must get right, read from Mutagen and Syncthing: twelve rules for the scan, the reconcile and the write

- **Status:** Answered (from reading; nothing here was run)
- **Led to:** ADR-0142, ADR-0159, ADR-0165

**Question.** A person's folder on the Mac would sync with their own thread,
both ways: their saves become states of that thread, and what reaches the
thread (a catch up) is written back into the folder. Mutagen and Syncthing
already sync folders both ways, with years of bugs behind them. Six edge
cases are listed below. What does each tool do about each one, and which of
those behaviours must our reconcile meet?
1. Names that differ only in case: APFS is case-insensitive by default, and
   btrfs is not.
2. Unicode normalization: the same name in NFC and in NFD.
3. Symlinks, permissions and the executable bit.
4. A file that is still being written: when is a change complete?
5. Writing over a file that changed since we last saw it.
6. Renames, and what both tools leave out of a sync.

**Kill criterion.** Suppose the rules need machinery the size of Mutagen's
own (scan, reconcile and transition: about 2,900 lines of Go in
`pkg/synchronization/core`). Then we embed Mutagen rather than write our
own reconcile.

**Throw away.** Nothing was run. This was read from source at
`mutagen-io/mutagen` `6ccfeaa` (2026-04-22),
`syncthing/syncthing` `a0fd637` (2026-10-09) and
`syncthing/docs` `2590451` (2026-10-07), with Mutagen's documentation at
`mutagen.io/documentation/synchronization`.

## Answers

**The kill criterion does not hold.** The three-way reconcile itself is
small and pure: `reconcile.go` is 532 lines, most of them comments. The
rules below sit mostly in the scan (what counts as a state) and in the write
(how to change the folder safely), not in the reconcile. The scan and the
write are the large parts (`scan.go` is 902 lines, `transition.go` 1,017),
but each rule is local to one of them. Writing our own reconcile stays the
plan, and both tools are references to read, not dependencies.

### The two models

- **Mutagen keeps an ancestor tree,** the content both sides last agreed
  on, and merges three ways against it (`core/reconcile.go`):
  - Where one side is unchanged, the other side's change is copied across.
  - Where both sides changed but one side's changes are only deletions, the
    other side's content wins, because nothing new is lost. Deleting the
    losing side is how a person resolves a conflict.
  - Otherwise, in `two-way-safe` mode, the result is a conflict value in the
    session's state. The folder is left untouched.
  - The same change made on both sides is no conflict: the ancestor is
    simply updated ("both modified same").
- **Syncthing keeps a version vector per file, with no ancestor tree.**
  Concurrent changes to one file are a conflict. The older modification
  time loses: it is renamed `<name>.sync-conflict-<date>-<time>-<device>.<ext>`,
  and that copy is then synced like any other file. Between a modification
  and a deletion, the modification wins (`users/syncing.rst`).

Our model is Mutagen's. The person's thread holds the ancestor: the last
state the folder and the thread agreed on.

### Rules

**Scanning the folder into a state**

1. **Names compare case-sensitively and in NFC; the folder's limits are
   checked when writing.** Both tools treat `file.txt` and `FILE.txt` as two
   paths. On a case-insensitive disk, a write checks the real case on disk
   first:
   - Mutagen's `nameExistsInDirectoryWithProperCase` checks every component
     of the path.
   - Syncthing's `fs/casefs.go` caches the real names. It compares them
     after NFC normalization, so a normalization difference is not
     reported as a case conflict.

   When two incoming paths collide on the Mac, Syncthing writes one of them
   and reports the other as a case conflict, never letting one overwrite the
   other (`users/syncing.rst`, Case Sensitivity). For us, a collision is a
   conflict value. A lane can hold `Foo.psd` and `foo.psd`; the folder
   cannot.
2. **NFC on the wire, the disk's own form on disk.** Syncthing turns names
   into NFD for the disk on macOS and into NFC everywhere else
   (`scanner/walk.go`, `normalizePath`). With `autoNormalize` on, its
   default, it renames a file whose name is in the wrong form when it scans
   it. Mutagen probes the disk:
   - for APFS it records "does not decompose" and keeps names as they are
     (`filesystem/behavior/unicode_fast_format_darwin.go`);
   - for HFS+ it recomposes names to NFC as it scans (`core/scan.go`).

   APFS keeps a name in the form it was written, but treats NFC and NFD
   forms as the same name when looking it up. That is Apple's documented
   behaviour, not measured here. So two names that differ only in
   normalization collide the way two cases do, and fall under rule 1.
3. **A name that is not UTF-8 is not synced.** Mutagen records it as
   problematic, under an escaped name (`core/scan.go`). Syncthing refuses
   it (`advanced/folder-autonormalize.rst`).
4. **A file that changes while it is being hashed is not a state.**
   - Syncthing stats the file again after hashing. If its size or
     modification time moved, the hash is thrown away ("file changed during
     hashing", `scanner/blockqueue.go`).
   - Mutagen marks the file problematic when the bytes hashed differ from
     the size it stat-ed (`core/scan.go`).

   In both, the next scan tries again.
5. **Hash only what changed: compare (type, modification time, size, file
   id) with a cache.** Mutagen's scan reuses a cached digest when these four
   match (`core/scan.go`), and its accelerated scan rescans only the paths
   FSEvents names, and their parents. Syncthing rehashes a file when its
   modification time, size or permission bits change. Both keep a periodic
   full scan as a safety net, because watching misses changes:
   - Syncthing does a full scan hourly, with jitter, and advises keeping
     it.
   - Mutagen polls cheaply to check that the watched root still exists, and
     sets the watch up again if it was replaced.
6. **Wait for the folder to go quiet before taking a state, and wait longer
   for deletions.** Syncthing collects watcher events for 10 s
   (`fsWatcherDelayS`) and delays deletions for a further minute. That gives
   an app's save-by-rename time to finish, so a deletion is not sent while
   the new file is still on its way. Mutagen only coalesces events (10 to
   20 ms), and relies on rules 4 and 7 to catch what is still in flight.
   Since a state in our model is a commit-like record, we should wait as
   Syncthing does.
7. **Our own temporary files carry a reserved prefix that the scan
   skips.** These are Syncthing's `.syncthing.<name>.tmp` and Mutagen's
   `.mutagen-temporary-*`. Syncthing also reserves its marker and config
   files (`.stfolder`, `.stignore`, `.stversions`).

**Writing into the folder**

8. **Never overwrite or delete what we have not seen.** Before replacing or
   removing a file, both tools check that what is on disk is still what
   their last scan recorded:
   - Mutagen requires that mode, modification time, size and file id match
     its cache, and that the cached digest is the one expected
     (`core/transition.go`, `ensureExpectedFile`).
   - Syncthing compares the file on disk with its database
     (`model/folder_sendrecv.go`, `scanIfItemChanged`).

   On a mismatch, neither writes: the path is rescanned, and the change is
   reconciled again in the next cycle. Both document a race between that
   check and the rename, which no file system API closes.
9. **Write by staging, then renaming into place.** The new content is
   written to a temporary file, given its permissions, then renamed over the
   old one. Mutagen stages by digest and simulates an atomic rename across
   devices with a temporary file beside the target. Syncthing keeps a
   failed temporary for a day, to reuse it. Syncthing then sets the
   modification time to the source's (`performFinish`). Mutagen does not
   sync modification times.
10. **A root that vanishes or empties is not a deletion.**
    - Mutagen halts the session when one side's root is deleted, changes
      type, or loses all its content while the other side's does not
      (`synchronization/safety.go`). Its reason: an unmounted disk or a
      fresh container looks exactly like a mass deletion.
    - Syncthing stops a folder whose marker (`.stfolder`) is missing.

    For us, a folder whose root is gone or emptied pauses its sync and asks
    the person. It never becomes a state with everything deleted.

**What crosses the boundary**

11. **Only executability and portable symlinks cross the boundary.**
    - Mutagen syncs the executable bit and nothing else of a file's
      permissions. Files it writes get a configured default mode, 0600 by
      default. Where a disk cannot keep the bit, it is carried over from
      the ancestor when the content is unchanged (`core/executability.go`).
    - Syncthing syncs permission bits unless `ignorePerms` is set.

    On symlinks:
    - Mutagen's default `portable` mode syncs only relative targets that
      stay inside the root. Any other target halts the session
      (`core/symbolic_link.go`).
    - Syncthing syncs symlinks without following them, and never deletes
      or writes through a symlinked directory (`osutil.TraversesSymlink` in
      `checkToBeDeleted`).

    Both leave out the following: hard links (Syncthing follows them),
    devices, FIFOs and sockets, resource forks, and directory modification
    times. Syncthing also leaves out owners and extended attributes unless
    they are turned on. Mutagen recommends ignoring `.DS_Store` everywhere.
    Our rule: sync content, the executable bit and portable symlinks. The
    rest stays on whichever side made it. A symlink that leaves the root is
    a problem shown to the person, never followed. That is the same risk
    lucky-falcon found for shared directories.
12. **A rename is a deletion plus a creation, and content is found by its
    hash.** Neither tool tracks renames. Syncthing fills a new file from
    blocks it already holds, wherever they are, so a moved file costs no
    transfer. Mutagen's transfer uses rsync deltas. A store addressed by
    content gets this for free.

### What neither tool solves

- **An app holding stale content.** Suppose an app has a file open while
  the sync replaces it. When the app saves, its old content plus its edits
  arrive as a fresh change on the folder's side. To both algorithms that is
  a change made after the merge, so it overwrites the incoming one without
  a conflict. This was reasoned from the algorithms above, not run. In our
  model the overwritten state survives in the thread's history, so nothing
  is lost, but nothing points to it either. Whether apps such as Photoshop
  and Blender notice a file that changed on disk is a question for the Mac
  spike.
- **macOS bundles** (`.app`, `.photoslibrary`, `.logicx`, Final Cut
  libraries): directories that an app treats as one document. Neither
  tool's documentation mentions them. Merging their contents file by file
  can corrupt them. Whether to treat them as one value is for our design.
- **Dataless files** (iCloud Drive's evicted placeholders, for example in
  Desktop and Documents): not covered in either tool's documentation.
  Reading one downloads it.
- **Where conflicts go.** Here our model differs from both tools. The
  folder is the person's own thread, so a sync conflict between the folder
  and that thread happens only when a catch up writes into the folder while
  the person edits. Mutagen's answer is the one that fits us: the folder
  keeps the person's content, and the conflict is a value in the thread,
  shown in pine·trie, not a `sync-conflict` file in the folder.

### Left for the measurements on the Mac

How reliable FSEvents is through `@parcel/watcher`, including
`getEventsSince` after a restart. How long Photoshop and Blender take to
save, and in what pattern of writes and renames. The cost of hashing large
media on APFS. Whether APFS's lookup across normalization forms (rule 2)
holds as Apple documents it. What apps do when a file they have open is
replaced.
