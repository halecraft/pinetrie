# S305 — where the tests spend their time, and what each lever would save

- **Status:** Answered
- **Led to:** ADR-0207

**Question.** `pnpm run verify` and a mutation batch have grown slow. S94
measured the suites when they became scenarios; nothing has measured them
since, nor the unit layer, nor a batch of mutations. Where does each gate's
time go, and which changes would shorten it without weakening what any
check proves?

1. What does each gate take, and what bounds its wall time?
2. What bounds the unit suite: its slowest file, the CPU, or Vitest itself?
3. What does a mutant cost, unit and suite, and what would narrowing a unit
   mutant to its expected test save?
4. Can a suite's scenarios run at once, each in its own process, and what
   breaks when they do?

**Kill criterion.** None of the levers saves a third of any gate's time, or
each one that does weakens a check.

**Throw away.** The timing runs and the simulated split of
`packages/jj/repo.test.ts`. The probe scripts are kept beside this file,
since `PLAN-2026-10-21-faster-tests` builds on them.

## Answers

Measured in a lane (Linux, 16 cores, 11 GB, Node 24, jj 0.45.1, rootless
Docker), on accepted work of 2026-10-21. Every time is wall time, from
single runs unless stated otherwise; the noise between two runs of the same
command was up to 5 s in the unit suite.

1. **Each gate:**

   | gate | wall | what bounds it |
   |---|---|---|
   | `lint`, `typecheck`, `proofs:unit`, `conformance` | 0.7 s, 2.8 s, 11.8 s, 2 s | |
   | `pnpm test` (5,387 tests, 515 files) | 74–87 s | `packages/jj/repo.test.ts` (below) |
   | `e2e` | 212 s cold, about 95 s warm | the lane image built inside `agents`, 117 s, on its first run in a fresh lane. Warm: `tools` 18 s, `agents` 17 s, `cards` 14 s, `banners` 13 s |
   | `e2e:lanes` | 932 s | `package`, 635 s, of which 600 s is a wait for the line "lanes of their own are ready", which no code prints any more. Without it, about 300 s: `main` 108 s, `shared` 47 s, `folder` 44 s, `images` 38 s |
   | `e2e:browser` | 309 s | `page` 154 s (30 s of it a Playwright timeout), `tools` 121 s |

   S94 measured `e2e` at 16 s. It is about 95 s warm now, mostly the
   scenarios whose agent has tools and so runs in real lanes. `page` was
   72 s.

2. **The unit suite is bounded by one file, and slowed by its own
   workers.**
   - `packages/jj/repo.test.ts` takes 52–69 s alone, and 85 s in the full
     run. With it in the run, fewer workers finish sooner: 16 workers
     74 s, 8 workers 64 s, 4 workers 57 s.
   - It runs about 4,050 jj and git processes, one after another,
     totalling 45 s of its 59 s (counted through `jj-shim.sh`). Each one
     costs about 9 ms. 1,791 are `jj log` reads made by the code under
     test (the accepted bookmark, a lane's tip, a base's trailer), not by
     test setup, so making fewer of them is a change to the product
     (S253 did that for refresh).
   - Split four ways (simulated: four copies, each running every fourth
     test), the suite takes 26.5–29.6 s at 12 workers and 35.6–40.3 s at
     Vitest's default. Each quarter then takes 20–25 s, uneven because one
     test alone ("a review reads proposed changes' commit…") takes 18.8 s.
     The next files are then the bound: `packages/jj/lane/history.test.ts`
     (11–17 s) and `apps/pinetrie/host/jj/proposed/refresh.test.ts`
     (9–15 s).
   - Contention changes tests' times, not just the total. History's "An
     accept then getting the latest changes no file" took 23 s in the full
     run and 3 s alone. `apps/pinetrie/host/refusal.test.ts`, which starts
     a host process, failed on its 5 s timeout in the full run, and passes
     alone.

