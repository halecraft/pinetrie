# S178 — An extra slot holding only a shared directory works as well as the host's own slot: the working copy's read-only view lags renames, appends and deletes by 1 s in both

- **Status:** Answered
- **Led to:** ADR-0141

Follows S130, S131, S140 and S141.

**Question.** On the Mac, a shared directory (`.plans`, ADR-0035) that
accepted work adds while the host runs cannot reach its lanes: the host's
slot in the lane VM is filled once, at its lease, and a lane whose mounts
name a directory outside it cannot be made ("not shared into slot 0").
Refilling the slot (S140, way 1) cuts every running bind into it (S130), so
it needs a moment when none of the host's containers runs. On a busy host
that moment comes only if new runs are held until the running ones end, and
every thread then waits for the longest run.

The alternative: fill an **extra slot** with the new directories alone. The
host's slot is untouched, its running lanes go on, and lanes made from then
on bind the new directory from the extra slot. When no container of the
host runs, the host folds it back: it refills its own slot with every
directory and empties the extra one (S140, way 1).

S141 rules out one directory in two slots: appends through both lose lines,
and a file created through one can be refused through the other. The extra
slot avoids that for the directory itself, which only it shares read-write.
But `.plans` lies inside the working copy, which the host's slot shares
read-only, so a lane would see one Mac directory through two FUSE sessions:
- writing it at `/workspace/.plans`, through the extra slot;
- reading it at `/mnt/host-working-copy/.plans`, through the host's slot.

Today both are entries of one share, and a write through one is readable
through the other in under 1 ms (S161). Across two slots, S140 saw 33 ms
for new files and rewrites, but S140 did not test deletes, renames, appends,
new subdirectories or a lookup that missed just before. This spike measures
all of them, the one-slot layout of today beside the extra slot's, in one VM:
1. a change through `/p` (new file, new file after a lookup through `/h`
   missed, rewrite, rename over, append, delete, new subdirectory): how
   long until `/h/.plans` shows it, or whether it ever does;
2. whether any change through the extra slot is refused;
3. whether two containers appending to one file through the extra slot
   keep every line, as through one slot (S141, case 2);
4. whether filling the extra slot leaves a container running on the
   host's slot working;
5. the fold back: once none of the host's containers runs, whether a new
   container on the refilled slot reads what was written through the
   extra slot, and what a stopped container bound into the emptied extra
   slot does when started again.

**Kill criterion.** In the extra slot's layout:
- any change through `/p` is refused;
- or `/h/.plans` shows one later than 1 s, or never;
- or two containers' appends lose or tear a line;
- or filling the extra slot breaks the running container's bind.

Then the extra slot is out, and the plan refills the host's slot when it
has no container running, without holding new runs.

**Throw away.** The probe's folder (`s178-extra-slot/` in the shared plans
folder): its two scripts and its results. It builds S131's launcher and
copies S131's kernel and first stage, and uses S128's system image; its
data disk and test folders are deleted when it ends. Its scripts:
- **`run.sh`:** runs on the Mac. It boots S131's launcher with 3 slots, and
  sets up the two layouts on their own Mac folders, `W0` and `W1`, each a
  fake working copy with `.plans` inside:
  - **one slot (today's):** slot 0 holds `W0` read-only and `W0/.plans`
    read-write;
  - **extra slot:** slot 1 holds `W1` read-only; slot 2, filled while a
    container runs on slot 1, holds `W1/.plans` read-write alone.

  A container binds `W` at `/h` read-only and `.plans` at `/p` read-write,
  as a lane binds `/mnt/host-working-copy` and `/workspace/.plans`.
- **`probe.sh`:** runs in the containers. It makes one change through `/p`,
  then polls `/h/.plans` with no sleep until the change shows, timed with
  GNU `date`, for at most 3 s. One container measures both sides: lanes
  on one VM share one cache per share (S161), so a second container would
  read the same thing.

  It was checked in a lane on one directory, every case in 0.5–0.7 ms. A
  path that could not be written printed `refused`, and a view that never
  changed printed `never` after 3 s.

## How to run it

On the Mac, in pine·trie's repo: `bash .plans/s178-extra-slot/run.sh`.
About three minutes. It needs what S141 did: `swiftc`, `codesign` and the
docker CLI, S131's folder (`.plans/s131-share-slots/`) and S128's system
image (`.plans/s128-launcher/system-trim2-lz4hc.erofs`). It pulls
`alpine:3` and installs `coreutils` in it. Its output goes to
`results.txt` beside it.

## How it ran

Duane ran it once on the Mac (Apple M3 Max, macOS 26.7.1, docker CLI
29.8.1), on 2026-10-13, with the pine·trie host and its lane VM running
beside the probe's VM. Every replacement took under 1 ms (the launcher's
timing). The full output is `results.txt` in the probe's folder.

