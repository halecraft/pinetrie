# S185 — Reading your folder into a state in the lane VM, and writing an accept into it on the Mac: cost, stability, and what the watcher sees of pine·trie's own writes

- **Status:** Answered
- **Led to:** ADR-0142, ADR-0159

**Question.** ADR-0142 reads the folder into a state at a thread's start,
each catch-up and each accept, and writes an accept into it, staged and
checked. On the Mac the folder is on APFS, and the VM sees it through the
read-only virtiofs share every lane has (`/mnt/host-working-copy`).
1. **Reading, in the VM:** copying a tree of real size (pine·trie's
   working copy) and large files from the share into a btrfs disk: how
   long the first time, and how long for a read that copies only the
   files whose stamp changed? Is a file's stamp (size, ctime) read in the
   VM the stamp the Mac reads (S169), so that the Mac's scan can say what
   the VM copies?
2. **A file changing during a read:** does the stamp read after the copy
   always differ from the one read before it when a writer on the Mac
   changes the file meanwhile?
3. **Writing, on the Mac:** a staged write and a checked rename into the
   folder (`rename` over the target only while its stamp is what was
   read). How long per file and per GB? Does a save by an app (TextEdit,
   Preview, a script's save by rename) between the check and the rename
   ever go unseen?
4. **The watcher's echo:** do FSEvents (through `@parcel/watcher`) report
   pine·trie's own staged writes and renames, and can each be told from
   yours by its stamp, so an accept is not read back as your edit?
5. **Names:** writing `Foo.txt` into a folder holding `foo.txt`, and an
   NFD name over an NFC one: does the checked rename replace the other
   file? (S150 found an exclusive create refused, and a lookup finding
   either.)

**Kill criterion.**
- If a read of only what changed costs more than a second for a save of
  one file in a tree of 100,000, the folder is read at the moments
  ADR-0142 names and not after every quiet window.
- If a change during a copy can leave both stamps equal, a read must
  compare content, and S149 rule 4's check is not enough.
- If the watcher cannot tell pine·trie's writes from yours, an accept is
  read back as a state of yours, and the line needs the accept's own
  state recorded first and the watcher's events for its paths dropped by
  stamp.

**Throw away.** `docs/findings/S185-folder-reads-and-writes/`:
`vm-read.py` runs in a lane on the Mac (any lane is in the VM);
`mac-write.mjs` runs on the Mac, with `@parcel/watcher` installed into a
temporary prefix as S150's probe did.

## How to run the Mac's half

From pine·trie's repo root on the Mac, with `pnpm install` done (the probe
loads `@parcel/watcher` from `apps/pinetrie`):

```sh
# Questions 3, 4 and 5: about a minute; works in a fresh folder under $HOME,
# writes results-mac-<time>.json beside itself, and removes the folder.
node docs/findings/S185-folder-reads-and-writes/mac-write.mjs all

# Question 2: a writer on the Mac and a reader in a lane at once.
# On the Mac, in your working copy (sandbox/ is ignored):
node docs/findings/S185-folder-reads-and-writes/mac-write.mjs torn sandbox/s185-torn 90
# Within those 90 s, in any lane of this project (a thread's shell tool):
python3 docs/findings/S185-folder-reads-and-writes/vm-read.py --torn /mnt/host-working-copy/sandbox/s185-torn 60
# Then delete sandbox/s185-torn on the Mac.

# The accept's write against a save at a random moment: three protocols,
# 3,000 trials each, two kinds of save; a few minutes, under $HOME.
node docs/findings/S185-folder-reads-and-writes/race.mjs
```

Both were run once on Linux, in a lane, to check that they work (not as
answers): the checked rename's window from check to rename was 22–41 µs at
the median, the watcher classed all 450 paths right, and no read was torn
with its stamps equal.

## Answers

Run in a lane on duane's Mac (the lane VM, kernel 6.18.56) against
`/mnt/host-working-copy`, the working copy as virtiofs shares it, by
`vm-read.py`. The output is `results-vm-read.json`. `.git` and `.jj`
were skipped, as a folder project's read skips them. That leaves 49,801
files and 7.7 GB (`node_modules`, `.plans` and `sandbox` included). With
`.jj`, the share holds 328,848 files, and a bare listing of all of them
took 78 s, cold.

