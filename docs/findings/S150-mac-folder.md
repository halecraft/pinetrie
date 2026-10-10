# S150 — What a person's folder on the Mac does: FSEvents through `@parcel/watcher`, APFS names, modification times, hashing, and how apps save

- **Status:** Open

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

**How to run it, on the Mac** (Node 24):

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
