// scripts/unconsolidated — ADRs in force amended more than
// `AMENDMENT_LIMIT` times (`scripts/record.ts`), by number. The list only
// shrinks: `scripts/record.test.ts` fails when an ADR is over the limit and
// not here, and when one here is no longer over it. An entry leaves when a
// restatement supersedes its ADR (`docs/adrs/README.md`, Amendments).

export const UNCONSOLIDATED: readonly number[] = [
  21, 23, 24, 27, 29, 30, 32, 34, 40, 48, 59, 61, 63,
]
