import { expect, test } from "vitest"
import { planUnitRequirements } from "../apps/pinetrie/e2e/requirements.ts"
import {
  planVerifyReport,
  reportedTests,
  requirementsSummaryLine,
  type TestOutcome,
} from "./requirements-report.ts"

const mac = planUnitRequirements({
  platform: "darwin",
  checkoutOnBtrfs: false,
  hasFlock: false,
  laneRuntime: null,
})

const t = (
  name: string,
  status: string,
  tags: readonly string[] = [],
): TestOutcome => ({ file: "packages/x/x.test.ts", name, status, tags })

test("a test planned for the lane that the lane did not run is lost", () => {
  const report = planVerifyReport({
    plan: mac,
    here: [t("on btrfs", "skipped", ["btrfs-checkout"])],
    lane: [],
    laneFailed: null,
  })
  expect(report.lost.map(l => l.name)).toEqual(["on btrfs"])
  expect(requirementsSummaryLine(report)).toBe(
    "requirements: 0 here · 0 in a lane · 1 planned for the lane, not run there",
  )
})

test("a test the lane ran counts there, under each of its requirements", () => {
  const report = planVerifyReport({
    plan: mac,
    here: [t("on btrfs", "skipped", ["btrfs-checkout", "linux"])],
    lane: [t("on btrfs", "passed", ["btrfs-checkout", "linux"])],
    laneFailed: null,
  })
  expect(report.lost).toEqual([])
  expect(report.counts["btrfs-checkout"].lane).toBe(1)
  expect(report.counts.linux.lane).toBe(1)
})

test("a test no place can run is listed with why, and lost nothing", () => {
  const linux = planUnitRequirements({
    platform: "linux",
    checkoutOnBtrfs: true,
    hasFlock: true,
    laneRuntime: null,
  })
  const report = planVerifyReport({
    plan: linux,
    here: [t("the Mac's disks", "skipped", ["mac-host"])],
    lane: [],
    laneFailed: null,
  })
  expect(report.lost).toEqual([])
  expect(report.unmet).toEqual([
    {
      requirement: "mac-host",
      why: "needs the Mac's own host, outside its lane VM",
    },
  ])
  expect(requirementsSummaryLine(report)).toBe(
    "requirements: 0 here · 0 in a lane · 1 run nowhere: mac-host",
  )
})

test("an untagged test counts here only, whatever the lane ran", () => {
  const report = planVerifyReport({
    plan: mac,
    here: [t("plain", "passed"), t("the Mac's disks", "passed", ["mac-host"])],
    lane: [t("plain", "passed")],
    laneFailed: null,
  })
  expect(report.untagged).toBe(1)
  expect(report.counts["mac-host"].here).toBe(1)
  expect(report.counts.linux.lane).toBe(0)
})

test("a report's tests are read with their files from the checkout's root", () => {
  const json = {
    testResults: [
      {
        name: "/workspace/src/packages/x/x.test.ts",
        assertionResults: [
          { fullName: "a b", status: "passed", tags: ["linux"] },
        ],
      },
    ],
  }
  expect(reportedTests(json, "/workspace/src")).toEqual([
    {
      file: "packages/x/x.test.ts",
      name: "a b",
      status: "passed",
      tags: ["linux"],
    },
  ])
  expect(reportedTests(null, "/")).toEqual([])
})
