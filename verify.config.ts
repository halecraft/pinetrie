import { defineConfig } from "@halecraft/verify"
import { UNIT_REPORTS } from "./apps/pinetrie/e2e/requirements.ts"
import { VERIFY_PARSERS } from "./scripts/verify-parsers.ts"

/**
 * The gates, run by `@halecraft/verify` (`pnpm run verify`, `verify:all`,
 * `verify:fix`). Every task runs whatever another's result.
 *
 * `checks` runs one task at a time, and only the short `format` and
 * `types` beside it: a test that runs jj or a host outlasts its timeout
 * under another task's load, and the lane and the suites share the lane VM
 * or the suites' Docker. Within it, the unit tests run
 * here, then in a throwaway lane those this place cannot run
 * (`apps/pinetrie/scripts/lane-tests.ts`), then the report that no test was
 * lost between the two (`scripts/requirements-report.ts`), which reads both
 * places' JSON reports (`UNIT_REPORTS`).
 *
 * Only `types` waits on `format` for its failures: a syntax error both
 * report reads once. A dependency's failure ends its dependents early, so
 * none of the long tasks takes one: a lint finding must not cut a suite.
 *
 * `verify` takes one task to run, or all; so the suites that need a real
 * model, a browser or `qemu` are in the tree only for `verify:all`
 * (`PINETRIE_VERIFY_ALL=1`), and `pnpm exec verify <key>` runs any one.
 */
const all = process.env.PINETRIE_VERIFY_ALL === "1"

export default defineConfig({
  parsers: [...VERIFY_PARSERS],
  tasks: [
    {
      key: "format",
      run: "biome check .",
      fix: "biome check . --write",
      parser: "biome",
    },
    {
      key: "types",
      run: "tsc --noEmit && tsc --noEmit -p tsconfig.pure.json",
      parser: "tsc",
      reportingDependsOn: ["format"],
    },
    {
      key: "checks",
      strategy: "sequential",
      children: [
        { key: "proofs", run: "node scripts/unit-proofs.ts" },
        { key: "conformance", run: "pnpm run conformance" },
        {
          key: "unit",
          strategy: "sequential",
          children: [
            {
              key: "here",
              run: `rm -f ${UNIT_REPORTS.here} && vitest run --reporter=default --reporter=json --outputFile.json=${UNIT_REPORTS.here}`,
              parser: "vitest",
            },
            {
              key: "lane",
              run: "pnpm --filter @pinetrie/app run lane-tests",
              parser: "vitest",
            },
            {
              key: "report",
              run: "node scripts/requirements-report.ts",
              parser: "requirements",
            },
          ],
        },
        {
          key: "suites",
          strategy: "sequential",
          children: [
            { key: "e2e", run: "pnpm run e2e", parser: "suite" },
            { key: "lanes", run: "pnpm run e2e:lanes", parser: "suite" },
            ...(all
              ? [
                  { key: "live", run: "pnpm run e2e:live", parser: "suite" },
                  {
                    key: "browser",
                    run: "pnpm run e2e:browser",
                    parser: "suite",
                  },
                  {
                    key: "observer",
                    run: "pnpm run e2e:observer",
                    parser: "suite",
                  },
                ]
              : []),
          ],
        },
      ],
    },
  ],
  env: { NO_COLOR: "1" },
})
