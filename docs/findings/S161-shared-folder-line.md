# S161 — A shared folder can be a single line of states: a lane's supervisor sees and attributes every write into it, versions are captured exactly at release, concurrent writes are flagged exactly, and the Mac's watcher saw all 3,400 of a lane's writes

- **Status:** Answered
- **Led to:** ADR-0135

**Question.** A shared folder (`.plans`, ADR-0035) is one live copy,
written by every lane and by you on the Mac. It is never branched, and it
lies outside every thread's state. The proposal is to give it a history of
its own: a single line of states, advanced by each write, each write
attributed to the tool call that made it. Then:
- a turn's record could name the shared state it read and wrote;
- a write based on a version that is no longer current could be shown as
  concurrent, not silently lost.

That rests on beliefs nothing has measured yet:
1. **Observation.** Does the per-call supervisor of S158 see writes into
   the shared mount, a virtiofs mount inside `/workspace`? That includes
   create, append, rename, unlink, mmap writes, and paths relative to a
   working directory inside it.
2. **Capture.** Can a write's content be captured without a race? The
   proposal is to hash the file:
   - when the writer closes it, while the writer waits on the supervisor;
   - when a reader opens it, to know which version it read.

   With two lanes writing one file at once, does each capture belong to
   its writer? Does a write based on an old version show as one? What does
   watching `close` cost?
3. **Views.** Is the lane's read-write mount of the shared folder the same
   view as the read-only mount of your working copy, with no lag between
   them? Lanes on one VM share a kernel (S116), so their views should be
   one cache.
4. **The Mac's side.** Does the host's watcher on the shared folder
   (FSEvents, through `@parcel/watcher`) see every change lanes make
   through virtiofs, and every change you make? Does it see them all, as a
   full scan would? How long are the bursts and the quiet gaps?
5. **Volume.** How many files does the shared folder hold, how large are
   they, and how often do they change? That decides whether keeping every
   version is free.

**Kill criterion.**
- If the supervisor misses writes into the shared mount (question 1), a
  lane's writes cannot be attributed, and the shared folder stays outside
  the model.
- If captures at close attribute content to the wrong writer (question 2),
  the line can name states, but not who made them.
- If the host's watcher misses changes lanes make (question 4), writes
  from outside every lane cannot be put on the line reliably, and the line
  covers lanes' writes only.

**Throw away.** The scripts and output go in `.plans/disk-model-probes/S161/`
while we work, and into `docs/findings/S161-shared-folder-line/` once
answered:
- `seccall.c`: S158's supervisor, with a capture mode that hashes shared
  files at open and at close.
- `probe.py`: questions 1, 2, 3 and 5, run in a lane. Every command runs
  under a time limit, and the whole run stops after ten minutes.
- `mac-watch.mjs`: question 4. It is run on the Mac during ordinary work,
  watching the shared folder and comparing its events with scans at the
  start and the end. It writes its results into the shared folder, where
  the lane can read them.

All test files go under `.plans/disk-model-probes/S161/scratch/`, and
nothing else in the shared folder is written.

## Answers

Run in a lane (Debian 13, arm64), on the shared folder itself, under
`.plans/disk-model-probes/S161/scratch/`.

1. **The supervisor sees every write into the shared mount.** One tool call
   under the supervisor did the following, all seen with absolute paths
   (the relative one resolved):
   - created, appended to, renamed and deleted files;
   - wrote through mmap, from node, and with `sd` (a static binary that
     writes a temporary file and renames it);
   - wrote a file under a subdirectory, by a relative path;
   - wrote from a background job, after the call returned.

   In every case, the last version captured for a file was the one on disk.
2. **Capturing a version takes more than watching `close`. With release and
   open both watched, the line was right in all 100 rounds.**
   - **Close alone misses.** A shell's redirection is fd 1. dash restores
     its stdout with `dup2`, which releases the file without a `close`
     call, and a process's exit closes its descriptors without one either.
     Watching `close` alone captured a redirected `printf` as an empty
     file.
   - **The supervisor's capture mode** (`SECCALL_CAPTURE_ROOT`) therefore
     watches `close`, `dup3`, `exit_group` and `execve`. On each, it hashes
     every descriptor open for writing under the shared folder, while the
     caller waits. It also hashes a file when it is opened: the version
     the caller starts from.
   - **A process killed by a signal** makes none of those calls. Its last
     version can only be captured when its tool call ends.
   - **The race:** two tool calls each read one shared file, then wrote it,
     at random offsets (0–120 ms apart, 0–60 ms between read and write),
     over 100 rounds. The host's rule: a write is clean if the version its
     writer last read is the line's head, and concurrent otherwise.
     - In 20 rounds, one call wrote over the other's write without having
       read it.
     - The line flagged exactly those 20, and no others.
     - In all 100 rounds, every captured version held its own writer's
       content.
