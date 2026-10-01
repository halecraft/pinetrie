# `apps/pineta/e2e` — technical notes

The end-to-end suites: `e2e.ts` (`pnpm run e2e`, and `e2e:live`),
`browser.ts` (`e2e:browser`) and `lanes.ts` (`e2e:lanes`). They share
`checks.ts` (recording a check, and stopping at one) and `harness.ts`
(waiting, throwaway projects, joining a host, the scripted model).

## What a run costs

- **A wait costs once per run, and once more per mutant whose check comes
  after it.** A suite mutant reruns its suite from the start until its
  expected check fails (`PINETA_STOP_AT`, `checks.ts`), and mutants run one
  at a time (`scripts/mutate.ts`). S65 measures where the time goes.
- **A wait must be able to end early.** A fixed `sleep`, or a `waitFor`
  whose condition cannot hold, costs its whole length every run. A negative
  check, which shows that nothing arrives, has to wait: wait as briefly as
  the rule it checks allows.

## Gotchas

- **`slowToLoad` delays one document's first `currentMeta`**, by
  `LATE_LOAD_MS`. Kyneta's `#hydrate` reads `currentMeta` before `loadAll`,
  so this delays that document's first load and nothing else (`e2e.ts`, the
  tools and notes restarts). If Kyneta's hydration stops reading
  `currentMeta`, nothing is delayed, and the mutations "the host does not wait for its stored
  session" and "the host serves before it has recovered" survive.
- **`waitForSelector` waits for a visible element by default**, and so does
  the browser suite's `appears`. An element CSS hides, such as a closed tool
  row's `.tool-label-whole`, never resolves it. Wait for something visible,
  or pass `state: "attached"` when being in the page is what counts.
- **The browser suite swallows timeouts**, through its two `appears`
  helpers and `.catch(() => null)`: a mutant must fail at its check, and
  `judge` (`scripts/mutate.ts`) counts a thrown error as ELSEWHERE. A
  wait that can never succeed then passes silently after its whole timeout,
  and only timing shows it.
