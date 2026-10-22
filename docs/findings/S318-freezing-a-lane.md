# S318 — A frozen lane's memory goes to zram only when reclaimed on purpose: then 1.6 GiB leaves in under a second, compressed 3.7 to 1, and comes back in about 2 s; with every running lane's swap held at 0, the kernel swaps none of theirs

- **Status:** Answered
- **Led to:** ADR-0210

**Question.** The ladder's fourth step (ADR-0210) freezes the least
important lanes mid-command when memory runs short. Freezing stops a lane
but frees none of its memory; zram could hold it compressed. But zram
made S309's overcommitted lanes do less, because the kernel swapped
memory they were using. So:

1. Does a frozen lane's memory go to zram when other lanes need room?
2. What does a lane's thaw cost?
3. Can zram be on without the kernel swapping running lanes' memory?

**Kill criterion.** Freezing is not worth it if a frozen lane's memory
cannot be moved out, or its thaw costs more than a few seconds per GiB;
zram is not safe if running lanes' memory can be swapped while it is on.

**Throw away.** The spike VM. Kept in
`docs/findings/S318-freezing-a-lane/`: `hold.js`, a process holding a
number of MiB in 4 KiB pages, a quarter random and three quarters text,
and touching every page in timed passes; `zram.txt`, a freeze under
pressure; `freeze-reclaim.txt`, a freeze with a reclaim of the frozen
lane; `swap-max.txt`, the reclaim with the lane's swap at 0 and at max;
`E-zram-swappiness-1.txt`, S309's load with zram and `vm.swappiness` 1,
which did not compare (below).

## Answers

Run on 2026-10-21 in the spike VM, zram 4 GiB with lz4. A lane is frozen
by writing 1 to its cgroup's `cgroup.freeze` (Docker's `pause` does the
same; Docker then refuses `exec` into it).

1. **Freezing alone does not move a lane's memory out.** A frozen lane
   holding 1,680 MiB, then another wanting 5,800 MiB on the 8 GiB VM: the
   other got its memory (no OOM kill), zram took 968 MiB, and the frozen
   lane still held 1,542 MiB. The kernel swapped what was coldest
   anywhere, not the frozen lane.
2. **A reclaim of the frozen lane moves all of it:** `echo '2G
   swappiness=200' > memory.reclaim` took it from 1,663 MiB to 6 MiB in
   0.84 s, into 446 MiB of zram (1,654 MiB stored, 3.7 to 1).
3. **Its thaw costs about 2 s for 1.6 GiB:** its first two passes after
   the thaw took 1,310 ms and 620 ms, against a median of 6.7 ms; four
   seconds later it held 1,595 MiB again.
4. **A cgroup's `memory.swap.max` holds:** at 0, a reclaim asking for
   swap swapped nothing (1,111 MiB held, 0 swapped); at `max`, it swapped.
   Docker's warning at each `--memory`, "Your kernel does not support swap
   limit capabilities", is about its own flags: the kernel's files are
   there and work. So zram may be on with every running lane's swap at 0,
   and a lane's raised only once it is frozen: the kernel cannot then swap
   a running lane's memory, which is what made S309's zram worse.
5. **Not answered: zram with `vm.swappiness` 1 and no swap limits.** S309's
   load with it did 41.8 M operations and stalled 97.7 s; the baseline,
   rerun minutes later, did 4.3 M and stalled 174 s, against 143.3 M and
   24.4 s hours before. The Mac was busy, and the VM runs after it (S311).
   Item 4 makes the question moot.
