import { expect, test } from "vitest"
import { DIAGNOSTIC_ROWS, diagnosticsText, newestRows } from "./diagnostics.ts"

const row = (table: string, at: number) => JSON.stringify({ table, at })

test("the diagnostics hold the page's words, the export's heading, its newest rows and each log's tail", () => {
  const text = diagnosticsText(
    { kind: "no-machine" },
    {
      heading: JSON.stringify({ version: "0.1.0", days: 1 }),
      rows: [row("samples", 1), row("events", 2)],
    },
    [
      { file: "console.log", lines: ["booted"] },
      { file: "launcher.log", lines: null },
    ],
  )
  expect(text.split("\n")).toEqual([
    "This host runs no lanes, so pine·trie reads no machine here.",
    "",
    "Measurements:",
    '{"version":"0.1.0","days":1}',
    row("samples", 1),
    row("events", 2),
    "",
    "console.log:",
    "booted",
    "",
    "launcher.log:",
    "  not there",
    "",
  ])
})

test("the newest rows are chosen by their time, across the tables the export lists apart", () => {
  const rows = [
    ...Array.from({ length: DIAGNOSTIC_ROWS }, (_, i) => row("samples", i)),
    row("events", 0.5),
    row("events", DIAGNOSTIC_ROWS + 1),
  ]
  const newest = newestRows(rows, DIAGNOSTIC_ROWS)
  expect([
    newest.length,
    newest.at(-1),
    newest.includes(row("events", 0.5)),
  ]).toEqual([DIAGNOSTIC_ROWS, row("events", DIAGNOSTIC_ROWS + 1), false])
})
