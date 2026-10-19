# S253 — can every lane's refresh after an acceptance cost a fixed number of jj processes?

- **Status:** Answered
- **Led to:** ADR-0181

**Question.** An acceptance moves accepted work, and `planMarks` then
queues a refresh for every named lane whose thread is not archived. The
owner runs them one after another (`packages/jj/owner.ts`). A lane shows
**catch up** only once its own refresh has written its base record's
catch-up read (`catchUpNow`, `packages/rules/base.ts`). Duane's host log
after one acceptance showed 17 refreshes of 1.1-2.3 s each. Waits grew by
the run before them, up to 45.9 s, and the one slow command logged was a
lane read (`gatherLane`'s `jj log`) of 552 ms.

1. Where does one refresh's time go: how many jj processes, what each
   costs, and how much is outside jj?
2. Can every lane's facts come from a fixed number of jj processes, rather
   than about four per lane, with the same facts `gatherRefresh` gives
   today? Three ways:
   - **one log**: every lane's `gatherLane` read in one `jj log`, each
     row tagged with the lanes whose revset holds it;
   - **shared diffs**: the catch-up diffs (`catchUpFiles`) that lanes
     from the same accepted commit share, run once;
   - **batched diffs**: `filesTouched` and the catch-up diffs as one
     `git diff-tree --stdin` over the colocated git repo, where jj's
     answer and git's are the same.
3. Failing that, can the reads run at once, pinned to one operation, with
   only the writes queued on the owner?

Measured on a copy of Duane's repo, taken after the acceptance, with each
lane's last catch-up read (`known`) set to none: what a refresh reads
after accepted work moves.

**Kill criterion.** A way is dropped if, for any lane, it gives facts that
differ from `gatherRefresh`'s. The spike fails if no way that gives the
same facts makes the fan-out for Duane's lanes at least 5× faster, in jj
processes or in wall time.

**Throw away.** The copy of the repo (`/tmp/s253/`). The probe stays in
`docs/findings/S253-every-lanes-refresh-after-an-acceptance/` if a plan
builds on it.

## Answers

Measured on Linux (jj 0.45.1, 16 cores), on a copy of Duane's repo taken
from his working copy on 2026-10-19, at one operation. There were 73 lanes,
11 of them with proposed changes, and 304 accepted thread commits. Every
lane's gather was `placed` on accepted work; none was on a WIP. "Facts"
means `gatherRefresh`'s result, compared lane by lane as JSON. Wall times
vary by about 20% between runs on this machine. The numbers below are from
one run (`output.txt`), and the repeat runs agreed.

1. **Every lane is refreshed, and most of them have nothing proposed.** All
   73 lanes are read after an acceptance, and 62 of them have no proposed
   changes. A lane with none runs 5 jj processes: the lane read, the start
   (`readStart`), `filesTouched`, and two catch-up diffs. A lane with
   proposed changes runs 2 to 9. In all, 386 processes take 16.3-17.0 s in
   series here. Duane's log lists only the refreshes over 1 s, mostly the
   lanes with proposed changes. The gaps between their waits are the
   other lanes, each under a second there.
2. **Most of the time goes to one revset: the accepted thread commits
   written out commit by commit.** The lane read carries all 304 accepted
   thread commits as `(present(c1) | … )`, 15,807 characters, and the
   read is 33,646 characters long. It takes 148 ms, where an empty
   `jj log` takes 13-15 ms. With that list replaced by the expression
   `readShared` reads it by (`::<accepted> & <ACCEPTED_THREAD_COMMITS>`,
   given as a revset alias), the same read takes 22 ms and prints the
   same bytes. With the list itself as an alias, it takes 51-60 ms. The
   start read holds a list of 8,891 characters and takes 38 ms, or 25 ms
   with that list as an alias. The cost is in jj's handling of the long
   inline union. Dropping the template's flag for it changes almost
   nothing (147 ms). I did not trace the cause in jj's source. The list
   grows with every acceptance, so this cost has grown with the repo too
   (inferred from its shape, not measured at other sizes).
   (`variants.mjs`, `variants-output.txt`)
3. **Each way, against today's 17.0 s in series**, all with the same facts
   for all 73 lanes:

   | way | jj processes | wall |
   |---|---|---|
   | today, in series | 386 | 17.0 s |
   | memo: one run per distinct command | 321 | 15.1 s |
   | alias: the long unions as aliases, in series | 386 | 7.6 s |
   | pinned reads, 4 / 8 / 16 at once | 386 | 4.1 / 2.4 / 2.1 s |
   | alias, 4 / 8 / 16 at once | 386 | 2.0 / 1.3 / 1.1 s |
   | one log for every lane read, then alias, in series | 314 | 6.9 s |
   | one log, then alias, 4 / 8 at once | 314 | 2.7 / 2.0 s |

   The kill criterion's 5× is met by alias with 4 reads at once (8.4×)
   and alias with 8 (13×). The alias on its own is 2.2×.
4. **One log for every lane's read works, but it is not where the time
   goes.** Every lane's revset and template as aliases in a config file,
   with each row tagged by its lane (`if(self.contained_in("l<i>"),
   "<i>:" ++ t<i>)`), takes 0.42-0.52 s for all 73 lanes and gives the
   same facts. The separate aliased lane reads take about 1.6 s in all. With the
   list written out it took 56 s. The first attempt as one argument
   failed with `E2BIG`, since Linux caps a single argument at 128 KiB,
   so a single read needs a config file (or `--config` aliases). What
   remains after it is three or four small reads per lane (the start,
   `filesTouched` and the catch-up diffs), at about 15-23 ms each, which is
   jj's start-up cost.
5. **Sharing the catch-up diffs between lanes saves little.** Of the 386
   commands, 321 are distinct. Lanes from the same accepted commit
   share a diff, but each lane's diff from its own tip is its own.
6. **git's diffs are not jj's, so batching them through git is dropped.**
   `git diff-tree --stdin` answers all 152 distinct diffs in 72 ms
   (about 4.5 s through jj), but 40 of the 152 list different paths.
   Without rename detection, git lists a renamed file's old path too,
   where `jj diff` lists only the new one
   (the walking skeleton's report, moved to
   `docs/findings/archive/WS1-walking-skeleton.md`, was among the extra
   paths). With `-M`, git pairs renames differently from
   jj, and 71 of the 152 differ.
7. **Reads pinned to one operation give the same facts when run at once.**
   They write nothing (`runnerFor`'s `{ at }`), so 16 at once agreed with
   the serial run for all 73 lanes. This spike did not measure what the
   host would do between reading and writing. A refresh that reads off
   the owner and then writes on it needs the head it read at to be the
   head when it writes, or it reads again.

## On the Mac

The same probe, on 2026-10-18, on Duane's Mac (jj 0.45.1), over his live
repo with every read pinned, with no copy (`mac-output.txt`). There were
73 lanes, 9 with proposed changes, and 372 jj processes.

8. **jj costs on the Mac what it costs on Linux.** An empty `jj log` took
   15.6 ms, and the lane reads and start reads 78 ms on average, against 84
   ms on Linux. The 552 ms read in Duane's log is not what that read costs
   there.
9. **The ways scale there as here,** with the same facts for all 73
   lanes:

   | way | wall |
   |---|---|
   | today, in series | 15.3 s |
   | alias, in series | 6.5 s |
   | pinned reads, 4 / 8 / 16 at once | 3.9 / 2.0 / 1.5 s |
   | alias, 4 / 8 / 16 at once | 1.7 / 0.97 / 0.68 s |

   Alias with four at once is 8.8×, and with eight 15.7×.
10. **Most of a refresh's time in the host is not its gather.** The
    refreshes in Duane's log ran 1.1-2.3 s. The same lanes' gathers took
    141-326 ms on the Mac: a fourth to a sixteenth of that. A lane with
    nothing proposed gathered in 179-219 ms, where the log has its refresh
    at 1.2-1.6 s. The log's waits point the same way: 45.9 s for the 73
    lanes is about 0.6 s a lane, against 0.21 s for a gather on average.
    The probe read the shared facts once for every lane. The host read
    them, accepted work's record's facts among them, at every new operation,
    and twice in a refresh that wrote. It also read the record back after a
    write by ten reads. S254, run beside this spike, counted 13 to 60 jj
    processes a refresh, where the gather is 2 to 9: the other ~1 s is jj,
    at about 20 ms a process. Accepted work now reads them apart, and a
    rebase after an acceptance runs 13 (S254, item 7).

**Not measured here.**
- The host's refreshes since S254's change: the slow-step line now says
  where a refresh's time went (`slowStepLine`), so the next host log
  answers it.
- Lanes on a WIP: this repo had none.

**What this means for the design.**
- The cheapest change, with no change to the owner: in `gatherLane` and
  the start read, name the accepted thread commits by their revset, or
  by one alias, instead of listing them. This is 2.2× on its own, and
  keeps today's facts. Whether the expression gives the same set as the
  shared facts' list in every case (an acceptance into a WIP, S81) needs
  `repo.test.ts`'s histories. Here it did for all 73 lanes.
- The rest of the 5× comes from reading lanes at once, pinned to one
  operation, with only writes on the owner. Four at a time gives most of
  it.
- One log for every lane can come after those. It saves about another
  second here, at the price of tagging every row by lane, and S100's
  WIP questions still apply to it.

**Sources** (`docs/findings/S253-every-lanes-refresh-after-an-acceptance/`):
`probe.ts` runs every lane's `gatherRefresh` over a copy of your repo,
for each way (`node probe.ts <repo> parallel memo alias onelog git`), and
writes `output.txt`. Its `dump` way writes two lanes' reads to
`/tmp/s253/reads.json`, which `variants.mjs` times variant by variant
(`variants-output.txt`). Repo copied with `cp -a` of `.jj` and `.git`
from `/mnt/host-working-copy`, then the operation heads again and
`cp -an` for what the host wrote during the copy. On the Mac, the same
`probe.ts`, its imports pointed one level up, ran from your working copy
over the live repo (`node probe.ts <repo> parallel alias`), and wrote
`mac-output.txt`.
