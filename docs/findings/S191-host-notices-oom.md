# S191 — The host holds every file open of a tool call's runs until the turn ends, about 500 bytes each: `pnpm mutate` grows its heap 4.7 MB/s, 3.4 GB in the 12 minutes the call ran before the host died

- **Status:** Answered
- **Led to:** ADR-0145

Follows S179.

**Question.** On 2026-10-13 the Mac's host died at its 4 GB heap limit
(`Ineffective mark-compacts near heap limit`). Its full collections freed
3 MB of 4,087 MB: the memory was held, not garbage. It died about 12 minutes
into one `bash` call in brave-llama's thread
(`t-01a13819-da1e-747f-9899-2394e27c16b9`). That call ran
`pnpm mutate scripts/mutations/jj.ts <name>` for each of 47 mutations, one
after another; 15 had finished. Read from the host's database, a copy:
the call was written at 21:20:35; the call before it, also a loop of
`pnpm mutate`, had ended at 21:20:28; and its root's 17,953 uncompacted
ops are 15 MB, which the documents' in-memory log cannot make 4 GB.

The belief, read from source, not run:
- The observer reports every file open of a tagged run, not only writes.
  This includes a lookup that finds nothing, and each written file's
  release (`packages/lanehost/observer/observe.bpf.c`:
  `security_file_open`, `do_filp_open`'s return).
- The host gathers each notice into its lane's `notices` array
  (`packages/lanehost/observer-client.ts`). The array has no bound, and
  only `flush` empties it. A flush comes only at the turn's end
  (`classifyWritesOnQueue` → `drainLaneRuns`), after the tool call
  returns.
- A notice held this way is about 340 bytes of heap, measured with
  `JSON.parse` of a made-up notice, so about 12 M of them fill 4 GB. At
  12 minutes that is about 16,000 notices a second.

So:
1. During one tool call, does the host's retained heap grow with the
   call's file opens? Is it released only once the turn ends?
2. What does one notice cost the host, end to end: kernel, role, wire,
   decode and held?
3. At what rate does the incident's workload, `pnpm mutate` on `jj.ts`,
   grow the heap? Does that rate reach 4 GB in about 12 minutes?

**Kill criterion.** The belief is wrong if any of these holds:
- a call of 1 M opens grows the host's retained heap by less than 100 MB;
- what it grows is not released at the turn's end;
- the incident's workload grows the heap by less than 1 GB in 12 minutes,
  extrapolated from its measured rate.

Then the incident has another cause, and this spike says what the probe
saw instead.

**Throw away.** The section host's project and lanes (the probe's
`close` removes them). Kept in `docs/findings/S191-host-notices-oom/`:
- `probe.ts`: a host with lanes, in the probe's own process, against the
  lane VM and the real machine role. Its scripted model makes four
  `bash` calls in one thread:
  - `sleep 30`, the baseline;
  - a calibration call: 1,000 files written, then read 1,000 times
    over by one `cat` each round;
  - `pnpm install --frozen-lockfile`;
  - `pnpm mutate scripts/mutations/repo.ts` for three of the incident's
    mutations, as its loop ran them. Its `jj.ts` was brave-llama's work
    in progress; the same mutations are in `repo.ts` here.

  The project is pine·trie's tracked files at this repo's `@`
  (`jj file list` through `tar`), committed afresh in a colocated repo
  of its own. A jj workspace cannot be one: the host needs a git
  directory beside the jj repo (`prepareProjectDir`,
  `packages/lanes/host.ts`).

  Every second, after a forced collection, it samples the host's
  `heapUsed`, and whether a tool's stream is open;
- `samples.jsonl`: those samples, with each host log line timestamped
  beside them.

## Answers

Measured on 2026-10-13 on the Mac (Apple M3 Max, Node 24.19), with the
lane VM and its machine role, by `probe.ts`. Its samples are in
`samples.jsonl`. Each figure is `heapUsed` after a forced collection: what
the host holds, not garbage.

| call | seconds | heap at its start | heap at its end | after its turn |
|---|---|---|---|---|
| `sleep 30` | 30 | 53 MB | 53 MB | 53 MB |
| calibration | 24 | 53 MB | 560 MB | 54 MB |
| `pnpm install` (from the store) | 6 | 55 MB | 128 MB | (next call) |
| three `pnpm mutate` | 125 | 63 MB | 630 MB | 55 MB |

1. **Yes, and the heap is released only once the turn ends.**
   - With nothing running, the heap stays flat: 53 MB through the
     baseline's 30 s.
   - During the calibration call and the mutate call it climbs steadily.
     Each call's growth is gone within a second of its turn's end (630 MB
     to 55 MB at 199 s). That is when `classifyWritesOnQueue` flushes the
     lane's notices and folds them.
   - Nothing else in the host held it: the turn's records are written,
     and the heap is back where the baseline left it.
2. **About 500 bytes a notice, end to end.**
   - The calibration made about 1,005,000 notices:
     - 1,000,000 read opens (1,000 rounds of 1,000 files);
     - 1,000 written files, each with its open and its release;
     - each round's `/dev/null`, and `cat`'s own loader opens.
   - It held 507 MB.
   - The made-up notice measured beforehand was 340 bytes. The difference
     is what comes on the real path: the role's wire and its decode.
   - Whether the observer lost any of the calibration's events, at about
     40,000 a second, was not read. A loss would make each notice cost
     more, not less.
3. **`pnpm mutate` grows the heap 4.66 MB/s, about 9,500 notices a
   second.**
   - Fitted over the call's 125 s; the samples are close to a straight
     line.
   - At that rate the incident's 12 minutes come to 3.4 GB, from the call
     alone, on a host that also held a session with many roots.
   - Each mutation took about 42 s here. The incident's 15 finished
     mutations in 12 minutes took about 48 s each.

**None of the kill criteria holds:**
- the calibration grew the heap by 507 MB, not under 100 MB;
- it was released at the turn's end;
- the mutate rate extrapolates to 3.4 GB, not under 1 GB.

**The cause of the incident is the host's unbounded `notices` array**
(`packages/lanehost/observer-client.ts`), held for one long tool call.
What is not known: the incident host's own heap before the call. The
3.4 GB fits only if it held 0.6 GB or more, which a full session's
documents in memory plausibly do.

**For a fix.** The host already folds these notices, but only at the
drain.
- **What the fold does.** `foldRunEvents` (`packages/rules/runs.ts`) keeps
  one trace per path, so a repeated read changes nothing. It also discards
  a path outside the lane's root.
- **Nothing folds earlier.** The kernel side, the loader and the role pass
  every event on.
- **When it runs.** `foldLaneDrain` runs only in `drainLaneRuns`, after the
  flush. Until then the raw notices wait in the array.
- **What the calibration's notices came to.** It read `/tmp`, outside
  `/workspace`, so the fold discards every one: the host held 507 MB of
  notices that come to nothing.

A fix can follow either way:
- **Fold in batches as notices arrive**, as `foldRunEvents` allows ("fold
  a batch at a time"). The drain still flushes first. A run folded before
  its drain names no command until `channel.runs()` gives one, and
  `foldLaneDrain` keeps an existing trace, so the drain must fill the
  command in.
- **Drop a path outside the lane's root in the role, or in the loader**,
  before it is sent to the host. The fold discards it anyway.

Two parts of the fold would still grow:
- `accesses` keeps every open and release under a shared directory;
- `moveUnder` scans every known path for each directory renamed.

Not measured: what share of `pnpm mutate`'s notices are outside
`/workspace`. Its jj tests' repositories, Node and its libraries all are.