3. **A batch of mutations is about nine hours.** There are 2,714 unit
   mutations over 90 distinct commands and 481 suite mutations
   (`mutation-commands.ts`, `suite-mutation-cost.ts`).
   - **Unit:** each mutant runs its whole command, and the 30 commands
     most used, with their mutants, sum to about 305 min. The cost is the
     command's tests where those are slow (`packages/jj` 54.8 s × 80,
     `packages/jj/repo.test.ts` 56.3 s × 36, `apps/pinetrie/host` 15.6 s ×
     384), and Vitest's start and module loading where they are not
     (`packages/interface` 4.7 s × 582, `packages/rules` 2.4 s × 629).
   - **Narrowed by `-t` alone** (the `expect`, regex-escaped), the jj
     commands drop to 0.7 s and 2.0 s, but `packages/interface` still loads
     every file (5.7 s). The estimate falls to about 122 min.
   - **Narrowed to the file holding the expected test, and by `-t`**
     (`narrowed-to-a-file.ts`, the files from one `vitest list --json`,
     11 s), each sample took 0.44–1.12 s: a batch of about 35 min. A kill
     is unchanged by narrowing, since it already requires the expected
     test to fail. A mutant that broke only other tests would read
     SURVIVED rather than ELSEWHERE. Neither counts as killed.
   - **Narrowing adds a risk:** a test that passes only after an earlier
     test in its file would fail alone, and read KILLED with no bug. No
     run here showed one, and nothing now checks for it.
   - **Suite:** each mutant runs its scenario until its check. Summed from
     each check's time into its scenario in the timed runs, plus 3 s to
     start: browser about 149 min (240 timed; 167 of the 258 target
     `page`), lanes about 80 min (107), host about 23 min (74, counting
     the cold image in `agents`).

4. **Scenarios as processes.**
   - **Host:** all 14 scenarios, each as `PINETRIE_SCENARIO=<name> node
     e2e/e2e.ts`, eight at a time, took 32 s against about 95 s serially.
     The longest were `tools` 27 s, `agents` 26 s and `cards` 24 s.
     `tool-images` failed once under that load, and passed twice alone. It
     sends a message and then waits for `idleNow`, which is true before
     the run starts as well as after it ends. Under load the lane started
     later, so the wait ended at once and the check read an empty result.
     Thirteen scenario files wait on `idleNow`.
   - **Lanes:** ten scenarios at once failed in two ways. Three processes
     were killed for memory (exit 137). Every scenario that builds a base
     collided on one container name: `BASE_LANE` (`packages/lanes/spec.ts`)
     is `"base-scratch"` for the whole Docker engine, so
     `pinetrie-base-scratch` is in use by another process. Two hosts on one
     engine would collide the same way outside the suites.
   - **Running the suites in parallel needs one image build.** Every
     process with lanes builds the lane image if its tag is missing, so
     scenarios started at once in a fresh lane would each build it.

5. **Where real jj runs, and why so often.** Each unit file over 0.4 s was
   run alone with `jj-shim.sh` counting processes. Only these start jj:
   `packages/jj/repo.test.ts` (3,677 jj, 374 git),
   `apps/pinetrie/host/jj/proposed/refresh.test.ts` (469, 26),
   `packages/jj/lane/history.test.ts` (421, 82), `packages/jj/owner.test.ts`
   (103), `packages/jj/lane/revisions.test.ts` (51), `packages/jj/tidy.test.ts`
   (31) and `packages/jj/shared.test.ts` (13). Git alone runs in three folder
   files (`packages/folder/graph.test.ts` 31, `apps/pinetrie/host/folder/history.test.ts`
   19, `packages/lanehost/folder.test.ts` 7). Every other package's tests
   start none: the shell is already behind a boundary.
   - In `repo.test.ts` a test runs 11 to 264 jj processes; 25 of its 42
     run more than 100. They are stories, each a lane's life replayed
     from `jj git init`.
   - One story ("two acceptances, your edit to the first between them:
     clean", 177 processes), each process attributed to its caller by a
     stack read in `packages/lanes/run.ts`: 154 are the product's own
     operations and 23 the test's. Of the product's,
     `buildProposedChanges` ran 26 for two builds, `mergeUpdate` 17,
     `commitTurn` 15 and `gatherLane` 14. The rest were
     `readGetLatest`, `laneBase`, `startOfProposed` and smaller reads, 2 to
     9 each. So a story's cost is what the host's own operations cost, at
     about 9 ms a process, and the same reads repeat across operations
     (`present("pinetrie-accepted")` 161 times in the file, a lane's tip
     144).

**What was read rather than run.** `scripts/mutate.ts` (no narrowing; a
kill needs the `expect` among the failing lines), `scripts/budget.ts` (the
browser may hold ⌊√27⌋ = 5 scenarios and holds 5),
`apps/pinetrie/e2e/scenario.ts` (scenarios run in order, in one process),
`apps/pinetrie/e2e/lanes/package.scenario.ts` and
`apps/pinetrie/host/startup-lines.ts` (the line the scenario waits for has
no source).

**Sources**, in the folder beside this file:
`jj-shim.sh` times each jj call (a copy, as `git`, did git's);
`mutation-commands.ts` times each unit command, whole and with `-t`;
`narrowed-to-a-file.ts` times a mutant's command narrowed to its file and
name; `suite-mutation-cost.ts` estimates a suite mutation's cost from a
suite's timed log. The scripts read logs from `sandbox/test-timing/`, which
is not committed.
