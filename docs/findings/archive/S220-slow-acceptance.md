# S220 — an acceptance's 18 s is the host's event loop, not jj: jj ran each command in milliseconds, and the host heard of it seconds later

- **Status:** Answered

Run in a lane (Linux, jj 0.45.1, Node 24.21) on a copy of Duane's repo,
and from his op log; the probes were not committed.

## Brief

**Question.** Duane's host log showed an acceptance's step run 17.9 s,
each of its jj commands about 2.8 s (`jj log` reads, `jj bookmark forget`),
and a lanehost `disks read` 2.9 s. Is jj slow on this repo, and if so, on
what?

**Kill criterion.** If the same commands take seconds on a copy of the
repo, jj is the cause, and the repo's size is to be cut.

**Throw away.** The repo's copy (`/root/probe`).

## Answers

1. **jj is fast on this repo.** On a Linux copy of `.jj` and `.git`, the
   host's commands from that acceptance ran in milliseconds, with the
   repo's `immutable_heads()` and `revsets.log` as the host sets them or
   without:

   | command | the copy | Duane's host log |
   |---|---|---|
   | `jj log -r <commit> -T description` | 10-15 ms | 2873 ms |
   | `jj log -r change_id(…)` | 14 ms | 2857 ms |
   | `jj log -r present(bookmarks(exact:…))` | 11 ms | 2834 ms |
   | `jj bookmark forget --include-remotes …` | 194 ms | 2747 ms |

   The repo jj loads is small: 77 heads, 3,620 visible commits. S215 item
   9 measured such reads on an APFS copy at 20-53 ms.
2. **jj had finished seconds before the host heard.** An acceptance moves
   accepted work's bookmark, then forgets the proposed changes' bookmark,
   with nothing between them (`planAcceptanceSteps`). In the op log, the
   move ran 04:01:53.634-.659, and the forget began 65 ms later, at .724,
   and ended at .990. The host timed the forget at 2747 ms: about 2.4 s
   after jj was done. The forget ran 194 ms on the copy, and its
   transaction 179 ms of it, so jj does nothing slow after its
   transaction. Another acceptance (09:53, `sleek-valley`) has 7.5 s
   between the move's end and the forget's start, with jj idle.
3. **Most of the host's commands do not stall.** Over the op log's 8 days,
   a rebuild's `restore` to its `describe` took 45-50 ms at the median and
   under 0.4 s at the 99th percentile on all but two days. So the host's
   loop stalls now and then, for seconds, and whatever it awaits through
   a stall reads that long: a jj command, or a lanehost call, which the
   host also times on its side (`packages/lanehost/client.ts`).
4. **jj's own costs that grow are small.** The forget's transaction grew
   from 12 ms to about 260 ms in a day, as `refs/jj/keep` reached 17,115
   (a guess at the cause: jj rewriting git's `packed-refs`, not measured).
   `.jj/repo/op_store` is 1.3 GB: 24,554 operations in the log, about
   3,000 a day, and about 51,000 more left by the 10-09 tidy, which jj's
   gc keeps until they are two weeks old (S215 item 15).
5. **Node's delay histogram drops the sample after a reset**
   (`monitorEventLoopDelay`, resolution 20 ms). A 1.5 s block 50 ms after
   `reset()` read as a max of 1525 ms; the same block right after
   `reset()` read as 25 ms. A sample is the time since the last one,
   resolution included (an idle loop's minimum was 20.2 ms), and a reset
   forgets the last one.

## What it points to

- **The host logs its event loop's stalls** (`apps/pinetrie/host/stalls.ts`),
  so a slow command's line can be told from a stalled host; it resets the
  histogram only after a stall it logged (item 5).
- **What stalls the loop is not known.** A CPU profile of the host
  (`--cpu-prof`) through an acceptance would name it.
