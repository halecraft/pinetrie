import { readFileSync } from "node:fs"
import path from "node:path"
import { SERVICES_CGROUP } from "@pinetrie/lanehost"
import { ROOM_SPENT } from "@pinetrie/machine"
import { DATA_DISK_FULL_LINE } from "@pinetrie/vm"
import { expect, test } from "vitest"
import { repairOutcome } from "./repair.ts"

const INIT = readFileSync(
  path.join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "..",
    "packages",
    "vm",
    "image",
    "init",
  ),
  "utf8",
)

test("the lane VM's init calls its disk full where the host calls the room spent, in the words the host reads", () => {
  const full =
    /if \[ "\$unallocated" -lt \$\(\((\d+) \* (\d+) \* (\d+)\)\) \]; then\n\s+t "([^"]+)"/.exec(
      INIT,
    )
  if (full === null) throw new Error("init says no disk full")
  const [, a, b, c, words] = full
  expect(Number(a) * Number(b) * Number(c)).toBe(ROOM_SPENT)
  expect(words).toBe(DATA_DISK_FULL_LINE)
})

test("the lane VM's init makes the services' parent where lanehost reads it, with the launcher's floor", () => {
  const made = [
    ...INIT.matchAll(/\/sys\/fs\/cgroup\/([\w-]+)\/memory\.low/g),
  ].map(m => m[1])
  expect(made).toEqual([SERVICES_CGROUP])
  expect(INIT).toContain("services_floor=$(arg lane.services_floor)")
  expect(INIT).toContain("-o memory_recursiveprot")
})

test("a repair boot's report keeps what it left, and why it failed", () => {
  const room = {
    size: 3,
    unallocated: 2,
    metadataSize: 10,
    metadataUsed: 4,
  }
  expect(
    repairOutcome({
      found: null,
      left: room,
      grown: true,
      repacked: 1,
      failed: null,
    }),
  ).toEqual({
    leftUnallocated: 2,
    leftMetadata: { size: 10, used: 4 },
    failed: null,
  })
  expect(
    repairOutcome({
      found: null,
      left: null,
      grown: false,
      repacked: 0,
      failed: "mount: no",
    }),
  ).toEqual({ leftUnallocated: null, leftMetadata: null, failed: "mount: no" })
})
