# S65 — where the suites spend their time

Measured in a lane (Linux, 5 cores, Node 24, Chromium's headless shell, no
`container` runtime), against the suites as of
`PLAN-2026-10-01-suite-dead-time`.

**Answers.**
1. **`e2e` is mostly waiting** (measured). It took 48 s of wall time on 7 s
   of CPU. Its waits, by cause:
   - `slowToLoad(store, 3_000)` at the tools and notes restarts: about 18 s.
     Kyneta's `#hydrate` (`@kyneta/exchange`, `src/runtime.ts`) calls
     `writerOf`, `currentMeta`, then `loadAll`, and the proxy slept in both
     of the last two, so each load took 6 s. The proxy stayed on the store
     for the host's life: compaction (`#compact`, a `loadAll`) and a joining
     client's command Line documents slept 3 s more each, which made one
     `quiet()` and one `shutdown()` take 3 s each.
   - A `waitFor` that could never succeed: 5 s. In the notes section, it
     waited for a note to end with text the step before had just deleted.
   - The image clean-up delays (`GRACE_MS`, 1 to 1.5 s, slept four times):
     about 5.8 s.
   - Typing and presence entries expiring: about 2 s.
   - The tools section's 400-line bash loop (`sleep 0.005` a line): about
     3.4 s.
   - Runs on the scripted model (400 tokens/s): about 2 s.
2. **`e2e:browser` spends about 80 s outside its container section**
   (measured). Without `container`, that section fails six checks on
   timeouts, about 220 s, so its cost on a Mac is not measured here. Of the
   80 s:
   - A wait for an element that was never visible: 10 s. `appears` waited
     for a closed tool row's `.tool-label-whole`, which is `display: none`
     until the row opens; `waitForSelector` waits for visible, and `appears`
     turns the timeout into `false`, so the check after it passed anyway.
   - Negative checks, which show that nothing arrives: about 10 s, 0.3 to
     1.5 s each.
   - Recording frames with the CPU slowed 20 times: 8.7 s.
   - The tools section ("tools: rows, live output, and Stop") runs one host
     with lane containers and a model at 60 tokens/s, against 400
     elsewhere. Checks inside it that need neither still pay for both.
3. **A suite mutant pays every wait before its check** (source,
   `scripts/mutate.ts`). Mutants run one at a time, since each edits the
   working copy in place. A suite mutant reruns its suite from the start
   until its expected check fails (`PINETRIE_STOP_AT`). From the checks'
   times in a run, the 14 `e2e` mutants averaged 28 s; 7 of them came after
   both slow restarts. Of the 94 browser mutants, 72 expect a check in the
   first 55 s (mean 15 s), and 19 a check after the container section.
4. **A unit mutant costs 1 to 4 s** (measured), mostly Vitest starting:
   `packages/core` 0.8 s, `packages/client` 2.0 s, `apps/pinetrie/host` 3.8 s.
   There are about 430.
5. **The three dead waits are gone** (measured, after the plan).
   `slowToLoad` delays only the first `currentMeta` of one named document,
   by 300 ms; the impossible wait is deleted; the browser suite waits for
   the tool row by its visible text. `e2e` took 20 s (161 of 161), `pnpm
   run verify` 38 s against 65 s, and the browser step 1.0 s against 11 s.
   The seven mutations whose checks rely on those waits were all KILLED.

## Why it was asked

`e2e` and the mutation runs were slow enough to put off running them. The
question was whether the time was work or waiting, and which waits prove
something.

## Method

- Every output line of each suite, timestamped as it arrived, and sorted by
  the gap before it.
- A throwaway copy of `e2e.ts` whose `sleep`, `waitFor`, `startHost`,
  `quiet`, `shutdown` and `join` were wrapped in timers keyed by their call
  site (from `new Error().stack`), summed at exit.
- A throwaway copy of `browser.ts` that printed every timeout it swallowed
  (`.catch(() => null)`, `appears`' `false`), with its line and length.
- `slowToLoad` logging each `currentMeta` and `loadAll` with its document
  and caller, around the restart, `quiet()` and `shutdown()`.
- For each suite mutation in `scripts/mutations/app.ts`, the time its
  `expect` check printed in a timed run: the time `PINETRIE_STOP_AT` stops it.

## Still open

Listed in `docs/pinetrie.md`, "Open, non-blocking": the image clean-up delay
and presence expiry as host options; `e2e` and `e2e:browser` in sections, as
`e2e:lanes` already is; the browser tools section's container-free checks on
a host without containers; mutants in parallel, each in its own copy of the
repository.
