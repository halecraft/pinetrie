import { describe, expect, test } from "vitest"
import {
  type Fill,
  holdFill,
  IMAGE_FILES,
  type ImageSources,
  imageDir,
  imageKey,
  imageRefusal,
  NOTHING_HELD,
  parseSums,
  planShares,
  planVm,
  planVmVersion,
  planWidening,
  type ShareDir,
  sharePath,
  slotRoot,
  staleVmWords,
  type VmFacts,
  vmMemory,
  vmStateDir,
  vmWords,
} from "./plan.ts"

const sources: ImageSources = {
  "manifest.json": '{"alpine":"3.23"}',
  "build.sh": "build",
  init: "init",
  clock: "clock",
  "stage1-init": "stage1",
}

test("imageKey: stable, and changed by any of the image's sources", () => {
  const key = imageKey(sources)
  expect(key).toMatch(/^[0-9a-f]{16}$/)
  expect(imageKey({ ...sources })).toBe(key)
  for (const name of IMAGE_FILES)
    expect(imageKey({ ...sources, [name]: `${sources[name]} ` })).not.toBe(key)
})

test("vmStateDir: under XDG_STATE_HOME, else ~/.local/state; images by key", () => {
  expect(vmStateDir({ XDG_STATE_HOME: "/s" }, "/h")).toBe("/s/pinetrie/vm")
  expect(vmStateDir({}, "/h")).toBe("/h/.local/state/pinetrie/vm")
  expect(imageDir("/s/pinetrie/vm", "abc")).toBe("/s/pinetrie/vm/images/abc")
})

describe("a built image is used only when SHA256SUMS holds", () => {
  const h = (c: string) => c.repeat(64)
  const sums = parseSums(
    `${h("a")}  Image\n${h("b")}  stage1.cpio\n${h("c")} *system.erofs\nnot a line\n`,
  )
  test("parseSums reads sha256sum's lines, text and binary", () => {
    expect([...sums]).toEqual([
      ["Image", h("a")],
      ["stage1.cpio", h("b")],
      ["system.erofs", h("c")],
    ])
  })
  test("each output must be there, named, with its hash", () => {
    const actual = {
      Image: h("a"),
      "stage1.cpio": h("b"),
      "system.erofs": h("c"),
    }
    expect(imageRefusal(sums, actual)).toBeNull()
    expect(imageRefusal(sums, { ...actual, Image: h("d") })).toBe(
      "Image does not match SHA256SUMS",
    )
    expect(imageRefusal(sums, { ...actual, "system.erofs": null })).toBe(
      "system.erofs is missing",
    )
    expect(imageRefusal(parseSums(""), actual)).toBe(
      "SHA256SUMS does not name Image",
    )
  })
})

test("vmMemory: a quarter of the Mac's, between 4 and 16 GiB", () => {
  const GiB = 1024 ** 3
  expect(vmMemory(32 * GiB)).toBe(8 * GiB)
  expect(vmMemory(8 * GiB)).toBe(4 * GiB)
  expect(vmMemory(128 * GiB)).toBe(16 * GiB)
})

describe("planShares: a slot's entries", () => {
  const dirs = [
    { source: "/p", readOnly: true },
    { source: "/p/.plans", readOnly: false },
    { source: "/opt/pinetrie", readOnly: true },
  ]
  test("named by a hash of the source, the same whatever the order", () => {
    const a = planShares(dirs)
    expect(a).toEqual(planShares([...dirs].reverse()))
    for (const e of a) expect(e.name).toMatch(/^[0-9a-f]{16}$/)
  })
  test("one entry per source, read-write if either is", () => {
    const entries = planShares([
      { source: "/x", readOnly: true },
      { source: "/x", readOnly: false },
      { source: "/y", readOnly: true },
    ])
    expect(entries.map(e => [e.source, e.readOnly]).sort()).toEqual([
      ["/x", false],
      ["/y", true],
    ])
    expect(
      planShares([
        { source: "/x", readOnly: false },
        { source: "/x", readOnly: true },
      ]).map(e => e.readOnly),
    ).toEqual([false])
  })
})

