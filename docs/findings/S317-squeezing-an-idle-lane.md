# S317 — Reclaiming an idle lane's cache through its cgroup frees it in about two seconds, slows its next command by 2–4%, and leaves a busy lane beside it alone

- **Status:** Answered
- **Led to:** ADR-0210, ADR-0212

**Question.** The first step of the pressure ladder (ADR-0210) takes the
cache idle lanes hold (S316) before anything has to wait. cgroup v2's
`memory.reclaim` asks the kernel to reclaim a number of bytes from one
cgroup. How much does it free from an idle lane, how long does it take,
what does it cost that lane's next command, and does a busy lane beside it
slow?

**Kill criterion.** Not worth doing if the squeezed lane's next command
slows by more than a quarter, or a busy lane beside it by more than a
tenth.

**Throw away.** The spike VM and its two lanes (S316's container, and one
started from it with the same files). Kept in
`docs/findings/S317-squeezing-an-idle-lane/`: `next-command.txt`, three
rounds of a typecheck before and after a squeeze, with the cgroup's
refaults; `beside-a-busy-lane.txt`, three rounds of a busy lane's
typecheck alone and during a squeeze of the other.

## Answers

Run on 2026-10-21 in the spike VM; the squeeze is `echo 2G >
/sys/fs/cgroup/docker/<id>/memory.reclaim` from the VM's root, which ends
with "Resource temporarily unavailable" when it frees less than asked.

1. **It frees all of an idle lane's cache:** 719 MiB to 20 MiB in 2.3 s,
   timed from the Mac, the first time; 180 MiB to 22 MiB later.
2. **The squeezed lane's next `tsc --noEmit` took 2–4% longer** (1,670 ms
   against 1,629; 1,696 against 1,672; 1,728 against 1,667), refaulting
   13,500 pages, about 53 MiB, each time.
3. **A busy lane's `tsc` during the squeeze took 1.5–6% longer** (1,655 ms
   against 1,631; 1,703 against 1,649; 1,672 against 1,578).

A caution for every timing in these spikes: the VM's CPUs run after the
Mac's own work (S311). While the Mac decoded video and ran a browser, the
same typecheck took 28 to 45 s, and S309's load did a thirtieth of its
earlier work. Only runs taken side by side, interleaved, compare; these
were.
