# S150 — FSEvents drops events in a burst but says so, and names a renamed directory without its contents; APFS ignores case and Unicode form on lookup, as documented; modification times do not repeat; a stat walk of 100,000 files takes 0.3 s, and SHA-256 hashes at 2.8 GB/s

- **Status:** Answered (questions 1–4; 5 and 6 not run)
- **Led to:** ADR-0142

**Question.** S149 set out twelve rules for syncing a person's folder with
their thread, read from Mutagen and Syncthing. Some of them rest on beliefs
about the Mac that only the Mac can answer:
1. **Watching.** Does `@parcel/watcher`'s FSEvents backend name every path
   that changed? The test is a burst of creations, in-place writes,
   save-by-rename, file renames, directory renames, case-only renames and
   deletions, each checked against a full scan before and after. A changed
   path counts as named when its event, or one for a directory above it,
   names it. And after a restart: does `getEventsSince` from a
   `writeSnapshot` name every change made while nothing was watching, and
   how long does that query take? (S149 rules 5 and 6.)
2. **Names on APFS.** Is the volume case-insensitive, and does it keep a
   name's case? Does a case-only rename take? Is a name kept in the form
   it was written, NFC or NFD, while a lookup in the other form finds it,
   and an exclusive create in the other form is refused? (S149 rules 1
   and 2.)
3. **Modification times.** Can two writes, one straight after the other,
   leave the same modification time? If they can, a cache keyed on
   (modification time, size, file id) misses a change: git's "racy" files.
   (S149 rule 5.)
4. **Scanning and hashing cost.** How long does a stat walk of 100,000
   files take? How fast are SHA-256 (Node) and BLAKE3 (`hash-wasm`) over a
   2 GB file? Does `clonefile` work, and how fast is it? (S149 rule 5;
   content addressing.)
5. **Apps.** For each of Photoshop, Blender, and one text editor:
   - What does a save write, in what order, and over how long? That covers
     temporary names, renames, writes in place, backups left behind
     (`.blend1`), and lock files.
   - When the file is replaced on disk while the app has it open, does
     the app notice?
   - If not, does its next save write stale content over the replace?

   (S149 rules 6 and 8, and its "an app holding stale content".)
6. **Dataless files.** In a folder iCloud Drive syncs (Desktop and
   Documents), an evicted file shows `dataless` in `ls -lO`. What does a
   stat walk see for it, and does hashing it download it? This one is
   checked by hand, and is optional.

**Kill criterion.** Any one of these changes S149's rules before a design:
- **Watching misses changes.** In any round, `@parcel/watcher` (live or
  `getEventsSince`) misses a path the scans show changed, even counting
  events for a directory above it. Then detection cannot rest on FSEvents.
  It rests on full scans instead, and question 4's walk sets how often they
  run.
- **Modification times repeat.** Two writes share a modification time.
  Then the cache of rule 5 needs git's racy-file check.
- **APFS names differ from the documentation.** The normalization behaviour
  is not as Apple documents it. Then rule 2 is rewritten.
- **An app's save outlasts the window.** A save takes longer than
  Syncthing's 10 s, or passes through a state that looks finished. Then
  rule 6's quiet window is set from the measurements, not borrowed.

**Throw away.** One probe, kept as the record of what ran:
`docs/findings/S150-mac-folder/probe.mjs`. It installs `@parcel/watcher`
2.6.0 and `hash-wasm` 4.12.0 into a temporary prefix, outside the repo and
its lockfile. It writes `results-<mode>-<platform>-<time>.json` beside
itself. It was checked on Linux, in a lane, against the inotify backend.

**How it was run, on the Mac** (Node 24):

```sh
# 1–4: about two to five minutes; works in a hidden folder under $HOME
node docs/findings/S150-mac-folder/probe.mjs auto

# 5: once per app. It copies the document into a fresh folder under $HOME
# and guides a save, a replace while the app is open, then a second save.
node docs/findings/S150-mac-folder/probe.mjs app ~/path/to/some.psd
node docs/findings/S150-mac-folder/probe.mjs app ~/path/to/some.blend
node docs/findings/S150-mac-folder/probe.mjs app ~/path/to/some.md

# 6, optional: in Documents, on a file iCloud has evicted
ls -lO ~/Documents/<file>
```

