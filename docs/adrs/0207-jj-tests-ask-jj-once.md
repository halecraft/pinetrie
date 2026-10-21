# ADR-0207 — Only the jj adapter's tests run jj, each asking it once; accepted work's facts are two reads

- **Status:** Proposed
- **Area:** `packages/jj/TECHNICAL.md`
- **Evidence:** S306, S305

**Context.**

- **One test file bounded the unit suite.** `packages/jj/repo.test.ts`
  ran about 4,050 jj and git processes, one after another on one worker,
  for 52 to 69 s of the suite's 74 to 87 s (S305).
- **The boundary was already there.** Only `packages/jj`'s tests and the
  host's jj adapter run jj, and every assertion in the file checks what
  jj answers: merges, conflicts, immutability, the evolog, the op log, and
  our revsets and templates against states jj made. The decisions were
  already pure tests of their planners (S306).
- **Its cost was repetition.** The oracle that reads a lane both ways ran
  after every build and every acceptance (22% of the processes), and two
  rigs were rebuilt from `jj git init` in every test (25%). A copied rig,
  and the oracle at the states each test names, kept every test passing
  and every mutation of the read code killed (S306).
- **Accepted work's facts cost a dozen processes per operation.**
  `acceptedFacts` runs once per operation in your repo, after each of your
  jj commands and each of the host's writes, as 11 reads plus two per WIP,
  each a count of a `jj log`. Its preview listed your whole common history
  with accepted work to test that it was not empty.

**Decision.**

- **Only `packages/jj` and the host's jj adapter run jj in a test.** A
  test that runs jj checks what jj answers. A decision is a pure test of
  its planner, with its facts as values.
- **The real-jj tests of your repo and a lane's are four files that run
  at once**, sharing one module of rigs (`packages/jj/repo-rigs.ts`). A rig
  a file's tests share is set up once per file and copied for each test,
  as a fork copies a lane. Its set-up returns commit ids, never a closure
  over its template.
- **The oracle runs at the states a test names:** where a test calls it,
  and once at the end of each test that builds or accepts and calls it
  nowhere else. Not after every build and every acceptance.
- **Accepted work's facts are two jj reads, whatever the WIPs:** the
  commits, with both configs on the root's row, then every count as one
  read's rows, each tagged with the revsets that hold it (as the shared
  facts and the lane read already are). `@`'s conflicted files are read
  only when `@` is conflicted. A working copy whose fork point with
  accepted work is the root has no preview: the fork point decides, and
  your common history is not listed.

**Consequences.**

- The real-jj tests run 2,715 jj and git processes where they ran 4,051,
  in four files of 562 to 913 each, and the unit suite took 30 s where it
  took 74 to 87 s (measured in a lane on 2026-10-21).
- A test that counts `acceptedFacts`' processes (two) fails when a count
  is read on its own again, and a mutation proves it.
- Each further WIP adds two revsets to the count read, not two processes.
- A config jj cannot print on a template row would fail the first read
  where `jj config get` returned nothing. Both keys have jj's own
  defaults, so neither is ever missing.