describe("holdings: which slots hold each source, and where it is in the VM", () => {
  const fill = (slot: number, dirs: readonly ShareDir[]): Fill => ({
    slot,
    entries: planShares(dirs),
  })
  const name = (source: string) =>
    planShares([{ source, readOnly: true }])[0]?.name
  test("a source is at its slot's root, under its entry's name", () => {
    const held = holdFill(
      NOTHING_HELD,
      fill(3, [{ source: "/p", readOnly: true }]),
    )
    expect(sharePath(held, "/p")).toBe(`/mnt/host-shares/3/${name("/p")}`)
    expect(slotRoot(3)).toBe("/mnt/host-shares/3/")
  })
  test("a source in two slots is taken from the one holding it read-write", () => {
    const ro = fill(1, [{ source: "/g", readOnly: true }])
    const rw = fill(4, [{ source: "/g", readOnly: false }])
    for (const order of [
      [ro, rw],
      [rw, ro],
    ])
      expect(sharePath(order.reduce(holdFill, NOTHING_HELD), "/g")).toBe(
        `/mnt/host-shares/4/${name("/g")}`,
      )
  })
  test("a second slot of one kind is never recorded: the first keeps the source", () => {
    const held = [
      fill(1, [{ source: "/g", readOnly: false }]),
      fill(2, [{ source: "/g", readOnly: false }]),
    ].reduce(holdFill, NOTHING_HELD)
    expect(held.get("/g")).toEqual({ readOnly: null, readWrite: 1 })
  })
  test("a path no slot holds is never mapped", () => {
    const held = holdFill(
      NOTHING_HELD,
      fill(0, [{ source: "/p", readOnly: true }]),
    )
    expect(() => sharePath(held, "/etc")).toThrow(
      "/etc is not shared into this host's slots",
    )
  })
})

describe("planWidening: what a new slot must share", () => {
  const held = holdFill(NOTHING_HELD, {
    slot: 0,
    entries: planShares([
      { source: "/p", readOnly: true },
      { source: "/p/.plans", readOnly: false },
      { source: "/g", readOnly: true },
    ]),
  })
  test("nothing, when every wanted directory is held as wanted", () => {
    expect(
      planWidening(held, [
        { source: "/p", readOnly: true },
        { source: "/p/.plans", readOnly: false },
      ]),
    ).toEqual([])
  })
  test("a directory no fill holds", () => {
    expect(
      planWidening(held, [
        { source: "/p", readOnly: true },
        { source: "/p/docs", readOnly: false },
      ]),
    ).toEqual([{ source: "/p/docs", readOnly: false }])
  })
  test("a directory held read-only, now wanted read-write", () => {
    expect(planWidening(held, [{ source: "/g", readOnly: false }])).toEqual([
      { source: "/g", readOnly: false },
    ])
  })
  test("a directory held read-write, wanted read-only: nothing", () => {
    expect(
      planWidening(held, [{ source: "/p/.plans", readOnly: true }]),
    ).toEqual([])
  })
  test("a directory no longer wanted: nothing", () => {
    expect(planWidening(held, [])).toEqual([])
  })
})

describe("planVm: start, join, or the reason it cannot", () => {
  const ok: VmFacts = {
    platform: "darwin",
    arch: "arm64",
    darwin: 25,
    answering: false,
    image: true,
    launcher: "built",
  }
  test("a running VM is joined; else one is started", () => {
    expect(planVm(ok)).toEqual({ kind: "start" })
    expect(planVm({ ...ok, launcher: "buildable" })).toEqual({ kind: "start" })
    expect(
      planVm({ ...ok, answering: true, image: false, launcher: "no-swiftc" }),
    ).toEqual({ kind: "join" })
  })
  test("each refusal, worded with its fix", () => {
    const words = (f: Partial<VmFacts>) => {
      const p = planVm({ ...ok, ...f })
      return p.kind === "refused" ? vmWords(p.refusal) : ""
    }
    expect(words({ platform: "linux" })).toContain("only on the Mac")
    expect(words({ arch: "x64" })).toContain("Apple silicon")
    expect(words({ darwin: 21 })).toContain("macOS 13")
    expect(words({ image: false })).toContain("pnpm vm:build")
    expect(words({ launcher: "no-swiftc" })).toContain("xcode-select --install")
  })
})

describe("planVmVersion: join a current VM; replace an old one only when no other host holds it", () => {
  const want = { image: "new", launcher: "launcher-new" }
  test("current", () => {
    expect(planVmVersion({ ...want, leases: 3 }, want)).toEqual({
      kind: "current",
    })
  })
  test("an older image or launcher, this host its only lease: retire it", () => {
    expect(planVmVersion({ ...want, image: "old", leases: 1 }, want)).toEqual({
      kind: "retire",
    })
    expect(
      planVmVersion({ ...want, launcher: "launcher-old", leases: 1 }, want),
    ).toEqual({ kind: "retire" })
  })
  test("a launcher older than its identity: join it, and say how to replace it", () => {
    expect(
      planVmVersion({ image: null, launcher: null, leases: null }, want),
    ).toEqual({ kind: "old-launcher" })
  })
  test("older, with other hosts on it: join it, and say so", () => {
    const v = planVmVersion({ ...want, image: "old", leases: 3 }, want)
    expect(v).toEqual({ kind: "stale", leases: 3 })
    expect(staleVmWords(3, "new")).toContain("2 other hosts hold leases")
  })
})
