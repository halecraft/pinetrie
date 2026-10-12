# S169 — The host and a lane see a shared file with the same size and ctime (on the Mac, not the same inode); ctime is the host's clock for both, so it orders every write on one timeline; and the host's watcher saw every lane write with the stamp the lane recorded, on the Mac and on Linux

- **Status:** Answered
- **Led to:** ADR-0135

**Question.** A shared file's line of versions (ADR-0135) learns a lane's
writes from the lane's supervisor, each version a stamp (inode, size,
ctime) read inside the lane through virtiofs, and ordered by the lane VM's
monotonic clock. Your writes on the Mac reach the line only when a lane
next reads the file, as a stamp no line has seen. So a write of yours that
no lane reads afterwards is never on the line, and one a lane overwrites
from an older read is lost without a flag. A watcher on the Mac
(`@parcel/watcher`, which S161 found sees every change) would close both
gaps, if:
1. **Stamps agree.** Does `stat` on the Mac give a file the inode, size
   and ctime that `stat` in a lane gives it, through the lane's virtiofs
   mount? For a lane's write, the Mac must recognise the stamp the lane
   recorded, or it will take the lane's write for yours. Checked for:
   create, overwrite, append, save by rename, a restored mtime, and two
   writes within one millisecond; written in the lane and on the Mac.
2. **One timeline.** Can a version made on the Mac be placed among
   versions made in lanes?
   - Is a lane's write's ctime the Mac's clock when it landed, so that
     ctime orders both kinds on one clock?
   - If not, what is the offset between the lane VM's wall clock and the
     Mac's (S163 steps the VM's clock), and how much does it move?
   - How long after a lane's write does the Mac's watcher report it? A
     Mac event in that window cannot yet be told from the lane's.
3. **What the watcher reports for a lane's write.** Does the stamp the Mac
   reads when the event arrives equal the stamp the lane read after its
   write, or has a later write overtaken it?

**Kill criterion.**
- If the inode or the ctime differs between the two views with no fixed
  mapping, a stamp cannot name one version on both sides: the watcher
  cannot tell your writes from lanes', and the line keeps learning yours
  only when a lane touches the file.
- If no clock orders Mac and lane writes to within the watcher's latency,
  a Mac write can be numbered but not checked for concurrency, and is
  recorded with no base, as the plan already assumed.

**Throw away.** The scripts and output go in `.plans/disk-model-probes/S169/`
while we work, and into `docs/findings/S169-mac-stamps/` once answered.
Every file they write is under `.plans/disk-model-probes/S169/scratch/`.
- `lane.mjs`, run in a lane: waits for the Mac's `go`, writes a fixed load
  under `scratch/lane/`, recording after each write the VM's monotonic and
  wall clocks and the lane's stamp; then, once the Mac is done, stats every
  file under `scratch/` from the lane.
- `mac.mjs`, run on the Mac from your working copy: watches `scratch/`,
  stats each file an event names as it arrives, writes a load of its own
  under `scratch/mac/` with the Mac's stamp after each write, and at the
  end stats every file under `scratch/` from the Mac.
- `analyse.mjs`, run in a lane once both have: compares the two views.

## Answers

