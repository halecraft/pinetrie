import type { EventMeasured } from "@pinetrie/core"
import { threadIdFor } from "@pinetrie/core"
import { KeeperClosed } from "@pinetrie/keeper"
import { expect, test } from "vitest"
import {
  compactionLine,
  failed,
  slow,
  slowStepLine,
  timestampedLog,
} from "./basics.ts"
import { basics } from "./fakes.ts"
import { slowCommand } from "./jj/index.ts"

test("failed logs the host's line, with the thread when it names a lane", () => {
  const b = basics()
  const lane = threadIdFor("0123456789abcdef")
  failed(b, "compaction")(new Error("disk full"))
  failed(b, "forking", lane)("no volume")
  expect(b.lines).toEqual([
    "[host] compaction failed: disk full",
    "[host] 89abcdef: forking failed: no volume",
  ])
})

test("a slow step's line says where its time went, the rest and its commands", () => {
  expect(
    slowStepLine("your repo", {
      key: "refresh:t-1",
      waited: 14.2,
      ran: 1233,
      split: {
        parts: [
          { name: "gather", ms: 190.4 },
          { name: "shared facts", ms: 0.3 },
          { name: "base record", ms: 900 },
        ],
        commands: { count: 5, ms: 160 },
      },
    }),
  ).toBe(
    "[host] your repo: a step (refresh:t-1) waited 14 ms and ran 1233 ms: gather 190 ms, base record 900 ms, the rest 142 ms, jj and git 160 ms of it, in 5 commands",
  )
})

test("a slow step with nothing split, or no split, keeps the short line", () => {
  const step = { key: null, waited: 1200, ran: 3 }
  const short = "[host] a step waited 1200 ms and ran 3 ms"
  expect(slowStepLine(undefined, step)).toBe(short)
  expect(
    slowStepLine(undefined, {
      ...step,
      split: { parts: [], commands: { count: 0, ms: 0 } },
    }),
  ).toBe(short)
})

test("failed logs nothing for a step a closed keeper refused", () => {
  const b = basics()
  failed(b, "refreshing its proposed changes")(new KeeperClosed())
  expect(b.lines).toEqual([])
})

test("a compaction's line names its document, the records and kilobytes it read, and its time", () => {
  expect(
    compactionLine({
      docId: "root:r-1",
      records: 1512,
      bytes: 11_400_000,
      ms: 1408.6,
    }),
  ).toBe("[host] compacted root:r-1 (1512 records, 11400 KB) in 1409 ms")
  expect(
    compactionLine({ docId: "pinetrie:live", records: 1, bytes: 400, ms: 600 }),
  ).toBe("[host] compacted pinetrie:live (1 record, 0 KB) in 600 ms")
})

test("a slow step and a slow command are logged as before, and each recorded", () => {
  const lines: string[] = []
  const recorded: EventMeasured[] = []
  const b = {
    log: (l: string) => lines.push(l),
    recordEvent: (e: EventMeasured) => recorded.push(e),
  }
  slow(b, "your repo")({ key: null, waited: 0, ran: 1234.4 })
  slowCommand(
    b,
    "your repo",
  )({ program: "jj", args: ["log", "-r", "@"], ms: 900.6 })
  expect(lines).toEqual([
    slowStepLine("your repo", { key: null, waited: 0, ran: 1234.4 }),
    "[host] your repo: jj log -r @ ran 901 ms",
  ])
  expect(recorded).toEqual([
    { kind: "slow-step", where: "your repo", ms: 1234 },
    { kind: "slow-command", program: "jj", subcommand: "log", ms: 901 },
  ])
})

test("timestampedLog prefixes each line with the local time of the clock it is given", () => {
  const lines: string[] = []
  const at = new Date(2026, 9, 24, 9, 7, 4).getTime()
  timestampedLog(
    line => lines.push(line),
    () => at,
  )("[host] ready")
  expect(lines).toEqual(["09:07:04 [host] ready"])
})
