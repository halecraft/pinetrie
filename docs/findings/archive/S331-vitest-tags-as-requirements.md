# S331 — Vitest 5's tags can carry what a test requires: a tag defined with `skip` skips every test it marks, and a filter selects by tag

- **Status:** Answered

**Question.** Unit tests that need a place to run (the checkout on btrfs,
`flock`, the Mac's own disks) decide it today with `describe.skipIf` on a
condition each file computes, and one (`packages/lock/lock.test.ts`) does
not list the tests it cannot run at all. Can Vitest 5's test tags carry the
requirement instead, so that one place decides what is met here and a run
elsewhere can select what was not?

1. Does a tag defined in the config with `skip` skip each test it marks,
   and each test of a suite it marks?
2. Can a filter select tests by tag, with negation?
3. What do `vitest list` and the JSON reporter say of tags and of skips?
4. Is a tag no config defines refused?

**Kill criterion.** A tag's `skip` that does not reach a suite's tests, or
no way to select by tag from the command line.

**Throw away.** The probe's directory under `/tmp` (a config and three test
files, run with this repo's `node_modules`).

## Answers

Run on 2026-10-23 on the Mac with the repo's Vitest, 5.0.5. The config
defined `tags: [{ name: "btrfs", skip: true }, { name: "darwin", skip:
false }]` (`skip` worked out in the config, as a capability check would).
Read from source: `TestTagDefinition` (`vitest/dist/chunks/config.d.*.d.ts`)
extends `TestOptions` but `tags`, so a tag carries `skip`, `timeout`,
`retry` as a test does; `tagsFilter` and `listTags` are run options.

1. **Yes, for tests and suites.** `test(name, { tags: ["btrfs"] }, …)` and
   every test of `describe(name, { tags: ["btrfs"] }, …)` read `↓`
   (skipped); those tagged `darwin` ran. A suite's tag reaches its tests
   (the JSON report gives the inner test `tags: ["btrfs"]`). A test's own
   `skipIf` still works beside a tag.
2. **Yes:** `--tags-filter='!btrfs && !darwin'` ran only the untagged
   test, and `--tags-filter=btrfs` selected the two tagged ones. A tag's
   `skip` holds under a filter that selects it: the place that runs a
   tagged test must define the tag without `skip`, as its own config
   would.
3. **`vitest list` lists every test, skipped by a tag or not**, and applies
   `--tags-filter`; its `--json` gives no tags. **The JSON reporter**
   (`--reporter json --outputFile`) gives each test's `status` and `tags`,
   and no reason for a skip: what was not met is read from its tags.
   `vitest --list-tags=json` lists each tag with its `skip`.
4. **Refused:** a test tagged `nope` failed its file with `The tag "nope"
   is not defined in the configuration` (`strictTags`, on by default).

## What this means

A requirement can be a tag, defined once with its `skip` from what the
place it runs in has: no test file computes a condition of its own, and a
test that cannot run here is listed and reported as skipped by name rather
than left out. Since `vitest list` ignores the skip, a check of tests by
name (`pnpm run proofs:unit`) sees every test on every machine.