One coordinated run (2026-10-12): `mac.mjs` on the Mac (`darwin 25.6.0`,
your working copy's `.plans`, APFS) and `lane.mjs` in a lane (`linux
6.18.55-0-virt`, the same folder through its virtiofs mount). Each side
wrote 60 times, 150–300 ms apart: create, overwrite, append, save by
rename, a restored mtime and two writes within a millisecond, ten of each.
The results are `results-lane.json` and `results-mac.json` in
`docs/findings/S169-mac-stamps/`, and `analyse.mjs` reads them into
`results-analysis.json`.

1. **Size and ctime agree; the inode does not.**
   - On all 62 files, once both sides were quiet, the two views gave the
     same size, the same ctime and the same mtime, to the nanosecond.
   - The inode differed on every file: the lane sees virtiofs's own
     numbers (4988, 4991, …), the Mac sees APFS's (15062055, …). The
     mapping is one to one per file, but neither side can compute the
     other's.
   - Every write's stamp right after it matched the other side's final
     stamp on size and ctime, for every kind of write and in both
     directions (10/10 each), and on inode for none.
   - So a stamp that both sides read alike is the size and the ctime. The
     inode adds nothing ctime lacks here: a save by rename gave a new
     ctime as well as a new inode, and the two writes within a
     millisecond had different ctimes in all 10 pairs on both sides.
2. **ctime is one timeline: the Mac's clock.**
   - A Mac write's ctime was the Mac's wall clock when it wrote, to within
     a millisecond (−0.2 to 0.8 ms).
   - A lane write's ctime was 825.0–826.5 ms ahead of the lane VM's own
     wall clock: the file system on the Mac sets it, with the Mac's
     clock. The VM's wall clock lagged the Mac's by that steady offset,
     which moved by under 1.5 ms over the run.
   - ctime kept each side's own order of its writes in all 59 pairs on
     each side.
   - So versions from lanes and from the Mac can be ordered by ctime
     alone, with no clock mapping. The lane VM's monotonic clock orders
     lanes' writes only.
3. **The watcher reports a lane's write with the lane's stamp.**
   - 144 events and no errors. Each of the lane's 60 writes was reported
     by an event whose stamp, read on the Mac as the event arrived, was
     the size and ctime the lane recorded after the write.
   - An event came 11–68 ms after the write's ctime (median 65 ms), by
     the Mac's clock.

**Kill criterion:** not met. The inode differs between the views with no
mapping either side can compute, but size and ctime name one version on
both sides, so the stamp drops the inode.

**What this changes for the watcher.** The host can take every event's
stamp as a version at once, ordered by its ctime, and attribute it to a
lane when that lane's turn later reports the same stamp: arrival order and
the 65 ms lag do not matter, since versions are matched by stamp, not by
time. A version no lane ever reports is yours.

**Not measured:** writes closer together than 150 ms, where a later write
can overtake an event before the Mac stats the file (the event then
carries the later stamp, and the earlier version is seen by its writer's
report alone); a dropped-events error (S150's 5,000 renames in 285 ms);
volumes other than APFS.

## Addendum: a Linux host

On Linux, lanes are Docker containers on the host's own kernel, and a
shared directory is a bind mount of your folder, not a virtiofs share. The
same probe ran with a lane as the host (`linux 6.18.55-0-virt`, the folder
on btrfs) and a container of its rootless Docker as the lane
(`node:24-alpine`, the folder bind-mounted). `mac.mjs` ran as the host
side, its watcher on inotify. The results are `results-linux-host.json`,
`results-linux-lane.json` and `results-linux-analysis.json`.

1. **Every field of the stamp agrees, the inode included,** on all 62
   files and for every kind of write, both ways: one kernel, one inode.
2. **ctime is the one kernel's clock** for the host's writes and the
   container's alike (within the 1 ms of `Date.now`), and kept each
   side's order in all 59 pairs.
3. **The watcher saw all 60 of the container's writes,** each with the
   full stamp the container recorded, in 50–71 ms. No errors.

So the stamp of size and ctime holds on both hosts, and ordering by ctime
too. On Linux the inode would also agree, but one stamp for both is the
simpler rule.

**A clock that steps breaks ctime's order.** In the middle of this run,
the VM's wall clock was stepped forward by 390.7 s, by the clock
correction S163 added. The monotonic clock put the event it landed on
3.3 ms after its write. A step forward keeps ctime's order; a step
backward would reverse the order of the writes either side of it. A Mac
or a Linux host whose clock is kept by NTP slews it, and steps it rarely
(at boot, or after a long sleep).

**Not measured on Linux:** a working copy on ext4 or another file system;
inotify's watch limit (`max_user_watches`) on a large shared folder; Docker
run inside a VM on Linux (Docker Desktop), which would be like the Mac's
case again.
