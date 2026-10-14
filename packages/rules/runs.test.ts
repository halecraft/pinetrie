import {
  type DiskPath,
  diskPath,
  type RunEvent,
  type RunNotice,
  type RunTrace,
  type RunTraces,
  stamp,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  checkRecipe,
  dirtyPaths,
  drainLane,
  drainRun,
  foldRunEvents,
  laneFold,
  newRunTrace,
  tracesWithCommands,
} from "./runs.ts"

/** A test's output path, checked. */
const checkedPath = (p: string): DiskPath => {
  const checked = diskPath(p)
  if (checked === null) throw new Error(`${p} leaves the disk`)
  return checked
}

const ROOT = "/workspace"
const LANE = { root: ROOT, shared: [] }
const SHARED_LANE = { root: ROOT, shared: [".plans"] }
const trace = (): RunTrace => newRunTrace({ id: "r1", command: "make" })

const O_RDONLY = 0
const O_WRONLY_CREAT_TRUNC = 0o1101
const O_RDWR = 2

let clock = 0
const call = (
  op: Extract<RunEvent, { kind: "call" }>["op"],
  path: string,
  before: "file" | "dir" | "missing" = "missing",
  more: Partial<Extract<RunEvent, { kind: "call" }>> = {},
): RunEvent => ({
  kind: "call",
  op,
  at: ++clock,
  pid: 7,
  flags: 0,
  before,
  path: `${ROOT}/${path}`,
  before2: "missing",
  path2: "",
  stamp: null,
  raced: null,
  ...more,
})

const drained = (t: RunTrace, present: readonly string[]) =>
  drainRun(t, new Set(present))

describe("foldRunEvents and drainRun", () => {
  test("a file made where nothing was is a created write", () => {
    const t = foldRunEvents(LANE, trace(), [
      call("open", "out.js", "missing", { flags: O_WRONLY_CREAT_TRUNC }),
    ])
    expect(drained(t, ["out.js"]).record?.writes).toEqual([
      { path: "out.js", created: true, dir: false },
    ])
  })

  test("a file rewritten in place is a write, not created, and not a read", () => {
    const t = foldRunEvents(LANE, trace(), [
      call("open", "a.json", "file", { flags: O_RDWR }),
      call("open", "a.json", "file", { flags: O_RDONLY }),
    ])
    const { record } = drained(t, ["a.json"])
    expect(record?.writes).toEqual([
      { path: "a.json", created: false, dir: false },
    ])
    expect(record?.reads).toEqual([])
  })

  test("a file read before the run wrote it is a read", () => {
    const t = foldRunEvents(LANE, trace(), [
      call("open", "src/a.ts", "file"),
      call("open", "src/a.ts", "file", { flags: O_WRONLY_CREAT_TRUNC }),
    ])
    expect(drained(t, ["src/a.ts"]).record?.reads).toEqual(["src/a.ts"])
  })

  test("a lookup of a missing file is a failed lookup, and its later making is not", () => {
    const t = foldRunEvents(LANE, trace(), [
      call("open", ".npmrc"),
      call("open", "made", "missing", { flags: O_WRONLY_CREAT_TRUNC }),
      call("open", "made", "missing"),
    ])
    expect(drained(t, ["made"]).record?.missing).toEqual([".npmrc"])
  })

  test("a temporary file renamed into place writes only its target", () => {
    const t = foldRunEvents(LANE, trace(), [
      call("open", "pkg.json.tmp", "missing", { flags: O_WRONLY_CREAT_TRUNC }),
      call("rename", "pkg.json.tmp", "file", {
        path2: `${ROOT}/pkg.json`,
        before2: "file",
      }),
    ])
    const { record } = drained(t, ["pkg.json"])
    expect(record?.writes).toEqual([
      { path: "pkg.json", created: false, dir: false },
    ])
    expect(record?.deletions).toEqual([])
  })

  test("a file there before the run and gone after is a deletion", () => {
    const t = foldRunEvents(LANE, trace(), [call("unlink", "old.js", "file")])
    expect(drained(t, []).record?.deletions).toEqual(["old.js"])
  })

  test("what a run makes under a directory it renames is under the new name", () => {
    const t = foldRunEvents(LANE, trace(), [
      call("mkdir", "tmp-x"),
      call("open", "tmp-x/a", "missing", { flags: O_WRONLY_CREAT_TRUNC }),
      call("rename", "tmp-x", "dir", { path2: `${ROOT}/node_modules/x` }),
    ])
    expect(
      drained(t, ["node_modules/x", "node_modules/x/a"]).record?.writes,
    ).toEqual([
      { path: "node_modules/x", created: true, dir: true },
      { path: "node_modules/x/a", created: true, dir: false },
    ])
  })

  test("paths outside the lane's directory are not reported", () => {
    const t = foldRunEvents(LANE, trace(), [
      call("open", "x", "missing", {
        path: "/tmp/x",
        flags: O_WRONLY_CREAT_TRUNC,
      }),
      call("open", "y", "missing", {
        path: "/workspace/../etc/y",
        flags: O_WRONLY_CREAT_TRUNC,
      }),
    ])
    expect(drained(t, ["../tmp/x", "../etc/y"]).record?.writes).toEqual([])
  })

  test("a daemon's writes after a drain come at the next, its own deletion of them too", () => {
    const first = drained(
      foldRunEvents(LANE, trace(), [
        { kind: "exit", at: 1, status: 0 },
        call("open", "dev.log", "missing", { flags: O_WRONLY_CREAT_TRUNC }),
      ]),
      ["dev.log"],
    )
    expect(first.record).toMatchObject({ exit: 0, alive: true })
    const later = foldRunEvents(LANE, first.trace, [
      call("open", "cache/x", "missing", { flags: O_WRONLY_CREAT_TRUNC }),
      call("unlink", "dev.log", "file"),
      { kind: "end", at: 9 },
    ])
    const second = drained(later, ["cache/x"])
    expect(second.record).toMatchObject({
      alive: false,
      writes: [{ path: "cache/x", created: true, dir: false }],
      deletions: ["dev.log"],
    })
    expect(drained(second.trace, []).record).toBeNull()
  })

  test("a shared file's open and release carry their stamps", () => {
    const t = foldRunEvents(SHARED_LANE, trace(), [
      call("open", ".plans/p.md", "file", {
        flags: O_RDWR,
        stamp: stamp("2:3"),
      }),
      call("release", ".plans/p.md", "file", {
        flags: O_RDWR,
        stamp: stamp("4:5"),
      }),
      call("open", "src/a.ts", "file", { stamp: stamp("9:9") }),
    ])
    expect(drained(t, [".plans/p.md"]).record?.shared).toEqual([
      {
        path: ".plans/p.md",
        kind: "open",
        writable: true,
        append: false,
        at: clock - 2,
        pid: 7,
        stamp: "2:3",
      },
      {
        path: ".plans/p.md",
        kind: "release",
        writable: true,
        append: false,
        at: clock - 1,
        pid: 7,
        left: { kind: "stamp", stamp: "4:5" },
      },
    ])
  })

  test("a release whose kernel stamp disagreed is raced, with both stamps", () => {
    const t = foldRunEvents(SHARED_LANE, trace(), [
      call("release", ".plans/p.md", "file", {
        flags: O_RDWR,
        stamp: stamp("4:5"),
        raced: stamp("4:4"),
      }),
    ])
    expect(drained(t, []).record?.shared[0]).toMatchObject({
      kind: "release",
      left: { kind: "raced", stamp: "4:5", kernel: "4:4" },
    })
  })

  test("a run that lost events is recorded lost, for good", () => {
    const t = foldRunEvents(LANE, trace(), [{ kind: "lost", at: 1, count: 3 }])
    const first = drained(t, [])
    expect(first.record?.observed).toEqual({ kind: "lost", events: 3 })
    const later = foldRunEvents(LANE, first.trace, [
      call("open", "x", "missing", { flags: O_WRONLY_CREAT_TRUNC }),
    ])
    expect(drained(later, ["x"]).record?.observed).toEqual({
      kind: "lost",
      events: 3,
    })
  })
})

