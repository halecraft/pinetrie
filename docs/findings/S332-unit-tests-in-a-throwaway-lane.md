# S332 — From the Mac, a throwaway lane on the lane VM runs every unit test the Mac cannot, from a copy of the checkout, in about a minute and a half

- **Status:** Answered
- **Led to:** ADR-0213

**Question.** On the Mac 48 unit tests skip: 45 need the checkout on btrfs
(lanehost's `disks`, `folder` and `read-in` tests, and the host's folder
history), one needs `flock`, two run only where `findProject` does not take
the person's lane VM; and `lock.test.ts` does not list its Linux backend's
tests at all. `pnpm run proofs:unit` reports 12 unit mutations whose tests
it cannot list there. Can a run started on the Mac make a lane of its own
on the lane VM and run them there?

1. Is a lane's `/workspace` on btrfs, and can a lane's tests make and
   delete subvolumes there without `lanes.nested`?
2. Does the checkout, copied into the lane, install from the frozen
   lockfile, and with what?
3. Which unit tests pass, skip or fail there?
4. What does each step take?

**Kill criterion.** A btrfs test that fails in the lane, or an install that
needs anything the lane image lacks.

**Throw away.** The lane, its disk and the throwaway project, which the
probe removes. Its source is kept, as a plan builds on it.

## How it ran

`docs/findings/S332-unit-tests-in-a-throwaway-lane/probe.ts`, run from
`apps/pinetrie` on 2026-10-23 on the Mac (Apple M3 Max) against the
person's lane VM: `findProject` on a throwaway git project (not this repo,
whose own host may hold its project's lock), the project's lane image
(`prepareImages`), `ready` with the checkout shared read-only at
`/mnt/src`, then one lane, `nested: false`, 6 GiB. In it: the checkout
copied with `tar` into `/workspace/src` without `node_modules`, `.jj`,
`.git`, `dist` and `.plans`; `CI=1 corepack pnpm install
--frozen-lockfile`; `npx vitest run` with the JSON reporter; `node
scripts/unit-proofs.ts`. `facts.txt` and `timeline.txt` beside this file
are what it recorded.

## Answers

1. **btrfs, and no grant needed.** `/workspace` is btrfs (`stat -f`), the
   lane runs as root without `CAP_SYS_ADMIN` (`CapEff a80425fb`), and
   every btrfs test passed with `nested: false`.
2. **It installs with what the lane image has:** Node 24, pnpm 10.18.0
   through corepack (the repo's `packageManager`), from the registry with
   an empty store, in 11.3 s. Only protobufjs's build script was ignored,
   as on the Mac.
3. **5,868 passed, 1 skipped, 1 failed.** The skip is the Mac's own
   (`a folder opened in another case is the same session`, darwin only).
   The failure was the probe itself: copied with the checkout, it named
   its spike in code, which `scripts/record.test.ts` refuses. Every test
   the Mac skips ran and passed, and `lock.test.ts` ran its Linux
   backend. `proofs:unit` in the lane: every unit mutation names a test
   (5,869 tests); its 12 gaps on the Mac are the tests `skipIf` hides
   from `vitest list` there.
4. **About 1:40 in all,** with the images already built: the host's
   images and `ready` 5.5 s, the lane 0.3 s, the copy 44 s, the install
   12 s, the unit tests 23 s, `proofs:unit` 11 s.

The copy took 44 s because `tar` copied 25 GB: every untracked folder of
the checkout (`sandbox/`, the stores). The working copy's own files,
`jj file list`, are 2,968 files, 19.4 MB. `tar` also refused the sockets
under `sandbox/`.

## What this means

A run on the Mac can make one lane of a throwaway project and run there
every test whose requirement the Mac cannot meet. It should send the
working copy's files only (`jj file list`, uncommitted changes included),
which also needs no share of the checkout: `tar` on the Mac, streamed into
`docker exec -i … tar -x` (a half-close reaches a lane, S128). It needs
no grant beyond a plain lane's.
