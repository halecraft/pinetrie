# S162 — A shared file's version can be its stamp (inode, size, ctime): every change of content changed it, forged mtimes included, and a line built on stamps decides races as one built on hashes does

- **Status:** Answered
- **Led to:** ADR-0135

**Question.** ADR-0135 (proposed) gives a write to a shared directory a
version, so that a write based on a version that is no longer current
shows as concurrent. S161 checked that scheme with a hash of each file's
content, which costs a read of the whole file on every open and release.
The proposal is a stamp instead, read with one `stat`: the file's
**inode, size and ctime**.
- **ctime, not mtime,** because `touch -r`, `cp -p`, `rsync -t` and tar set
  mtime on purpose, and no program can set ctime.
- **The inode** catches a save that renames a new file over the old one.

What must hold, on the shared mount as a lane sees it (virtiofs, from the
Mac's APFS):
1. **Resolution:** does every write, even back to back and of the same
   size, change the stamp? Within one process, and across two?
2. **Forged times:** does the stamp change when a tool rewrites a file at
   the same size and restores its old mtime?
3. **mmap:** does a write through a mapping change the stamp, and when:
   at the store, at `msync`, or at `munmap`?
4. **Rename:** does a save by rename change the inode?
5. **The race:** in S161's 100 rounds of two tool calls each reading then
   writing one file, does a line built on stamps flag exactly the writes
   that overwrote a version their writer never read, as the hashes did?

**Kill criterion.** Any write whose content differs from the version
before it, but whose stamp is the same, in questions 1 to 4. Or any round
in question 5 where stamps and the truth disagree. Then a version must be a
content hash, as S161 used.

**Throw away.** The scripts and output go in `.plans/disk-model-probes/S162/`
while we work, and into `docs/findings/S162-version-stamps/` once answered.
All test files go under `.plans/disk-model-probes/S162/scratch/`. Every
command runs under a time limit.

## Answers

Run in a lane, on the shared mount (`/workspace/.plans`, virtiofs from the
Mac's APFS), under `.plans/disk-model-probes/S162/scratch/`. The scripts and
output are in `docs/findings/S162-version-stamps/`:
- `stamps.py` covers questions 1 to 4 and writes `results-<step>.json`;
- `race.py` is S161's race, run with stamps (`RACE_MODE=stamp`) and with
  hashes (`RACE_MODE=hash`), and writes `results-concurrent-<mode>.json`;
- `seccall.c` is S161's supervisor, with `SECCALL_STAMP=1`.

1. **Every write changed the stamp.**
   - **One process:** 2,000 back-to-back writes of the same size changed
     the stamp every time. ctime moved by 177 µs at least, 193 µs at the
     median. mtime never repeated either.
   - **Two processes:** 2,000 same-size writes, alternating through pipes,
     changed it every time.
2. **Forged times do not hide a write.** Four rewrites at the same size
   each tried to restore the old mtime:
   - a rewrite followed by `utime`;
   - a rewrite followed by `touch -r`;
   - `cp -p` over the file;
   - `tar -x` over it.

   The first three restored the mtime exactly. The stamp changed in all
   four, through ctime, and through the inode for `tar`.
3. **mmap:** a store into a mapping did not change the stamp, as on any
   file system. `msync` changed it. A second store, then `munmap` with no
   `msync`, changed it again. So a stamp read when the file is released
   (`close`, or the process's exit) sees an mmap write.
4. **A save by rename changes the inode,** and the ctime with it.
5. **The race decides the same with stamps as with hashes.**
   - **A first run** disagreed in one round of 100. The test's own judge of
     the truth was at fault: it took a write's release time as the moment
     it was written, but the other call had already read the written
     content.
   - **The judge was then rebuilt on content:** what each writer read,
     against what the file held when it opened the file to write.
   - **Stamps:** 100 rounds of 100 agreed, 20 of them concurrent.
   - **Hashes:** 99 agreed. The rounds where either mode can go wrong show
     two limits of the scheme itself, not of stamps:
     - **Writes that overlap.** Both calls had opened the file for writing,
       truncating it, before either released it. Each release then records
       what the file holds, which may be the other's content. The conflict
       is still flagged, but whose content survived is not known.
     - **The base is taken at open, and read a moment later.** A writer
       that opens the file while another is mid-write records the
       truncated version as its base, then reads the finished one. Its
       write is then flagged concurrent when it was not. That is an error
       in the safe direction: noise, never a lost write.

**Against the kill criterion.** It does not fire. No change of content
left the stamp unchanged, in any test, and stamps decided every race as
content does. A version is the stamp (inode, size, ctime), read with one
`stat`, with no file read and no hashing.

**Found on the way: the lane VM's clock is 16.6 hours behind the Mac's.**
A shared file's times come from the Mac (59,749 s ahead of the VM's
`time()`, as `tar` noted). Stamps are only compared for equality, so the
offset does not matter to them. It is likely why `apt-get update` refused
Debian's signatures earlier in this work as "not live until" a time
already past on the Mac.
