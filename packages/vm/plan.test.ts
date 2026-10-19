import { describe, expect, test } from "vitest"
import {
  type BuilderPins,
  changedImageFiles,
  type Fill,
  holdFill,
  IMAGE_FILES,
  type ImageSources,
  imageDir,
  imageKey,
  imageRefusal,
  imageSourceSums,
  isBuildLogLine,
  kernelRelease,
  launcherArgs,
  launcherFromCommandLine,
  NOTHING_HELD,
  otherHolders,
  parseSums,
  planLock,
  planPrune,
  planShares,
  planVm,
  planVmBuild,
  planVmBuildRun,
  planVmVersion,
  planWidening,
  type ShareDir,
  sharePath,
  slotRoot,
  type VmBuildFacts,
  type VmChange,
  type VmFacts,
  vmBuildWords,
  vmChangeWords,
  vmHostRefusal,
  vmKeptWords,
  vmMemory,
  vmNoneRunningWords,
  vmStartRefusal,
  vmStateDir,
  vmVersionWords,
  vmWords,
} from "./plan.ts"

const sources: ImageSources = {
  "manifest.json": '{"alpine":"3.23"}',
  "build.sh": "build",
  init: "init",
  clock: "clock",
  "stage1-init": "stage1",
  "daemon.json": "{}",
}

test("imageKey: stable, and changed by any of the image's sources", () => {
  const key = imageKey(sources)
  expect(key).toMatch(/^[0-9a-f]{16}$/)
  expect(imageKey({ ...sources })).toBe(key)
  for (const name of IMAGE_FILES)
    expect(imageKey({ ...sources, [name]: `${sources[name]} ` })).not.toBe(key)
})

