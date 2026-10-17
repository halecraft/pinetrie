# S192 — An accept that keeps what it moved aside until the folder's next read lost no save in 1,560 trials, with no pause; its one limit is a write through a held file after that read, as declared; a pause of any length fails a writer slower than it

Numbered S188 until 2026-10-14, when two files held that number.

- **Status:** Answered
- **Led to:** ADR-0142, ADR-0159, ADR-0165

**Question.** S185 found that renaming over a checked file loses saves
landing between the check and the rename. Moving the file aside and linking
the new one in lost none that arrived by name, and a 5 ms pause before
deleting the aside caught writers that held the old file open. But nothing
chose 5 ms: S185's writers all wrote within 300 µs, and a writer slower
than the pause would lose its write. The proposal instead keeps the aside,
under its reserved name, until the folder's next read. That read comes
once the folder, asides included, has been quiet. It deletes an aside whose
inode, size and mtime are as the accept left them, and keeps any other as
a state of yours, flagged against the accept.
1. Against each kind of save, does it lose nothing:
   - a save by rename, and a write in place by path, at a random moment
     in the accept;
   - a slow write in place (megabytes in chunks) through a file opened
     before the accept;
   - a small write through a file held open since before the accept,
     well after the accept but before the folder is quiet?
2. Where is its limit? A write through a held file after the next read is
   the case it declares out of reach. Does it lose that, and only that?
3. How often does it keep an aside to show you, rather than delete it?
4. Do the same hold on APFS, whose `link` and `rename` it relies on?

**Kill criterion.** If it loses any save of the first kind other than the
declared limit, keeping the aside is not enough: an accept then needs an
exclusive lock the apps do not take, and ADR-0142 declares writes through
held files out of scope instead.

**Throw away.** `docs/findings/S192-accept-keeps-aside/keep-aside.mjs`,
run against S185's two protocols as the baseline. It runs in a lane on
btrfs and on the Mac under `$HOME`. The folder's quiet window (10 s,
S149 rule 6) is scaled to 20 ms, and each writer's timing with it.

## Answers

Run in a lane on duane's Mac (the lane VM, btrfs, Node 24.21), 300 trials
a pair and 60 for the slow writer (8 MiB in 64 KiB chunks, 0.2 ms apart),
with the quiet window scaled to 20 ms: `results-linux-lane.json`.

| save | check, rename | aside, link, pause 5 ms | aside, link, kept to the next read |
|---|---|---|---|
| by rename, during the accept | 0 lost | 0 lost | 0 lost |
| in place by path, during | 22 lost | 0 lost | 0 lost |
| slow, in place, through a file held from before | 60 of 60 lost | 0 lost, all 60 refused | 0 lost, 51 surfaced, 9 refused |
| late (10 ms), through a file held from before | 300 of 300 lost | **300 of 300 lost** | **0 lost, all 300 surfaced** |
| after the next read, through a held file | 300 lost | 300 lost | 300 lost |

1. **Keeping the aside lost nothing** of any kind it covers. How each case
   ends:
   - **A save that arrives by name** (a rename, or opening the path)
     after the move aside makes the link fail. The accept is refused, and
     your file stays.
   - **A write that lands before the aside is checked** is caught by its
     mtime, and the aside goes back.
   - **A write through a file held from before, after the link,** lands
     in the aside. The next read finds the aside changed and keeps its
     content as yours.
2. **Its limit is exactly the declared one.** A write through a held file
   after the next read was lost every time, under every protocol. That
   read comes only once the folder, asides included, has been quiet for
   the whole window (10 s, S149 rule 6), so what it misses is an app that
   held a file open, idle for longer than the window, then wrote through
   it: S149's app holding stale content.
3. **The pause's failure is its length, as feared.** The slow writer
   survived it only because its first chunk landed within 5 ms, which
   moved the aside's mtime before the last check. A writer whose first
   write came at 10 ms lost all 300 saves. No length is safe; keeping the
   aside needs no length.
4. **What you would see:** every write through a held file across an
   accept is surfaced (all the late ones, 51 of the 60 slow ones; the
   other 9 were caught before the link, and refused). Each one is a real
   concurrent edit: your app wrote to a file the accept replaced. It is
   kept as a state of yours, concurrent with the accept, which shows it
   as a shared file's concurrent write is shown (ADR-0135). No trial
   surfaced a save that did not need it.
5. **APFS gives the same losses, and more refusals.** Run by duane on
   the Mac, under `$HOME` (`results-darwin.json`):

   | save | check, rename | aside, link, pause 5 ms | aside, link, kept to the next read |
   |---|---|---|---|
   | by rename, during | 0 lost | 0 lost, 260 refused | 0 lost, 275 refused |
   | in place by path, during | 33 lost | 0 lost, 292 refused | 0 lost, 270 refused, 29 surfaced |
   | slow, through a held file | 60 of 60 lost | 0 lost, all refused | 0 lost, 42 surfaced, 18 refused |
   | late (10 ms), through a held file | 300 lost | 300 lost | 0 lost, all 300 surfaced |
   | after the next read | 300 lost | 300 lost | 300 lost |

   - **APFS's `link` refuses a taken name and `rename` keeps the inode
     and mtime,** as the protocol needs: it lost nothing it covers.
   - **It refuses far more often than on btrfs** when a save lands
     within 300 µs of the accept's start: 275 of 300 saves by rename,
     against 2 on btrfs. Each move aside, check and link costs a few
     hundred µs per file on APFS. That was inferred from the refusals,
     not timed. A save that lands inside an accept refuses it, which is
     right and loses nothing: the thread catches up and offers again.
     With no save during the accept, it never refused (the late rows:
     300 of 300 written).

**What the design takes from this:**
- **The accept leaves no timing constant.** Its only wait is the folder's
  quiet window, which a read has anyway.
- **Scans must see asides.** They are skipped as your files, but each one
  is checked at every read until it is deleted or kept.
- **An aside that keeps changing** (an app writing a log through a held
  file) never lets the folder go quiet. The read must not wait on it: a
  changed aside is kept as a state of yours at each read, and watched
  until it is quiet.
- **A crash** between moving aside and linking leaves an aside and no
  target. The accept needs a journal in the session's store, written
  before its first move, so a restarted host puts each aside back or
  finishes.