The options are `--dir` (where to work; `$HOME` by default), `--files`
(10,000), `--tree` (100,000) and `--big` (MB, 2,048).

## Answers

Measured on duane's Mac: an M3 Max, macOS 26.7.1, Node 24.19, run under
`$HOME` on the internal APFS volume (case-insensitive, not encrypted). Run
with the defaults: 10,000 files, a tree of 100,000, and 2 GB to hash. The
output is `docs/findings/S150-mac-folder/results-auto-darwin-2026-10-11T00-56-34-683Z.json`.

1. **FSEvents drops events in a burst, and says so. A renamed directory
   is named, but its contents are not.** The kill criterion holds in part:
   detection cannot rest on events alone. The drop is reported, though,
   and a full scan is cheap (answer 4), so the design survives.
   - **Live, 7 rounds.** Creating, writing in place, save-by-rename,
     case-only renames and deleting 10,000 files: every changed path was
     named. Events arrived within 14 to 85 ms of the burst's end.
   - **Renaming 5,000 files in 285 ms:** 6 changed paths were never named.
     `@parcel/watcher` passed the callback an error: "Events were dropped
     by the FSEvents client. File system must be re-scanned."
   - **Renaming 10 directories:** 20 events, one for each directory's old
     and new name. Their 2,000 files were named by no event of their own.
     Each was covered by its directory's event.
   - **`getEventsSince` after `writeSnapshot`, nothing watching:** in all
     four rounds every change was named, counting directory events. The
     query took 198 to 665 ms for about 10,000 changes. A save-by-rename
     reported both the temporary name and the final one.
2. **APFS matches Apple's documentation.**
   - Case: `probe.txt` finds `Probe.txt`. Writing to it rewrites the same
     file, and the name keeps its first case. A case-only rename takes.
   - Unicode: a name is stored in the form it was written (NFC or NFD,
     byte for byte). A lookup in the other form finds it. An exclusive
     create in the other form fails with `EEXIST`.
3. **Modification times did not repeat.** None of 1,000 pairs of writes,
   one straight after the other, shared a modification time. The smallest
   gap was 27 µs, against a nanosecond field. A racy cache is not ruled
   out, but it was never observed.
4. **Cost.**
   - A stat walk of 101,050 entries: 323 to 329 ms, warm.
   - Over 2 GB from a warm cache: SHA-256 (Node's `crypto`) at 2.8 GB/s,
     BLAKE3 (`hash-wasm`) at 0.96 GB/s. SHA-256 uses the CPU's
     instructions for it, so it is the faster choice here, as well as the
     one git uses.
   - Writing 2 GB: 3.2 GB/s.
   - `clonefile` was not measured: Node's `COPYFILE_FICLONE_FORCE` returns
     `ENOSYS` on macOS. That is a gap in the probe, not an answer about
     APFS.
5. **Not run.** duane has no Photoshop. The question the app test was for
   (an app writing stale content over a replaced file) is settled by the
   model, not by measuring apps. Every state of the person's folder is a
   state of their thread, so content a save writes over stays in the
   thread's history. Where an app should fit is left to the design, with
   whatever apps the people using it have.
6. **Not run.**

**What changes in S149's rules:**
- **Rule 5:** FSEvents is a hint, not the record.
  - A drop error starts a full scan. At 0.3 s per 100,000 files, that is
    affordable whenever a drop happens.
  - An event for a directory rescans everything under it.
  - `getEventsSince` covers the time the host was not running.
  - The hourly full scan stays as the safety net.
- **Rule 6:** the quiet window is still Syncthing's 10 s, borrowed, not
  measured.
- **Rules 1 and 2** stand as written.
- **Content addressing:** SHA-256 over BLAKE3 on the Mac.
