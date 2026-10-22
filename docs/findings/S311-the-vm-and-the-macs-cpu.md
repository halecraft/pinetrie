# S311 — macOS already runs the lane VM's CPUs after the Mac's own work; lowering its priority changes nothing, and a `renice` cannot be undone

- **Status:** Answered
- **Led to:** ADR-0210

**Question.** On 2026-10-21 the lane VM's process used 522% CPU while the
Mac felt slow and `jj op log` took 9.3 s. Does a busy VM take CPU from
the Mac's own work? Would running its process in the background
(`taskpolicy -b -p`) or at a lower priority (`renice`) give it back?

**Kill criterion.** Worth doing if a fixed Mac workload finishes faster
with the busy VM deprioritized than with it busy at its default.

**Throw away.** The spike VM. Kept in
`docs/findings/S311-the-vm-and-the-macs-cpu/`: `mac-work.mjs`, a fixed
workload (16 threads, each 1.5 M SHA-256 rounds); `rounds.txt`, three
interleaved rounds; `cpu-share.txt`, the VM's CPU with and without the
workload.

## Answers

Run on 2026-10-21 on the Mac (M3 Max: 12 performance cores, 4 efficiency)
with the spike VM at 16 CPUs, each spinning a shell loop when busy.

1. **The busy VM takes nothing from the Mac's work.** Over three
   interleaved rounds the workload took 4.42–4.52 s with the VM idle, busy,
   or busy under `taskpolicy -b`, and 4.44 s under `renice 20`.
2. **macOS already ranks it below:** busy, the VM's process ran at
   180–196% alone, and at 0% while the workload ran, at its default
   priority and under `taskpolicy -b` alike.
3. **`renice` is one way:** the user may lower the process's priority but
   not raise it back (`renice 0` refused), so a host could never undo it.
   `taskpolicy -B` undoes `-b`.

So CPU was not how the VM slowed the Mac on 2026-10-21: its memory
(S310) and its disk traffic under thrash (S309) are left. A first pair of
runs, before the VM had been reniced, took 32 s and 20 s, with the Mac's
load average high from work of its own; the rounds above were taken
after, at load averages of 20 to 35, and do not reproduce it.