3. **The two mounts are one view.** The lane's read-write mount and the
   working copy's read-only one have the same device. A write through one
   was readable through the other in the polling loop's first pass (median
   0.5 ms, at most 0.9 ms), for overwrites and new files alike. Lanes on one
   VM share this cache (S116). So a lane cannot read a version older than
   another lane's write. The lag lucky-falcon saw is between the VM and
   the Mac, which question 4 measures.
4. **The Mac's watcher sees lanes' writes through virtiofs, and missed
   none.** A first run saw only one change from a lane. duane ran `mac-watch.mjs` on the Mac (`darwin 25.6.0`, root
   `/Users/duane/halecraft/pinetrie/.plans`) for 15 minutes,
   with `results-mac-watch-2026-10-12T02-32-08-101Z.json` as the result.
   - **Events:** 23, with no errors and no dropped events.
   - **What changed:** 21 files. 20 were the script's own writes on the
     Mac, and 1 was a lane's (another thread's plan,
     `2026-10-11-decision-ids.md`).
   - **Seen:** every change the scans show was named by an event.
   - **Timing:** the events came in 22 bursts, each a single event, with
     gaps of 1.4 s at the least and 18 s at the median.

   - **A second run, coordinated, gave the answer**
     (`results-mac-watch-2026-10-12T02-47-31-944Z.json`). duane ran the
     watcher on the Mac for 10 minutes. Meanwhile the lane wrote a fixed
     load under `scratch/lane/` (`results-lane-writes.json`), over 104 s:
     - 184 creates, 100 appends, 59 renames and 61 deletes, 0.05–0.4 s
       apart;
     - a nested directory, then that directory renamed;
     - 2,000 new files in 0.69 s;
     - 1,000 of them deleted in 0.18 s.
   - **Every change the start and end scans show was named by an event:**
     1,144 changed files (1,124 from the lane, 20 from the script on the
     Mac), with nothing missed.
   - **The event count matches the operations one for one.** The lane's
     operations make about 3,470 events (a rename is a delete and a
     create), and with the Mac's 20 and one other thread's write, the
     watcher saw 3,491. Files created and deleted within the window are
     invisible to the scans, so the count is what covers them.
   - **No drop was reported,** even at 2,000 files in 0.69 s. S150's drop
     came at 5,000 renames in 285 ms, a rate about four times this one. A
     drop is reported when it happens (S150), and answered with a full
     scan.

5. **The shared folder is not small.**
   - **Size:** 481 files and 1.8 GB. The median file is 13 KB, and the
     largest is 322 MB (probe artifacts: VM images, screenshots).
   - **How often it changes:** 58 files changed in the last hour (most by
     this spike), 68 in the last day, and 351 in the last week.
   - **So:** keeping every version of the text is cheap, but the large
     binaries in it would need S156's chunks, or to be kept out of the line.

**Cost, measured while the VM was busy** (load average 6 to 9, so these are
upper bounds, not S158's quiet-machine numbers; `results-cost.json`):
- **Opening a file on the shared mount is slow in itself:** an open and
  close took 3.0 ms with no supervisor at all (virtiofs).
- **Capture mode added 2.7 ms to each one** (5.7 ms in all), for a 4 KB file
  hashed over virtiofs.
- **Outside the shared folder,** capture mode added about 17% to opens-only
  mode, from watching `close`. A repeat run timed out at the 60-second
  limit while the load stayed high, so this is one measurement.

**Against the kill criteria.** None fires.
- Lanes' writes into the shared folder are seen and attributed.
- Captures belong to the right writer, and concurrent writes are flagged
  exactly.
- The host's watcher on the Mac saw every lane's write and every write of
  its own.

**What this makes possible.** A shared folder can be a single line of
states:
- **Each write goes on the line.** For a lane, that is its tool call's
  release capture, which carries the version it read. For the Mac, it is
  a watcher event followed by a hash, with no version read, so such a
  write cannot be checked for concurrency.
- **A write whose base is not the head is shown as concurrent.**
- **What stays open:**
  - large binaries in the shared folder;
  - the last version of a process killed by a signal, which is captured
    only when its call ends;
  - the cost on a quiet machine.

**How to run question 4, on the Mac,** from your working copy, while
threads work as usual:

```sh
node .plans/disk-model-probes/S161/mac-watch.mjs 15
```

It writes `results-mac-watch-<time>.json` into
`.plans/disk-model-probes/S161/`, where the lane reads it. The test files
under `scratch/` were deleted afterwards.