1. **Reading.**
   - **The VM must not find the changes itself.** Its stat walk over the
     share took 2.1 s, then 1.6 s warm: about 3.2 s per 100,000 files,
     against the Mac's 0.3 s on APFS (S150). Per 100,000 that breaks the
     kill criterion's second. So the Mac scans, and the VM copies only the
     paths it is told.
   - **A read the Mac directs is cheap:** copying 1 file took 1 ms, 100
     took 52 ms, and 1,000 took 444 ms, each staged, renamed, and checked
     by its stamp before and after.
   - **A first read copies everything:** 7.7 GB in 33 s, 235 MB/s over
     files of mixed sizes. The five largest files (2.9 GB) copied at
     1.4 GB/s, but read for the second time, possibly from the VM's cache.
   - **Stamps are the Mac's** (S169: size and ctime agree, the inode does
     not), so the Mac's scan names the stamp the VM checks.
2. **A read through the share never took a torn file for a whole one.**
   - The setup: duane's Mac rewrote 20 files of 4 MiB in place, same size,
     one byte value per rewrite, in 64 KiB chunks. Meanwhile a lane read
     each through `/mnt/host-working-copy`, with its stamp before and
     after (`vm-read.py --torn`, `results-torn.json`).
   - **No torn read went unseen:** of 21,460 reads in 60 s, 20,375 saw the
     stamp move and would be read again. 1,085 saw it still and held one
     version whole, and none held mixed bytes behind equal stamps.
   - **What the share shows is current:** over 15 s, the reads that found a
     file still saw 5 successive versions of it, so the VM did not serve a
     stale copy.
   - **S149 rule 4's check is enough:** a stamp read before and after the
     copy.
3. **Writing, on the Mac** (`mac-write.mjs all`, macOS 25.6, Node 24.19,
   APFS under `$HOME`: `results-mac-2026-10-13T20-52-49-366Z.json`).
   - **A staged, checked write costs 0.12 ms a small file, and 140 ms a
     GiB.** With `fsync` before the rename (libuv's is `F_FULLFSYNC` on
     macOS) it costs 5.8 ms a file and 263 ms a GiB. An accept need not
     pay that: what it writes is also in the accept's state, so a write a
     crash loses is restored from there.
   - **The check-to-rename window is 79–113 µs at the median and up to
     179 µs, on APFS.** A save that lands in it is replaced, and since no
     read saw it, it is lost. `mac-write.mjs`'s racer saves as fast as it
     can, so its counts bound the window and do not measure people.
     `race.mjs` measures losses directly instead (below).
   - **No checked rename can close it, but a protocol that never replaces
     a file it has not checked can** (`race.mjs`: one save at a random
     moment in each of 3,000 trials, run in a lane on btrfs,
     `results-race-linux-lane.json`):

     | protocol | saves by rename lost | writes in place lost |
     |---|---|---|
     | check the stamp, then rename over | 2 | 130 |
     | rename aside, check, link in, delete the aside | 0 | 10 |
     | the same, its last check 5 ms later | 0 | 0 |

     - **Rename aside, check, link in:** the target is renamed aside, which
       keeps its inode, size and mtime; those are checked against what the
       read saw; the staged file is linked into place, which fails if
       anything was saved there since; the aside is checked once more, then
       deleted. A check that fails puts back what it found and refuses. A
       save by rename that comes after the move aside makes the link fail;
       one that comes before makes the check fail.
     - **A write in place** that opened the file before it went aside
       writes into the aside. It is lost if the last check came before the
       write: 10 of 3,000. Pausing 5 ms before the last check gave the
       writer time, and lost none. One pause serves a whole accept: every
       path moved aside and linked, one pause, then every aside checked.
     - **What is left** is a writer that holds a file open for longer than
       the pause and writes through it after the accept. Nothing chooses
       the pause's length: S192 drops it, and keeps the aside until the
       folder's next read instead.
     - **On APFS** (`results-race-darwin.json`), checking then renaming
       over lost 1 of 3,000 saves by rename and 300 of 3,000 writes in
       place; both protocols that move aside lost none. They refused about
       half of the saves by rename, against almost none on btrfs: each
       step costs more on APFS, so more saves land inside the accept.
4. **pine·trie's own writes can be told from yours.** The watcher reported
   all 701 paths, none missed. The staging names (250) are dropped by
   their prefix; the 200 accepted paths carried the stamp the write left,
   and were known as pine·trie's; the 250 you wrote, the 50 written by you
   right after pine·trie among them, were yours, and so was one more
   path, the probe's folder itself. None was misclassed.
5. **APFS's names make the check refuse, as it should.** An offer adding
   `Foo.txt` where `foo.txt` is, or `café` in NFD where it is in NFC: the
   check found the target present, so a write expecting it absent was
   refused. Renamed in anyway, it replaced `foo.txt`'s content and kept the
   old name's case: the collision a check must catch. The tree check
   (ADR-0142) refuses such an offer before any write. The write's own
   expectation catches it again if the folder changed since.