test("Docker's daemon.json is one of the image's sources", () => {
  expect(IMAGE_FILES).toContain("daemon.json")
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

test("launcherArgs: the disks flush with fsync and cache their reads, after the slots, a quarter of the Mac's memory, the CPUs and gvproxy", () => {
  const GiB = 1024 ** 3
  expect(
    launcherArgs({
      stateDir: "/state",
      image: "/state/images/key",
      slots: 16,
      macMemory: 32 * GiB,
      cpus: 12,
      gvproxy: "/state/bin/gvproxy-x",
    }),
  ).toEqual([
    "/state",
    "/state/images/key",
    "16",
    String(8 * GiB),
    "12",
    "/state/bin/gvproxy-x",
    "fsync",
    "cached",
  ])
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
    builder: "built",
  }
  test("a running VM is joined; else one is started", () => {
    expect(planVm(ok)).toEqual({ kind: "start", buildImage: false })
    expect(planVm({ ...ok, launcher: "buildable" })).toEqual({
      kind: "start",
      buildImage: false,
    })
    expect(
      planVm({ ...ok, answering: true, image: false, launcher: "no-swiftc" }),
    ).toEqual({ kind: "join" })
  })
  test("a missing image is built before the VM starts", () => {
    expect(planVm({ ...ok, image: false })).toEqual({
      kind: "start",
      buildImage: true,
    })
    expect(planVm({ ...ok, image: false, builder: "buildable" })).toEqual({
      kind: "start",
      buildImage: true,
    })
  })
  test("a missing image with no way to build its builder is refused", () => {
    expect(planVm({ ...ok, image: false, builder: "no-swiftc" })).toEqual({
      kind: "refused",
      refusal: "no-swiftc",
    })
    expect(planVm({ ...ok, builder: "no-swiftc" })).toEqual({
      kind: "start",
      buildImage: false,
    })
  })
  test("each refusal, worded with its fix", () => {
    const words = (f: Partial<VmFacts>) => {
      const p = planVm({ ...ok, ...f })
      return p.kind === "refused" ? vmWords(p.refusal) : ""
    }
    expect(words({ platform: "linux" })).toContain("only on the Mac")
    expect(words({ arch: "x64" })).toContain("Apple silicon")
    expect(words({ darwin: 21 })).toContain("macOS 13")
    expect(words({ launcher: "no-swiftc" })).toContain("xcode-select --install")
  })
  test("vmStartRefusal: what keeps this host from replacing an older VM", () => {
    expect(vmStartRefusal(ok)).toBeNull()
    expect(vmStartRefusal({ ...ok, image: false })).toBeNull()
    expect(vmStartRefusal({ ...ok, image: false, builder: "no-swiftc" })).toBe(
      "no-swiftc",
    )
    expect(vmStartRefusal({ ...ok, platform: "linux" })).toBe("not-mac")
  })
})

describe("planVmBuild: whether vm:build builds here", () => {
  const ok: VmBuildFacts = {
    host: null,
    image: false,
    builder: "built",
    force: false,
  }
  test("a missing image is built; a whole one is present unless forced", () => {
    expect(planVmBuild(ok)).toEqual({ kind: "build" })
    expect(planVmBuild({ ...ok, image: true })).toEqual({ kind: "present" })
    expect(planVmBuild({ ...ok, image: true, force: true })).toEqual({
      kind: "build",
    })
  })
  test("where no lane VM runs, nothing is needed, and forcing is refused", () => {
    for (const host of ["not-mac", "not-apple-silicon", "old-macos"] as const) {
      expect(planVmBuild({ ...ok, host })).toEqual({
        kind: "not-needed",
        why: host,
      })
      expect(planVmBuild({ ...ok, host, force: true })).toEqual({
        kind: "refused",
        why: { kind: "forced", host },
      })
    }
  })
  test("a builder that cannot be compiled is refused", () => {
    expect(planVmBuild({ ...ok, builder: "no-swiftc" })).toEqual({
      kind: "refused",
      why: { kind: "no-swiftc" },
    })
  })
  test("vmBuildWords: why nothing is built names --force", () => {
    const words = vmBuildWords(
      { kind: "not-needed", why: "not-mac" },
      { compile: false, fetch: false },
    )
    expect(words).toContain("on Linux, lanes use the host's Docker")
    expect(words).toContain("--force")
  })
  test("vmBuildWords: a build says what it does first", () => {
    const build = { kind: "build" } as const
    expect(vmBuildWords(build, { compile: false, fetch: false })).toBe(
      "building the lane VM's image (about 20 s)",
    )
    expect(vmBuildWords(build, { compile: true, fetch: true })).toBe(
      "building the lane VM's image: compiling its builder and fetching Alpine's kernel and root, 43 MB, once, then about 20 s",
    )
  })
})

test("vmHostRefusal: the Mac with Apple silicon on macOS 13 or later", () => {
  const mac = { platform: "darwin", arch: "arm64", darwin: 22 } as const
  expect(vmHostRefusal(mac)).toBeNull()
  expect(vmHostRefusal({ ...mac, platform: "linux" })).toBe("not-mac")
  expect(vmHostRefusal({ ...mac, arch: "x64" })).toBe("not-apple-silicon")
  expect(vmHostRefusal({ ...mac, darwin: 21 })).toBe("old-macos")
})

test("planLock: take a free lock, wait on a live holder, break a dead one's", () => {
  expect(planLock({ holder: null, alive: false })).toBe("take")
  expect(planLock({ holder: 7, alive: true })).toBe("wait")
  expect(planLock({ holder: 7, alive: false })).toBe("break")
})

describe("planPrune: what a build leaves behind", () => {
  const state = "/s"
  const entry = (p: string, owner: number | null = null) => ({
    path: `${state}/${p}`,
    owner,
  })
  const base = {
    current: new Set(["key", "launcher-new"]),
    running: [] as string[],
    alive: (pid: number) => pid === 1,
  }
  test("what is not current goes; what is current stays", () => {
    expect(
      planPrune({
        ...base,
        entries: [
          entry("images/key"),
          entry("images/old"),
          entry("bin/launcher-old"),
        ],
      }),
    ).toEqual(["/s/images/old", "/s/bin/launcher-old"])
  })
  test("what a running launcher names stays, from any state directory", () => {
    expect(
      planPrune({
        ...base,
        entries: [entry("images/old"), entry("bin/launcher-old")],
        running: [
          "/tmp/pc-1/pinetrie/vm/bin/launcher-old /tmp/pc-1/pinetrie/vm /tmp/pc-1/pinetrie/vm/images/old 16",
        ],
      }),
    ).toEqual([])
  })
  test("a dead process's half-written entries go; a live one's stay", () => {
    expect(
      planPrune({
        ...base,
        entries: [
          entry("images/key.tmp-1", 1),
          entry("images/key.tmp-2", 2),
          entry("images/key.lock", 2),
        ],
      }),
    ).toEqual(["/s/images/key.tmp-2", "/s/images/key.lock"])
  })
})

describe("planVmBuildRun: a build as paths and arguments", () => {
  const pins: BuilderPins = {
    kernel: {
      version: "6.18.56-r0",
      url: "https://x/linux-virt.apk",
      sha256: "a",
    },
    root: { version: "3.23.6", url: "https://x/root.tar.gz", sha256: "b" },
    modules: [
      "net/core/failover.ko.gz",
      "drivers/char/hw_random/virtio-rng.ko.gz",
    ],
  }
  const run = planVmBuildRun({
    stateDir: "/s",
    key: "k",
    pins,
    pid: 9,
    cpus: 4,
    kernel: "/s/builder/Image-a",
  })
  test("the modules, from the kernel's release, in load order", () => {
    expect(run.modules).toEqual([
      {
        entry: "lib/modules/6.18.56-0-virt/kernel/net/core/failover.ko.gz",
        as: "failover.ko",
      },
      {
        entry:
          "lib/modules/6.18.56-0-virt/kernel/drivers/char/hw_random/virtio-rng.ko.gz",
        as: "virtio-rng.ko",
      },
    ])
    expect(run.order).toBe("failover.ko\nvirtio-rng.ko\n")
  })
  test("a scratch beside the image, and the lock", () => {
    expect(run.image).toBe("/s/images/k")
    expect(run.scratch).toBe("/s/images/k.tmp-9")
    expect(run.lock).toBe("/s/images/k.lock")
  })
  test("the builder boots the kernel and initrd with a 1 GiB disk and 1 GiB, its console on stdout", () => {
    expect(run.disk).toEqual({
      path: "/s/images/k.tmp-9/out.img",
      bytes: 1024 ** 3,
    })
    expect(run.builderArgs).toEqual([
      "/s/builder/Image-a",
      "/s/images/k.tmp-9/initrd.cpio",
      "/s/images/k.tmp-9/out.img",
      String(1024 ** 3),
      "4",
      "-",
    ])
  })
  test("a kernel version with no release is refused", () => {
    expect(() => kernelRelease("6.18.56")).toThrow("no -r release")
  })
})

test("isBuildLogLine: the build's and the builder's lines", () => {
  expect(isBuildLogLine("[vm-build] installed: x")).toBe(true)
  expect(isBuildLogLine("[builder] built")).toBe(true)
  expect(isBuildLogLine("[    0.07] rtc-pl031 registered")).toBe(false)
})

describe("an image's record of its sources", () => {
  const built = parseSums(imageSourceSums(sources))
  test("a record written by imageSourceSums reads back through parseSums, one line per source", () => {
    expect([...built.keys()]).toEqual([...IMAGE_FILES])
    expect(changedImageFiles(built, built)).toEqual([])
  })
  test("changedImageFiles lists the files whose hashes differ, in order; a file in one record only counts; null without a running record", () => {
    const running = parseSums(
      imageSourceSums({ ...sources, "daemon.json": "{ }", init: "old" }),
    )
    expect(changedImageFiles(running, built)).toEqual(["init", "daemon.json"])
    const fewer = new Map([...built].filter(([name]) => name !== "clock"))
    expect(changedImageFiles(fewer, built)).toEqual(["clock"])
    expect(changedImageFiles(null, built)).toBeNull()
  })
})

test("launcherFromCommandLine reads this state directory's launcher only", () => {
  const line = (state: string) =>
    `/s m/bin/launcher-0a1b ${state} ${state}/images/k1 16 4294967296 8 /s m/bin/gvproxy-x fsync cached`
  expect(launcherFromCommandLine(line("/s m"), "/s m")).toEqual({
    image: "k1",
    launcher: "launcher-0a1b",
  })
  expect(
    launcherFromCommandLine(line("/tmp/pc-1/pinetrie/vm"), "/s m"),
  ).toBeNull()
  expect(launcherFromCommandLine(line("/s m/x"), "/s m")).toBeNull()
  expect(launcherFromCommandLine("/usr/bin/vim notes", "/s m")).toBeNull()
})

describe("planVmVersion: join a current VM; replace an old one only when no other host holds it", () => {
  const want = { image: "new", launcher: "launcher-new" }
  const plan = (
    running: { image: string | null; launcher: string | null },
    othersHolding: number | null,
    retirable = true,
  ) =>
    planVmVersion({
      running,
      retirable,
      want,
      othersHolding,
      changedFiles: ["init"],
    })
  test("current", () => {
    expect(plan(want, 2)).toEqual({ kind: "current", image: "new" })
  })
  test("an older image or launcher, held by no other host: retire it", () => {
    expect(plan({ ...want, image: "old" }, 0)).toEqual({
      kind: "retire",
      change: {
        from: { ...want, image: "old" },
        to: want,
        changedFiles: ["init"],
      },
    })
    expect(plan({ ...want, launcher: "launcher-old" }, 0).kind).toBe("retire")
  })
  test("a leasing host's own lease is not another's, and vm:build holds none", () => {
    expect(otherHolders(1, "host")).toBe(0)
    expect(otherHolders(1, "build")).toBe(1)
    expect(otherHolders(null, "host")).toBeNull()
    expect(plan({ ...want, image: "old" }, otherHolders(1, "host")).kind).toBe(
      "retire",
    )
  })
  test("older, with other hosts on it: join it, and say so", () => {
    expect(plan({ ...want, image: "old" }, 2)).toMatchObject({
      kind: "stale",
      others: 2,
    })
  })
  test("holders unknown from a launcher that can be retired: replaced by a host holding it alone", () => {
    expect(plan({ ...want, image: "old" }, null).kind).toBe("holders-unknown")
    expect(plan({ image: null, launcher: null }, null).kind).toBe(
      "holders-unknown",
    )
  })
  test("a launcher older than its identity: join it, and say how to replace it", () => {
    expect(plan({ image: null, launcher: null }, null, false).kind).toBe(
      "old-launcher",
    )
  })
})

describe("vmVersionWords: both images and what differs, for a host and for vm:build", () => {
  const change = (c: Partial<VmChange>): VmChange => ({
    from: { image: "aaaa", launcher: "launcher-old" },
    to: { image: "bbbb", launcher: "launcher-old" },
    changedFiles: ["init", "daemon.json"],
    ...c,
  })
  test("the changed files, an older launcher, or unrecorded sources", () => {
    expect(vmChangeWords(change({}))).toBe(
      "image aaaa rather than bbbb, in which init and daemon.json differ",
    )
    expect(
      vmChangeWords(
        change({
          from: { image: "bbbb", launcher: "launcher-old" },
          to: { image: "bbbb", launcher: "launcher-new" },
        }),
      ),
    ).toBe("image bbbb, and its launcher is older")
    expect(vmChangeWords(change({ changedFiles: null }))).toBe(
      "image aaaa rather than bbbb, whose sources were not recorded",
    )
  })
  test("a host replacing, joining or keeping it", () => {
    const c = change({})
    expect(vmVersionWords({ kind: "retire", change: c }, "host")).toBe(
      "the lane VM runs image aaaa rather than bbbb, in which init and daemon.json differ: this host replaces it now",
    )
    expect(
      vmVersionWords({ kind: "stale", change: c, others: 1 }, "host"),
    ).toContain(
      "in which init and daemon.json differ, and 1 other host holds a lease on it: this host joins it",
    )
    expect(vmKeptWords(c, "no tools")).toBe(
      "the lane VM runs image aaaa rather than bbbb, in which init and daemon.json differ, kept: no tools",
    )
  })
  test("vm:build saying when it is replaced", () => {
    const c = change({})
    expect(vmVersionWords({ kind: "current", image: "bbbb" }, "build")).toBe(
      "the lane VM runs bbbb, this image",
    )
    expect(vmVersionWords({ kind: "retire", change: c }, "build")).toMatch(
      /init and daemon\.json differ: the next host to start replaces it$/,
    )
    expect(
      vmVersionWords({ kind: "stale", change: c, others: 2 }, "build"),
    ).toMatch(
      /and 2 hosts hold leases on it: it is replaced once the last of them stops$/,
    )
    expect(
      vmVersionWords({ kind: "holders-unknown", change: c }, "build"),
    ).toContain("at the start of a host that holds it alone")
    expect(
      vmVersionWords({ kind: "old-launcher", change: c }, "build"),
    ).toContain("stops by itself 10 minutes after its last host")
    expect(vmNoneRunningWords("bbbb")).toBe(
      "no lane VM is running: the next host starts it from bbbb",
    )
  })
})
