import {
  type DiskPath,
  diskPath,
  flushed,
  type LaneDrain,
  type RunEvent,
  type RunNotice,
  stamp,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  checkRecipe,
  dirtyPaths,
  drainLane,
  drainRun,
  foldLaneDrain,
  foldRunEvents,
  newRunTrace,
  type RunTrace,
} from "./runs.ts"

/** A test's output path, checked. */
const checkedPath = (p: string): DiskPath => {
  const checked = diskPath(p)
  if (checked === null) throw new Error(`${p} leaves the disk`)
  return checked
}

const ROOT = "/workspace"
const trace = (shared: readonly string[] = []): RunTrace =>
  newRunTrace({ id: "r1", command: "make", root: ROOT, shared })

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
    const t = foldRunEvents(trace(), [
      call("open", "out.js", "missing", { flags: O_WRONLY_CREAT_TRUNC }),
    ])
    expect(drained(t, ["out.js"]).record?.writes).toEqual([
      { path: "out.js", created: true, dir: false },
    ])
  })

  test("a file rewritten in place is a write, not created, and not a read", () => {
    const t = foldRunEvents(trace(), [
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
    const t = foldRunEvents(trace(), [
      call("open", "src/a.ts", "file"),
      call("open", "src/a.ts", "file", { flags: O_WRONLY_CREAT_TRUNC }),
    ])
    expect(drained(t, ["src/a.ts"]).record?.reads).toEqual(["src/a.ts"])
  })

  test("a lookup of a missing file is a failed lookup, and its later making is not", () => {
    const t = foldRunEvents(trace(), [
      call("open", ".npmrc"),
      call("open", "made", "missing", { flags: O_WRONLY_CREAT_TRUNC }),
      call("open", "made", "missing"),
    ])
    expect(drained(t, ["made"]).record?.missing).toEqual([".npmrc"])
  })

  test("a temporary file renamed into place writes only its target", () => {
    const t = foldRunEvents(trace(), [
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
    const t = foldRunEvents(trace(), [call("unlink", "old.js", "file")])
    expect(drained(t, []).record?.deletions).toEqual(["old.js"])
  })

  test("what a run makes under a directory it renames is under the new name", () => {
    const t = foldRunEvents(trace(), [
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
    const t = foldRunEvents(trace(), [
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
      foldRunEvents(trace(), [
        { kind: "exit", at: 1, status: 0 },
        call("open", "dev.log", "missing", { flags: O_WRONLY_CREAT_TRUNC }),
      ]),
      ["dev.log"],
    )
    expect(first.record).toMatchObject({ exit: 0, alive: true })
    const later = foldRunEvents(first.trace, [
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
    const t = foldRunEvents(trace([".plans"]), [
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
    const t = foldRunEvents(trace([".plans"]), [
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
    const t = foldRunEvents(trace(), [{ kind: "lost", at: 1, count: 3 }])
    const first = drained(t, [])
    expect(first.record?.observed).toEqual({ kind: "lost", events: 3 })
    const later = foldRunEvents(first.trace, [
      call("open", "x", "missing", { flags: O_WRONLY_CREAT_TRUNC }),
    ])
    expect(drained(later, ["x"]).record?.observed).toEqual({
      kind: "lost",
      events: 3,
    })
  })
})

describe("a lane's drain", () => {
  const drain = (over: Partial<LaneDrain> = {}): LaneDrain => ({
    root: ROOT,
    shared: [],
    launched: [],
    toolWrites: [],
    toolShared: [],
    ...over,
  })
  const made = (run: string, p: string): RunNotice => ({
    run,
    event: call("open", p, "missing", { flags: O_WRONLY_CREAT_TRUNC }),
  })

  test("a launched run carries its command, its notices and its exit", () => {
    const traces = foldLaneDrain(new Map(), {
      drain: drain({
        launched: [{ run: "r1", command: "make" }],
      }),
      notices: flushed([
        made("r1", "out"),
        { run: "r1", event: { kind: "exit", at: 9, status: 2 } },
      ]),
    })
    expect(dirtyPaths(traces)).toEqual(["out"])
    const { runs } = drainLane(traces, new Set(["out"]), drain())
    expect(runs.runs).toEqual([
      expect.objectContaining({
        id: "r1",
        command: "make",
        exit: 2,
        writes: [{ path: "out", created: true, dir: false }],
      }),
    ])
  })

  test("a notice of a run never seen launched starts one with no command", () => {
    const traces = foldLaneDrain(new Map(), {
      drain: drain(),
      notices: flushed([made("old", "x")]),
    })
    expect(traces.get("old")?.command).toBeNull()
  })

  test("an ended run's trace goes after its drain; a live one stays", () => {
    const traces = foldLaneDrain(new Map(), {
      drain: drain({
        launched: [
          { run: "a", command: "a" },
          { run: "b", command: "b" },
        ],
      }),
      notices: flushed([{ run: "a", event: { kind: "end", at: 1 } }]),
    })
    expect([...drainLane(traces, new Set(), drain()).traces.keys()]).toEqual([
      "b",
    ])
  })

  test("the tools' writes and shared accesses pass through", () => {
    const { runs } = drainLane(
      new Map(),
      new Set(),
      drain({ toolWrites: ["t"] }),
    )
    expect(runs).toEqual({ runs: [], toolWrites: ["t"], toolShared: [] })
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
