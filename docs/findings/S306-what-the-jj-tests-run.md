# S306 — the jj tests check jj's own answers; their cost is a repeated oracle and rebuilt rigs

- **Status:** Answered
- **Led to:** ADR-0207

**Question.** `packages/jj/repo.test.ts` runs about 4,050 jj and git
processes, and bounds the unit suite's wall time (S305). Only
`packages/jj`'s tests and the host's jj adapter start jj, so the shell
already has a boundary. Why then do its tests run so many, and could
most of what they check be proven without real jj?

1. Classify each of the file's 42 tests' assertions as jj's own behaviour,
   which only real jj can answer, or a decision over facts, which a pure
   test of a planner can prove with facts as values.
2. Count each operation's jj processes. Which repeated reads could be one
   `jj log`, as S253 did for refresh, and would that pay in the product?
3. Could stories that share a prefix start from a copy of a repo state
   made once?

**Kill criterion.** Most assertions are decisions over facts, so the work
is moving them to pure tests rather than making the real-jj tests cheaper.

**Throw away.** The stack log in `packages/lanes/run.ts`, the copied-rig
and fewer-`agrees` edits to `repo.test.ts`: each was applied for one run
and reverted in the same command. The scripts are kept beside this file,
since the plan builds on them.

## Answers

Measured in a lane (Linux, 16 cores, jj 0.45.1) on 2026-10-21, while other
lanes ran on the same machine: wall times varied by 2× between runs, so
the measures here are process counts, which did not vary.

1. **No assertion is a decision over facts alone.** Every one reads what
   jj made or answers. The planners were already moved out: `plan.test.ts`,
   `proposed-steps.test.ts`, `lane/plan.test.ts`, `lane-read.test.ts`
   (rows as values) and `@pinetrie/rules` test the decisions with facts as
   values.

   | tests | what their assertions check |
   |---|---|
   | the whole life of a lane; an agent's commit (jj, git); an update end to end; an adopted commit; a base after your `@-` is rewritten (6) | jj's merges and conflicts, immutability under the lane's config, bundles fetched by id, `divergent()`, forks of a copied directory |
   | a review reads proposed changes' commit (1) | the reads' templates and filesets against jj: quoted names, renames, a directory's name, an image's bytes |
   | proposed changes built, squashed, after a catch-up, a conflicted branch (4) | immutability and `--ignore-immutable`, rebases, divergence and its repair, a conflict carried by a copy |
   | the host's version of proposed changes (8) | the evolog and its walk, the op log cut and collected, tracked remote bookmarks, a forget |
   | publish (5) | `acceptedFacts`' counts, rebases as you, one operation moving two bookmarks, git's `main` |
   | the refresh's budget (1) | processes counted, in kind and number |
   | the start, untraced or known; a lane's work undone; `filesTouched` over a range (3) | the trailer revsets against `hasTrailer`, a range jj diffs as one, a range jj refuses |
   | catching up past an accepted thread commit (8) | merges after joins, forecasts against the merges they forecast |
   | a thread on a WIP (1) | a WIP's copy, its acceptance into the WIP, the WIP's bookmark gone |
   | pre-rename disks and lanes (4) | old names and folders renamed on a real disk, `Pineta-*` trailers read |

   So the premise does not hold here: the boundary is already where it
   should be, and this file is the shell's own test. Its cost is in how
   often it asks jj, not in which layer asks.

2. **Where the 4,051 processes go** (`attribute.py`, over each process's
   stack as `stack-log.patch.py` logged it):
   - **The oracle, `agrees()`: 891 (22%).** It reads a lane both ways, the
     one read (`gatherLane`) and each separate read, and expects the same
     values. `proposed()` and `accept()` call it after every build and
     every acceptance, so a story runs it at each step, about 60 times in
     the file, at about 15 processes each.
   - **Rigs rebuilt: 1,015 (25%).** `turnRig` (26 tests, 22 processes
     each) and `acceptedProposedRig` (5 tests, 81 each, two `agrees` among
     them) build the same state from `jj git init` in every test, differing
     only in their directories' names.
   - **The operations themselves:** per call, `acceptedFacts` 14,
     `mergeUpdate` 11 to 13, the fixture's `buildProposedChanges` 10.6,
     `gatherLane` 8.8 (with `known: null`, so it diffs for getting the
     latest each time), `startOfProposed` 3.7, `laneBase` 3.3,
     `commitTurn` 2 (`util snapshot`, then one `log`). The repeated reads
     S305 named, `present("pinetrie-accepted")` (161) and a lane's tip
     (144), are the tests' own `acceptedNow()` and the oracle's reads,
     not one operation's.
   - **Only `acceptedFacts` pays to batch in the product.** The host reads
     it once per operation in your repo: after every jj command you run
     and every write of the host's. Steady, with `w` WIPs, it runs
     11 + 2w processes: the accepted commit, two `config get`s, the WIPs'
     list, two counts per WIP, `behind`, the publish bookmark and its two
     counts, `ahead`, the conflicted commits' count and `@`'s conflicted
     files. Every count is a `jj log` whose rows are counted, and these are
     the reads `shared.ts` and `lane-read.ts` already make as one `jj log`,
     each row tagged with the revsets that hold it
     (`self.contained_in`). At about 9 ms here and 20 ms on the Mac, that
     is 100 to 300 ms per operation, against two or three processes.
     `mergeUpdate` is mostly writes (`new`, `commit`, `bookmark set`), run
     in a lane on a catch-up; `gatherLane` is batched already; a turn's
     two are a snapshot and a read.
   - **`latestPreview` lists your whole common history to test it is not
     empty**: `(::@ & ::accepted) ~ root()`, counted. On this repo's 571
     commits, 15 to 20 ms against 8 to 9 ms for `-n 1` of the same revset.
     It grows with the history, and it runs whenever `@-` is behind.

3. **A copied rig works, and saves 18%.** `copied-rig.patch.py` builds
   `turnRig` once per file, as `template`, and each test copies its two
   directories (`cp` with `verbatimSymlinks`, as a fork copies a lane) and
   builds its closures over the copies. All 42 tests passed, at 3,088 jj
   and 250 git processes against 3,677 and 374. Nothing in either
   directory names its own path: the steps name your repo by
   `/mnt/host-working-copy`, mapped when they run, and the product itself
   forks a lane by copying its directory.

4. **The oracle at the steps a test names keeps every mutation killed.**
   Without `agrees()` inside `proposed()` and `accept()`, leaving the 17
   explicit calls and `forecast()`'s, `kill-probe.ts` ran each of the 25
   mutations of the read code (`lane-read.ts`, `proposed.ts`, `shared.ts`,
   `get-latest.ts`, `proposed-gather.ts`, `accepted.ts`,
   `core/trailers.ts`) whose `expect` is a test in this file, narrowed to
   that test. The results were the same with and without: 24 killed, and
   one that ran no test, since its `expect` names a test in another file.
   The file then ran 3,008 jj and 374 git processes, against 3,677 and
   374.

**Together** the two changes would bring the file from about 4,050
processes to about 2,650, and the split the plan makes then runs it on
four workers.

**Sources**, in the folder beside this file: `stack-log.patch.py` (the
stack log), `attribute.py` (each process to its test, its operation and
the oracle), `copied-rig.patch.py` (the copied rig) and `kill-probe.ts`
(each mutation of the read code against its expected test, narrowed).
