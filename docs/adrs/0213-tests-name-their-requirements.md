# ADR-0213 — A test names what it requires of the place it runs in, and a verification run works out where each can run, making a lane for those this machine cannot

- **Status:** Accepted (Duane, 2026-10-23)
- **Area:** `apps/pinetrie/e2e/TECHNICAL.md`, `AGENTS.md`
- **Evidence:** S331, S332

**Context.** Which tests ran was an accident of where `verify` was typed.
Each test that needed something of its place decided it with a condition
of its own file: `describe.skipIf(!onBtrfs)` in four files of btrfs tests,
`skipIf(!has("flock"))`, `skipIf(process.platform === "darwin")`; one
(`lock.test.ts`) did not even list the tests it could not run. On the Mac
48 unit tests skipped and `pnpm run proofs:unit` reported 12 mutations it
could not see, though the Mac runs a VM whose lanes could run them. The
suites decided per scenario with a `needs` function's words and per check
with words of their own. And `verify` chained its steps with `&&`, so the
first failure hid every later step.

**Decision.**

- **A requirement is a value** (`apps/pinetrie/e2e/requirements.ts`). A unit
  test names its requirements as Vitest tags (`mac-host`, `linux`, `flock`,
  `btrfs-checkout`), on a test or a `describe`; the config defines each,
  skipping it where this place lacks it (S331). A scenario names its own
  in `requires` (`lane-runtime`, `lane-vm`, `rootful-docker`, `live-model`,
  `chromium`, `qemu`, `arm64-docker`), and a check skipped for where it
  runs names its requirement. No test file computes where it may run.
- **One plan says where each is met** (`planUnitRequirements`): here; in a
  throwaway lane this run makes, when this place can make one and a lane
  meets it; or nowhere, with why. A test goes to the lane only when a lane
  meets every one of its requirements.
- **The lane is a throwaway project's**, never the checkout's own, and its
  copy is the working copy's files (`jj file list`), streamed in, installed
  from the frozen lockfile (S332). The run's report fails when a test
  planned for the lane did not run there: no test is lost between the two
  places. A test that can run nowhere is listed with why, and fails
  nothing.
- **`@halecraft/verify` runs the gates** (`verify.config.ts`): every task
  whatever another's result; the long ones never wait on `format`, since a
  dependency's failure ends its dependents. `verify:all` adds the suites
  that need a real model, a browser or `qemu`; each is skipped with why
  where it cannot run. A passing task's line says what it did not run,
  through the config's own parsers reading a line each tool marks.
- **`pnpm mutate`** runs a unit mutant whose tests all skip here in the
  lane, or reads NOT-HERE: a skipped test never reads as a survivor.
- **The suites' requirements are met here or not.** Whether a lane this
  run makes could meet them (the lane-only checks, the observer's suite) is
  S333, open.

**Consequences.** On the Mac `pnpm run verify` runs the 57 tests it cannot
itself in a lane on the lane VM, about 35 s more; `proofs:unit` sees every
test there. A Linux host whose checkout is on btrfs runs them all itself.
From inside a lane, the Mac's own tests are reported as needing the Mac.
The lane's install needs the registry: offline, its task fails with pnpm's
words, and the rest run. A new test that needs something of its place
names a requirement, adding one to `requirements.ts` if none fits.
