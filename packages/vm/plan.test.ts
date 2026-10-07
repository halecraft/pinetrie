import { describe, expect, test } from "vitest"
import {
  IMAGE_FILES,
  type ImageSources,
  imageDir,
  imageKey,
  imageRefusal,
  parseSums,
  planShares,
  planVm,
  type VmFacts,
  vmMemory,
  vmStateDir,
  vmWords,
} from "./plan.ts"

const sources: ImageSources = {
  "manifest.json": '{"alpine":"3.23"}',
  "build.sh": "build",
  init: "init",
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

describe("planShares: a slot's entries, and where each source is in the VM", () => {
  const dirs = [
    { source: "/p", readOnly: true },
    { source: "/p/.plans", readOnly: false },
    { source: "/opt/pinetrie", readOnly: true },
  ]
  test("named by a hash of the source, the same whatever the order", () => {
    const a = planShares(3, dirs)
    const b = planShares(3, [...dirs].reverse())
    expect(a.entries).toEqual(b.entries)
    for (const e of a.entries) expect(e.name).toMatch(/^[0-9a-f]{16}$/)
    expect(a.pathOf("/p")).toBe(
      `/mnt/host-shares/3/${a.entries.find(e => e.source === "/p")?.name}`,
    )
    expect(planShares(5, dirs).pathOf("/p")).toBe(
      a.pathOf("/p").replace("/3/", "/5/"),
    )
  })
  test("one entry per source, read-write if either is", () => {
    const { entries } = planShares(0, [
      { source: "/x", readOnly: true },
      { source: "/x", readOnly: false },
      { source: "/y", readOnly: true },
    ])
    expect(entries.map(e => [e.source, e.readOnly]).sort()).toEqual([
      ["/x", false],
      ["/y", true],
    ])
    expect(
      planShares(0, [
        { source: "/x", readOnly: false },
        { source: "/x", readOnly: true },
      ]).entries.map(e => e.readOnly),
    ).toEqual([false])
  })
  test("a path that is not a source is never mapped", () => {
    expect(() => planShares(0, dirs).pathOf("/etc")).toThrow(
      "/etc is not shared into slot 0",
    )
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
