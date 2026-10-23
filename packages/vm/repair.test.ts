import { describe, expect, test } from "vitest"
import { type BuilderPins, planPrune } from "./plan.ts"
import {
  parseRepairLine,
  planRepairBoot,
  type RepairLine,
  repairBootNames,
  repairReport,
} from "./repair.ts"

/** A repair boot's console on a 24 GiB disk, as it printed it. */
const CONSOLE =
  `[    0.512] virtio_blk virtio1: [vda] 50331648 512-byte logical blocks
[repair] module loop.ko not loaded
[repair] found size=25769803776 unallocated=20912799744 metadata-size=268435456 metadata-used=35799040
[repair] grown: Resize device id 1 (/dev/vda) from 24.00GiB to max
[repair] repacked at 0%: Done, had to relocate 1 out of 7 chunks
[repair] repacked at 5%: Done, had to relocate 0 out of 6 chunks
[repair] repacked at 40%: Done, had to relocate 1 out of 6 chunks
[repair] left size=25769803776 unallocated=21986541568 metadata-size=268435456 metadata-used=36143104
[repair] done`.split("\n")

const parsed = (lines: readonly string[]): RepairLine[] =>
  lines.flatMap(l => parseRepairLine(l) ?? [])

describe("parseRepairLine", () => {
  test("reads the protocol's lines, and none of the boot's own notes", () => {
    expect(parsed(CONSOLE).map(l => l.kind)).toEqual([
      "found",
      "grown",
      "repacked",
      "repacked",
      "repacked",
      "left",
      "done",
    ])
  })
  test("reads a room's bytes past 2³¹ exactly", () => {
    expect(parseRepairLine(CONSOLE[2] ?? "")).toEqual({
      kind: "found",
      room: {
        size: 25_769_803_776,
        unallocated: 20_912_799_744,
        metadataSize: 268_435_456,
        metadataUsed: 35_799_040,
      },
    })
  })
  test("a repack that failed has no count, and keeps btrfs's words", () => {
    expect(
      parseRepairLine(
        "[repair] repacked at 5%: ERROR: error during balancing '/mnt': No space left on device",
      ),
    ).toEqual({
      kind: "repacked",
      percent: 5,
      relocated: null,
      words: "ERROR: error during balancing '/mnt': No space left on device",
    })
  })
  test("a failure keeps everything after its first colon", () => {
    expect(
      parseRepairLine("[repair] failed: mount: wrong fs type: /dev/vda"),
    ).toEqual({ kind: "failed", words: "mount: wrong fs type: /dev/vda" })
  })
  test("a room it cannot read is no line", () => {
    expect(parseRepairLine("[repair] found size= unallocated=")).toBeNull()
  })
})

describe("repairReport", () => {
  test("a boot that said done: its rooms, its growth and the chunks it moved", () => {
    const report = repairReport(parsed(CONSOLE))
    expect(report.failed).toBeNull()
    expect(report.grown).toBe(true)
    expect(report.repacked).toBe(2)
    expect(report.found?.unallocated).toBe(20_912_799_744)
    expect(report.left?.unallocated).toBe(21_986_541_568)
  })
  test("a boot that said failed is failed, with its words", () => {
    expect(
      repairReport(parsed(["[repair] failed: mount: bad superblock"])).failed,
    ).toBe("mount: bad superblock")
  })
  test("a boot that stopped without saying done is failed", () => {
    expect(repairReport(parsed(CONSOLE.slice(0, -1))).failed).toBe(
      "the repair boot stopped before it said it was done",
    )
  })
})

const PINS: BuilderPins = {
  kernel: {
    version: "6.18.58-r0",
    url: "https://x/linux-virt.apk",
    sha256: "k",
  },
  root: { version: "3.23.7", url: "https://x/root.tar.gz", sha256: "r" },
  modules: ["drivers/block/virtio_blk.ko.gz"],
  repair: {
    packages: [
      {
        name: "btrfs-progs",
        version: "6.17.1-r0",
        url: "https://x/btrfs-progs-6.17.1-r0.apk",
        sha256: "b",
      },
      {
        name: "lzo",
        version: "2.10-r5",
        url: "https://x/lzo-2.10-r5.apk",
        sha256: "l",
      },
    ],
    modules: ["fs/btrfs/btrfs.ko.gz"],
  },
}

describe("planRepairBoot", () => {
  const plan = (pins: BuilderPins, init: string) =>
    planRepairBoot({ stateDir: "/s", pins, init, pid: 7 })
  test("its initrd is named by everything in it", () => {
    const base = plan(PINS, "init").initrd
    expect(base).toMatch(/^\/s\/builder\/repair-[0-9a-f]{16}\.cpio$/)
    expect(plan(PINS, "init").initrd).toBe(base)
    expect(plan(PINS, "other init").initrd).not.toBe(base)
    const lzo = PINS.repair.packages[1]
    if (lzo === undefined) throw new Error("no second package")
    const repinned = {
      ...PINS,
      repair: {
        ...PINS.repair,
        packages: [PINS.repair.packages[0], { ...lzo, sha256: "l2" }],
      },
    } as BuilderPins
    expect(plan(repinned, "init").initrd).not.toBe(base)
  })
  test("loads the builder's modules, then the repair's", () => {
    expect(plan(PINS, "init").modules.map(m => m.as)).toEqual([
      "virtio_blk.ko",
      "btrfs.ko",
    ])
  })
  test("a prune keeps its initrd and every package, and an older initrd goes", () => {
    const repair = plan(PINS, "init")
    const old = plan(PINS, "old init").initrd
    const entries = [
      repair.initrd,
      old,
      ...repair.packages.map(p => `/s/builder/${p.url.split("/").pop()}`),
    ]
    expect(
      planPrune({
        entries: entries.map(path => ({ path, owner: null })),
        current: new Set(repairBootNames(repair)),
        running: [],
        alive: () => true,
      }),
    ).toEqual([old])
  })
})