describe("a lane's drain", () => {
  const tools = { toolWrites: [], toolShared: [] }
  const made = (run: string, p: string): RunNotice => ({
    run,
    event: call("open", p, "missing", { flags: O_WRONLY_CREAT_TRUNC }),
  })
  const fold = laneFold(LANE)

  test("a launched run carries its command, its notices and its exit", () => {
    const traces = tracesWithCommands(
      fold(new Map(), [
        made("r1", "out"),
        { run: "r1", event: { kind: "exit", at: 9, status: 2 } },
      ]),
      [
        { run: "r1", command: "make" },
        { run: "r2", command: "idle" },
      ],
    )
    expect(dirtyPaths(traces)).toEqual(["out"])
    const { runs } = drainLane(traces, new Set(["out"]), tools)
    expect(runs.runs).toEqual([
      expect.objectContaining({
        id: "r1",
        command: "make",
        exit: 2,
        writes: [{ path: "out", created: true, dir: false }],
      }),
      expect.objectContaining({ id: "r2", command: "idle", writes: [] }),
    ])
  })

  test("a notice of a run never seen launched starts one with no command", () => {
    const traces = tracesWithCommands(fold(new Map(), [made("old", "x")]), [])
    expect(traces.get("old")?.command).toBeNull()
  })

  test("an ended run's trace goes after its drain; a live one stays", () => {
    const traces = tracesWithCommands(
      fold(new Map(), [{ run: "a", event: { kind: "end", at: 1 } }]),
      [
        { run: "a", command: "a" },
        { run: "b", command: "b" },
      ],
    )
    expect([...drainLane(traces, new Set(), tools).traces.keys()]).toEqual([
      "b",
    ])
  })

  test("runs drain in launch order, whatever order their events came in", () => {
    const traces = fold(new Map(), [
      made("10240", "c"),
      made("2048", "b"),
      made("1024", "a"),
    ])
    const { runs } = drainLane(traces, new Set(["a", "b", "c"]), tools)
    expect(runs.runs.map(r => r.id)).toEqual(["1024", "2048", "10240"])
  })

  test("paths outside the lane leave nothing in its trace", () => {
    const notices = Array.from({ length: 10_000 }, (_, i) => ({
      run: "1024",
      event: call("open", "x", "file", { path: `/tmp/f${i % 100}` }),
    }))
    expect(fold(new Map(), notices).get("1024")?.paths.size).toBe(0)
  })

  test("the tools' writes and shared accesses pass through", () => {
    const { runs } = drainLane(new Map(), new Set(), {
      toolWrites: ["t"],
      toolShared: [],
    })
    expect(runs).toEqual({ runs: [], toolWrites: ["t"], toolShared: [] })
  })
})

