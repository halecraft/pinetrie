# ADR-0152 — No check judges elapsed time: a configuration is a planned value, a complexity is counted in steps, and an abort, a kill or concurrency is read from a result

- **Status:** Accepted (Duane, 2026-10-16)
- **Area:** `apps/pinetrie/e2e/TECHNICAL.md`
- **Evidence:** S129, S214
- **Amends:**
  - ADR-0139: the rule extends from waits to verdicts, in unit tests as well
    as suites: no check compares a duration with a limit.

**Context.**

- **A suite failed on the machine's load.** `e2e:lanes`, in a nested lane,
  failed "a lane's docker run -d takes under 150 ms" at 213 ms, and passed
  at 100 ms on the same code in the next run. The limit read the shared
  Docker's load, not the code.
- **That check stood in for one constant.** Its only mutation set the
  launcher's data disk to Apple's `full` synchronization, which S129
  found made every `docker run` about 500 ms. It could catch that only on
  the Mac.
- **Six unit tests judged time too:** two folds proven linear by a
  wall-clock limit (`unattributed`, the send stream's fold, both from
  S179), and four aborts, kills or concurrency checks that bounded how long
  a `sleep` took to end.

**Decision.**

- **No check compares a clock reading with a limit,** in a suite or a unit
  test. What it guards is modelled as a value:
  - **a configuration** is a value a pure function returns, read by a unit
    test: the launcher's disk modes are `LAUNCHER_DISKS`, in the argv
    `launcherArgs` plans (`packages/vm/plan.ts`);
  - **a complexity** is counted in steps: `collectionSteps`
    (`@pinetrie/core/fixtures`) wraps the iterators of `Map.prototype` and
    `Set.prototype` while a synchronous function runs, and a test bounds
    the steps per item (S214);
  - **an abort, a kill or concurrency** is read from what the call
    returns, the signal handed down, or a state the commands reach together.
    A kill that never comes is a hang, which the test runner's timeout
    ends: no check reads how long it took.
- **A cost worth knowing is a spike's measurement,** not a gate.
- **`scripts/budget.test.ts` refuses a clock reading subtracted** in any
  unit test or scenario file (`elapsedReadingsIn`).

**Consequences.**

- The `contract` scenario measures nothing: its cost check, its timings of
  `run -d` and snapshots, its cold start and the launcher's open files are
  gone.
- The launcher takes its disks' synchronization and caching as its last
  two arguments. Its source changed, so every Mac's lane VM is replaced
  once, at the first lease that holds it alone.
- The two complexity tests run at 1,000 items, in milliseconds, where the
  timed ones built 50,000 and 15,000.
- The guard reads text: a deadline on a wait for a state is written as
  `Date.now() < until`, which it does not count.
- Fixed waits inside unit tests (`setTimeout`, a command's `sleep`) are not
  verdicts, and this decision leaves them.

**Alternatives rejected.**

- **A looser limit, a median of more runs, or a retry.** Each fails less
  often, never for the right reason, and still catches one constant on one
  platform.
- **Reading `.fsync` out of `launcher.swift` in a TypeScript test.** That
  tests text. As a planned value the choice sits beside `vmMemoryCeiling` and the
  slots, and a unit mutation proves it.
- **A JSON spec as the launcher's one argument.** `prune.ts` and the
  scenario read running launchers' command lines; both would depend on the
  JSON's layout.
- **A counting seam in the folds.** A production parameter that serves only
  tests, as ADR-0139 rejected for the clock. Wrapping the prototypes from
  the test sees every iteration with no change to the code.
- **Deleting the complexity tests.** They prove S179's fix, which blocked
  a host's main thread for 44 s.
