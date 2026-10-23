# S309 — Lanes that want more memory than the VM has thrash whatever the kernel's settings; zram and `madvise` huge pages make it worse, and running half the lanes does 24 times the file work with no stalls

- **Status:** Answered
- **Led to:** ADR-0210, ADR-0212

**Question.** On 2026-10-21 the lane VM (12 GiB, 16 CPUs, 27 h up) ran
four lanes of 4 GiB each (`LANE_MEMORY`) beside the observer and lanehost.
It had refaulted 2.5 billion file pages, failed 98% of 897,540 compactions,
fallen back from 3.9 M of 4.1 M huge-page faults, and logged six
`khugepaged` soft lockups of 22 s. Transparent huge pages were `always`
(the kernel's default, `CONFIG_TRANSPARENT_HUGEPAGE_ALWAYS=y`), with no
swap. Would the kernel's settings fix it: huge pages `madvise` with
`khugepaged` not defragmenting, zram swap, a `memory.high` per lane? Or is
the fix to run no more lanes than fit?

**Kill criterion.** The settings are worth adopting if, on the same load,
they cut the time every task stalls on memory (PSI `full`) and keep the
work done. Admitting fewer lanes is worth it if the lanes that run do at
least the work the overcommitted four did, in the same time.

**Throw away.** The spike VM. Kept in
`docs/findings/S309-lanes-beyond-the-vms-memory/`:
- `Dockerfile`, `lane.sh`: one lane's load, an anonymous working set kept
  hot by `stress-ng --vm --vm-keep` and a file working set read over and
  over;
- `run.sh`: one configuration on a freshly booted spike VM (S308's
  harness), four lanes (`LANES` to change), `/proc/vmstat` and PSI before
  and after, OOM kills, soft lockups;
- `A-current.txt`, `B-tuned.txt`, `C-tuned-high.txt`, `D-two-lanes.txt`:
  each run's output.

## Answers

Run on 2026-10-21 in the spike VM (8 GiB, 8 CPUs, `psi=1`), each
configuration on a fresh boot, 240 s. Each lane: `--memory 4g`, 1500 MiB
anonymous and 1500 MiB of files, so four want 12 GiB of 8.

| | A: as the lane VM is | B: `madvise`, no defrag, 4 GiB zram | C: B, `memory.high` 1800M | D: as A, two lanes |
|---|---|---|---|---|
| anonymous work (bogo ops, all lanes) | 143.3 M | 79.1 M | 101.9 M | 86.9 M |
| file passes (all lanes) | 1,967 | 8,002 | 2,646 | 47,984 |
| PSI memory `full`, total | 24.4 s | 67.2 s | 43.7 s | 0 s |
| direct-reclaim stalls | 181 k | 1,167 k | 144 k | 0 |
| file refaults | 584 M | 316 M | 443 M | 0 |
| pages swapped in | 0 | 36.6 M | 32.5 M | 0 |
| compaction stalls | 10 | 263 | 28 | 0 |
| OOM kills, soft lockups | 0, 0 | 0, 0 | 0, 0 | 0, 0 |

1. **No setting makes 12 GiB fit in 8.** zram (B) swaps out anonymous
   memory that is in use and swaps it straight back: PSI `full` rose 2.8
   times and the anonymous work fell 45%. B's file passes rose, but
   unevenly: one lane did 4,729 of 8,002. A `memory.high` that holds
   each lane to its share (C) cut reclaim stalls below A's, but still
   stalled 1.8 times as long, and did less work.
2. **Running two lanes, not four (D), did 24 times the file work and 61%
   of the anonymous work, with no stall, refault, or reclaim at all.** The
   anonymous work is bound by CPU, which two lanes used less of; the file
   work is bound by memory. Two lanes queued behind them would run next:
   in 480 s the four would do more of both than A did.
3. **Not reproduced: the long-run fragmentation.** In 240 s, A compacted
   10 times and locked up nowhere; the incident's compaction failures and
   `khugepaged` lockups came after 27 hours. Huge pages `madvise` keeps
   `khugepaged` from collapsing every anonymous region; whether that
   prevents the lockups is not measured here.