A poll that held at once cost 0.6–0.7 ms, so every time below includes
about that much of the probe's own. Times in ms, the median of 5 rounds,
the range in brackets:

| change through `/p` | one slot (today's) | extra slot |
|---|---|---|
| new file | 1.0 (0.8–1.2) | 0.9 (0.8–1.0) |
| new file, a lookup through `/h` missed first | 0.9 (0.8–1.0) | 0.9 (0.9–1.0) |
| rewrite in place | 0.7 (0.7–0.8) | 0.8 (0.7–0.8) |
| new subdirectory and file | 1.1 (1.0–1.1) | 1.0 (0.8–1.4) |
| rename over | 998.4 (998.0–998.9) | 999.0 (998.7–999.2) |
| append | 999.6 (998.8–999.8) | 999.7 (998.9–999.8) |
| delete | 999.0 (998.5–999.4) | 999.3 (999.1–999.8) |

## Answers

1. **The extra slot shows every change as fast as today's layout does.**
   New files, rewrites and new subdirectories showed through `/h/.plans`
   in about 1 ms in both layouts, a lookup that had just missed included.
2. **Renames, appends and deletes show 1 s late in both layouts, today's
   included.** Every round in both took 998–1,000 ms, counted from the
   change, a few ms after `/h` last read the file. That is the guest's
   cache of a name or a file's size, held about 1 s and not refreshed by a
   change through the other entry, and not the slots. A reading, not
   measured: the share's server gives each entry's paths node ids of their
   own, so the guest does not know `wc/.plans/x` and `pl/x` are one file,
   and keeps each until its timeout. S161 found the two views one, but it
   measured only overwrites and new files, which both read fresh here too.
   So a lane reading `/mnt/host-working-copy/.plans` can see, for up to
   1 s, the name or the length of a file from before a write through
   `/workspace/.plans`.
3. **Nothing was refused** through either slot, and the Mac's writes into
   `.plans` read through both views of both layouts 0.5 s later.
4. **Two containers appending to one file through the extra slot kept
   every line**, 100 of 100 each with none torn, both ways they wrote it,
   as through one slot (S141, case 2). The extra slot is one FUSE session,
   as the host's slot is.
5. **Filling the extra slot left a container running on the host's slot
   working**: it read the working copy, and then the files the Mac and the
   extra slot's container wrote into `.plans`. S131 found the same.
6. **The fold back works**: once no container of the layout ran, the
   host's slot was refilled with the working copy and `.plans`, and the
   extra slot emptied.
   - A new container on the refilled slot read what was written through
     the extra slot, and its own change showed in 1.1 ms.
   - The container bound to the host's slot alone, stopped and started
     again, read it too (S140).
   - **A stopped container bound into the emptied extra slot does not
     start**: Docker cannot create its bind's source
     (`mkdir /mnt/slots/2/pl: operation not permitted`). It must be made
     again on the refilled slot. A lane's binds are in its container's
     spec, whose hash names it, so a lane whose `.plans` moves from the
     extra slot to its host's is made again at its next start
     (`specHash`, `packages/docker/runtime.ts`).
7. **The guest's kernel logged nothing** but FUSE's start.

## What this means

- **Kill criterion: not met.** Nothing refused, no line lost, the running
  bind kept. The slowest changes took just under 1 s, as today's layout
  does, so the extra slot adds no lag of its own.
- **A shared directory added while the host runs can reach its lanes on
  the Mac without a drain:** the host fills a free slot with the new
  directories alone, and lanes made from then on bind them there.
- **The fold back rarely finds its moment.** Besides lanes, a host's
  lanehost roles bind its slot (pine·trie's install and the lane runtime,
  `packages/docker/TECHNICAL.md`), and they run as long as the host does.
  Refilling the host's slot means closing them too, so the extra slot is
  better kept until the host's next lease (a restart, or a new VM), which
  fills one slot with every directory. A lane bound into the extra slot is
  then made again at its next start: its binds name another slot, so its
  spec differs.
- **Each change uses a slot until then**, out of 16 by default (ADR-0130).
  A later change takes another slot for its own new directories: adding
  them to the first extra slot would replace its share under the lanes
  bound into it.
- **Today's layout already lags 1 s** between a lane's `/workspace/.plans`
  and its `/mnt/host-working-copy/.plans`, for renames, appends and
  deletes. Nothing reads the second for `.plans` on purpose, but a tool
  walking the working copy's mount can.
