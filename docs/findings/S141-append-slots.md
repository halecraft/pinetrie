# S141 — Lanes appending to one file through one slot keep every line; the Mac and a lane appending at once lose most of the Mac's; two slots lose both and refuse creates

- **Status:** Answered
- **Led to:** ADR-0116, ADR-0118

Follows S140.

**Question.** S140 had two containers append to one Mac file at once, each
through its own slot of the lane VM, and the file kept 15 of one's 20
lines, with one line torn. It had no control, so it did not show whether
two slots cause it. Lanes of one host share a slot, and append to the same
files in a shared directory (`.plans`, ADR-0035) or a live source
(ADR-0118); you append on the Mac to what a lane appends to. When two
writers append to one file at once, are all their lines kept:
1. two processes in one container, on one bind (the baseline);
2. two containers on one slot;
3. the Mac and a container on one slot;
4. two containers on two slots (S140's case)?

Each with a `>>` per line, as a tool's write is, and with one descriptor
held open for appending, as S140's writers had.

**Kill criterion.** Case 2 or 3 loses or tears a line. Then a shared
directory or a live source is unsafe for two writers appending to one file
today, and ADR-0118 must say what a live source promises. The probe tells
nothing unless case 4 loses lines in at least one of its modes; case 1
losing them would put the fault in the guest, not the shares.

**Throw away.** The probe's folder (`s141-append-slots/` in the shared
plans folder): its script and its results. It builds S131's launcher and
copies S131's kernel and first stage, and uses S128's system image; its
data disk and test folder are deleted when it ends.

## How to run it

On the Mac, in pine·trie's repo: `bash .plans/s141-append-slots/run.sh`.
About two minutes. It needs what S140 did. The VM boots with 2 slots, both
holding one Mac directory, filled before any container starts, so nothing
is replaced under one. Each case runs three rounds; in each, two writers
append 100 numbered lines each, one every 20 ms, to one fresh file. The Mac
then counts each writer's whole lines, and the lines that are neither
writer's whole line (torn).

The writer and count logic was checked in a lane, with Docker stood in by
a shell, before the run: two writers of 20 lines each kept 40, and a file
with a torn line was flagged.

## How it ran

Duane ran it once on the Mac (Apple M3 Max, macOS 26.7.1, docker CLI
29.8.1), on 2026-10-08, with the pine·trie host and its lane VM running
beside the probe's VM. Each figure is one writer's whole lines kept of
100.

| case | open: round 1, 2, 3 | held: round 1, 2, 3 |
|---|---|---|
| 1. two processes, one container | 100/100 each round | 100/100 each round |
| 2. two containers, one slot | 100/100 each round | 100/100 each round |
| 3. the Mac and a container, one slot | Mac 18, 17, 19; container 100 | Mac 18, 20, 11; container 100 |
| 4. two containers, two slots | 49/51 (1 torn), 24/44 (7 torn), 31/70 | 0/100, 0/100, 0/43 (16 torn) |

In case 4, the slot 0 container's first append failed with "sh: can't
create /w/two-slots-open-1.txt: nonexistent directory", and again in two
held rounds: the file had just been created through slot 1, in a directory
both slots share.

## Answers

1. **The probe can tell:** the control, case 4, lost lines in every round
   of both modes, and the baseline, case 1, kept every line.
2. **Lanes of one host appending to one file keep every line** (case 2),
   either way they write it. A slot is one FUSE session in the guest, so
   the guest's kernel orders their appends, as it does within one
   container.
3. **The Mac and a lane appending to one file at once lose most of the
   Mac's lines** (case 3): 11 to 20 of 100 kept, in every round of both
   modes. The lane's lines were all kept, and no line was torn: the lane's
   appends land over the Mac's. A likely reading, not measured: the guest
   appends at the file's end as its FUSE session last knew it, and the
   Mac's appends between are written over. S140's reads were fresh within
   33 ms, so the guest learns of the Mac's writes; it does not learn of
   them before each append.
4. **Two slots sharing one directory are worse than S140 found** (case 4):
   both writers lose lines, lines tear, and a file just created through
   one slot can be refused as "nonexistent directory" through the other.

## What this means

- **Kill criterion:** met, by case 3, not case 2.
- **The Mac's side and a lane writing one file at once is unsafe today**,
  in every shared directory (ADR-0035), on the Mac only: on Linux a lane's
  bind is the host's own file system. It costs the Mac's appends; whole-file
  writes, an editor's save or the agent's edit, are last-write-wins on any
  file system, and S140 read them fresh.
- **Lanes of one host may append to one shared file**, on one slot.
- **One directory is never shared through two slots of the lane VM.** This
  confirms S140's choice, and adds a reason: creates fail across them.
- **ADR-0118's live sources promise** what case 2 and case 3 show: lanes'
  writes to one file are kept; a file appended to from the Mac while a lane
  appends to it is not.
