# S187 — One Mac directory can be read-only in one slot and read-write in another: it lags as two entries of one slot do, by 1 s for renames, appends and deletes, and the read-only entry still refuses writes

- **Status:** Answered
- **Led to:** ADR-0141

Follows S141 and S178.

**Question.** When accepted work moves, a host adds a slot for the
directories its lanes may now mount and no slot of its holds
(S178). One case is left out: a directory its slot
holds **read-only** (a mount grant, say) that accepted work now wants
**read-write**. A second slot holding it read-write would share one Mac
directory through two slots. S141 found that unsafe with two read-write
slots: appends lost, and a create refused through one slot after the other
made the file. S178 measured a read-only entry and a read-write one in two
slots, but nested (the working copy, and `.plans` inside it), not one
directory twice. Here, lanes made after the widening bind the read-write
entry only, so all writes go through one slot. Lanes made before it go on
reading through the read-only one.

So, with one Mac directory read-only in slot 2 and read-write in slot 3,
filled after a container bound to slot 2 started:
1. a change through the read-write entry (new file, new file after a
   lookup missed, a new file in a listing read just before, rewrite,
   rename over, append, delete, new subdirectory): how long until the
   read-only entry shows it, or whether it ever does;
2. whether any change through the read-write entry is refused;
3. whether the read-only entry still refuses writes;
4. whether the container bound to slot 2 before slot 3 was filled still
   works.

Two layouts beside it, each on its own Mac folder:
- **A, one entry (the control):** a directory read-write in one slot,
  bound read-write and read-only from the same entry, as one lane's two
  binds of one source would be;
- **B, two entries of one slot:** the directory twice in one share, read-
  only and read-write. It tells whether a lag comes from entries or from
  slots. S178 found the same 1 s lag for renames, appends and deletes in a
  nested layout in one slot.

**Kill criterion.** In the two-slot layout:
- any change through the read-write entry is refused;
- or the read-only entry shows one later than 1.5 s, or never;
- or the read-only entry accepts a write;
- or filling the second slot breaks the running container's bind.

Then a directory held read-only stays so until the host restarts, as the
plan has it now.

**Throw away.** The probe's folder (`s187-ro-rw-slots/` in the shared
plans folder): its two scripts and its results. It builds S131's launcher
and copies S131's kernel and first stage, and uses S128's system image; its
data disk and test folders are deleted when it ends. Its scripts:
- **`run.sh`:** runs on the Mac. It boots S131's launcher with 4 slots:
  slot 0 holds `D0` read-write; slot 1 holds `D1` read-only and read-write;
  slot 2 holds `D2` read-only, and a container (`old`) is bound to it
  before slot 3 is filled with `D2` read-write. A container per layout
  binds the read-write entry at `/p` and the read-only one at `/h`. A last
  container binds the read-only entries without Docker's `:ro`, so only
  the Mac's side can refuse its write.
- **`probe.sh`:** S178's, run in the containers, with `/h` the directory
  itself, and a `list` case: a listing of `/h` read, then a new file
  through `/p`, timed until the listing names it.

  It was checked in a lane on one directory, every case in 0.4–0.8 ms, and
  a listing of another directory printed `never` after 3 s.

## How to run it

On the Mac, in pine·trie's repo: `bash .plans/s187-ro-rw-slots/run.sh`.
About three minutes. It needs what S178 did: `swiftc`, `codesign` and the
docker CLI, S131's folder (`.plans/s131-share-slots/`) and S128's system
image (`.plans/s128-launcher/system-trim2-lz4hc.erofs`). It pulls
`alpine:3` and installs `coreutils` in it. Its output goes to
`results.txt` beside it.

## How it ran

Duane ran it on the Mac (Apple M3 Max, macOS 26.7.1, docker CLI 29.8.1), on
2026-10-13. The first run failed at its own bug: Docker refuses a
container's name of one character, so the three layouts' containers were
never made; its read-only checks ran, and answered as the second did. The
second run is the one below. Every replacement took under 1 ms (the
launcher's timing). The full output is `results.txt` in the probe's
folder.

A poll that held at once cost about 0.6 ms, so every time below includes
about that much of the probe's own. Times in ms, the median of 5 rounds,
the range in brackets:

| change through `/p` | A, one entry | B, two entries of one slot | C, two slots |
|---|---|---|---|
| new file | 0.9 (0.9–1.0) | 0.8 (0.8–0.9) | 0.8 (0.8–0.9) |
| new file, a lookup missed first | 0.9 (0.7–0.9) | 0.9 (0.9–1.0) | 0.9 (0.8–0.9) |
| new file, a listing read first | 0.8 (0.8–0.8) | 0.9 (0.8–1.0) | 0.8 (0.8–0.9) |
| rewrite in place | 0.7 (0.7–0.8) | 0.8 (0.7–1.0) | 0.7 (0.7–0.8) |
| new subdirectory and file | 0.9 (0.7–0.9) | 1.0 (0.9–1.5) | 1.0 (0.9–1.1) |
| rename over | 0.8 (0.7–0.8) | 998.7 (998.3–998.8) | 999.2 (998.5–999.3) |
| append | 0.8 (0.8–0.9) | 999.2 (999.1–999.8) | 999.4 (998.9–1,000.3) |
| delete | 0.6 (0.6–0.6) | 999.1 (998.7–999.7) | 999.3 (998.9–999.7) |

## Answers

1. **Through two slots, a change shows through the read-only entry as it
   does through two entries of one slot:** new files, rewrites, new
   subdirectories and a listing read just before in about 1 ms; renames,
   appends and deletes about 1 s late, every round. Nothing never showed.
2. **The 1 s lag comes from two entries, not two slots.** One entry bound
   twice (A, the control) showed every change in under 1 ms, renames,
   appends and deletes included. The same directory as two entries of one
   share (B) lagged as two slots did (C). So the guest keeps each entry's
   names and sizes apart, as S178 read it, and holds them about 1 s; a
   second slot adds nothing to it.
3. **Nothing through the read-write entry was refused**, in any layout.
   The Mac saw the new files at once, and the guest the Mac's.
4. **A read-only entry still refuses writes** beside a read-write entry of
   the same directory, in its own slot or another: "Operation not
   permitted", from the Mac's side, with no `:ro` on the bind. Both runs
   found it.
5. **Filling the second slot left the container bound to the first
   working**: it read the directory after the fill, and then the file the
   two-slot container wrote.
6. **The guest's kernel logged nothing** but FUSE's start.

## What this means

- **Kill criterion: not met.** A host can put a directory its slot holds
  read-only into an extra slot read-write, when accepted work wants it so.
  Lanes made from then on bind it read-write from there; lanes made before
  read it through the read-only entry, a rename, append or delete up to
  1 s late, until their next start binds them to the read-write one.
- **This is not S141's case.** There both slots were written; here only
  one is, and the other refuses writes.
- **The lag is the price of any directory seen through two entries**,
  which today's layout already pays for a shared directory inside the
  working copy (S178).