describe("laneFold", () => {
  /** A seeded generator, so a failing sequence is the same every run. */
  const random = (seed: number) => {
    let s = seed
    return () => {
      s = (s * 1103515245 + 12345) % 2 ** 31
      return s / 2 ** 31
    }
  }
  const PATHS = [
    `${ROOT}/a`,
    `${ROOT}/b`,
    `${ROOT}/d`,
    `${ROOT}/d/x`,
    `${ROOT}/d/y`,
    `${ROOT}/e/z`,
    `${ROOT}/.plans/p.md`,
    "/tmp/t",
    "/etc/u",
  ]
  const OPS = [
    "open",
    "open",
    "open",
    "rename",
    "unlink",
    "mkdir",
    "link",
    "symlink",
    "release",
  ] as const
  const FLAGS = [O_RDONLY, O_RDONLY, O_WRONLY_CREAT_TRUNC, O_RDWR, 0o10000000]
  const KINDS = ["file", "dir", "missing"] as const
  const sequence = (next: () => number): RunNotice[] => {
    const pick = <T>(xs: readonly T[]): T =>
      xs[Math.floor(next() * xs.length)] as T
    return Array.from({ length: 60 }, (_, i): RunNotice => {
      const run = pick(["1024", "2048", "3072"])
      const roll = next()
      if (roll < 0.04)
        return { run, event: { kind: "exit", at: i, status: pick([0, 1]) } }
      if (roll < 0.06) return { run, event: { kind: "end", at: i } }
      if (roll < 0.08) return { run, event: { kind: "lost", at: i, count: 1 } }
      return {
        run,
        event: {
          kind: "call",
          op: pick(OPS),
          at: i,
          pid: pick([7, 8]),
          flags: pick(FLAGS),
          before: pick(KINDS),
          path: pick(PATHS),
          before2: pick(KINDS),
          path2: pick(["", ...PATHS]),
          stamp: pick([null, stamp("1:1"), stamp("2:2")]),
          raced: pick([null, null, stamp("3:3")]),
        },
      }
    })
  }

  test("a sequence folded in batches gives the traces of it folded at once", () => {
    const fold = laneFold(SHARED_LANE)
    for (let seed = 1; seed <= 200; seed++) {
      const next = random(seed)
      const notices = sequence(next)
      const cuts = [0, 1, 2]
        .map(() => Math.floor(next() * notices.length))
        .sort((a, b) => a - b)
      const batches = [0, ...cuts].map((from, i) =>
        notices.slice(from, [...cuts, notices.length][i]),
      )
      const inBatches = batches.reduce<RunTraces>(
        (traces, batch) => fold(traces, batch),
        new Map(),
      )
      expect(inBatches, `seed ${seed}`).toEqual(fold(new Map(), notices))
    }
  })
})

describe("checkRecipe", () => {
  const recipe = {
    run: "r1",
    key: {
      command: "pnpm install",
      image: "img",
      inputs: { "package.json": "h1", "pnpm-lock.yaml": "h2" },
      missing: [".npmrc"],
      shared: { ".plans/p.md": stamp("2:3") },
    },
    outputs: [checkedPath("node_modules")],
  }
  const now = {
    hashes: { "package.json": "h1", "pnpm-lock.yaml": "h2" },
    present: new Set<string>(),
    stamps: { ".plans/p.md": stamp("2:3") },
  }

  test("a key whose every fact is as it was holds", () => {
    expect(checkRecipe(recipe, now)).toEqual({ run: "r1", broken: null })
  })

  test("a changed input, a lookup now found, or a shared file's new stamp breaks it, named", () => {
    expect(
      checkRecipe(recipe, {
        ...now,
        hashes: { ...now.hashes, "pnpm-lock.yaml": "h3" },
      }).broken,
    ).toBe("pnpm-lock.yaml")
    expect(
      checkRecipe(recipe, { ...now, hashes: { "package.json": "h1" } }).broken,
    ).toBe("pnpm-lock.yaml")
    expect(
      checkRecipe(recipe, { ...now, present: new Set([".npmrc"]) }).broken,
    ).toBe(".npmrc")
    expect(
      checkRecipe(recipe, { ...now, stamps: { ".plans/p.md": stamp("2:4") } })
        .broken,
    ).toBe(".plans/p.md")
  })
})
