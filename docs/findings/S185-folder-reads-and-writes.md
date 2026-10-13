# S185 — Reading your folder into a state in the lane VM, and writing an accept into it on the Mac: cost, stability, and what the watcher sees of pine·trie's own writes

- **Status:** Open (the VM's half answered; the Mac's half not yet run)
- **Led to:** ADR-0142

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
```

Both were run once on Linux, in a lane, to check that they work (not as
answers): the checked rename's window from check to rename was 22–41 µs at
the median, the watcher classed all 450 paths right, and no read was torn
with its stamps equal.

## Answers (the VM's half)

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
2. Not yet run: it needs a writer on the Mac.
