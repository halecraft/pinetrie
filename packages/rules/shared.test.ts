import {
  entryId,
  type SharedAccess,
  type SharedLineage,
  type Stamp,
  stamp,
  threadIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { setRecord } from "./records.ts"
import {
  laneReads,
  planForgottenReaders,
  planGoneLineages,
  planSharedLineages,
  SHARED_LINEAGE,
  type SharedWrite,
  sharedTouches,
} from "./shared.ts"

const P = ".plans/p.md"
/** A stamp of `size` bytes, changed at `us` µs by the host's clock. */
const st = (us: number, size = 1): Stamp => stamp(`${size}:${us * 1000}`)

type AccessOver = Partial<
  Pick<SharedAccess, "path" | "writable" | "append" | "pid">
>
const access = (
  kind: "open" | "release",
  at: number,
  s: Stamp | null,
  over: AccessOver = {},
): SharedAccess => {
  const fields = {
    path: P,
    writable: kind === "release",
    append: false,
    at,
    pid: 1,
    ...over,
  }
  return kind === "open"
    ? { ...fields, kind, stamp: s }
    : { ...fields, kind, left: { kind: "stamp", stamp: s } }
}
const A = {
  kind: "lane",
  lane: threadIdFor("aaaaaaaaaaaaaaaa"),
  entry: entryId("ea"),
} as const
const B = {
  kind: "lane",
  lane: threadIdFor("bbbbbbbbbbbbbbbb"),
  entry: entryId("eb"),
} as const
const none = new Map<string, Stamp>()

describe("sharedTouches: a lane's reads and writes of shared files", () => {
  test("a write is based on what the lane last read, by any of its processes", () => {
    const touched = sharedTouches(
      [
        access("open", 1, st(100), { pid: 7 }),
        // Another lane's version is there by the time it opens to write.
        access("open", 5, st(200), { pid: 8, writable: true }),
        access("release", 6, st(300), { pid: 8 }),
      ],
      none,
    )
    expect(touched.writes.map(w => w.base)).toEqual([st(100)])
  })

  test("a write is based on what the lane read in an earlier turn", () => {
    const touched = sharedTouches(
      [
        access("open", 5, st(200), { writable: true }),
        access("release", 6, st(300)),
      ],
      new Map([[P, st(100)]]),
    )
    expect(touched.writes.map(w => w.base)).toEqual([st(100)])
  })

  test("an append is based on what its open found, whatever the lane read", () => {
    const touched = sharedTouches(
      [
        access("open", 5, st(200), { writable: true, append: true }),
        access("release", 6, st(300), { append: true }),
      ],
      new Map([[P, st(100)]]),
    )
    expect(touched.writes.map(w => w.base)).toEqual([st(200)])
  })

  test("a write's last release is its version; one that changed nothing is a read", () => {
    const touched = sharedTouches(
      [
        access("open", 1, st(100), { writable: true }),
        access("release", 2, st(150)),
        access("release", 3, st(200)),
        access("open", 4, st(200), { pid: 2, writable: true }),
        access("release", 5, st(200), { pid: 2 }),
      ],
      none,
    )
    expect(touched.writes.map(w => w.stamp)).toEqual([st(200)])
    expect(touched.reads.map(r => r.stamp)).toEqual([st(200)])
  })

  test("a file found missing was missing its open-to-release time before its ctime", () => {
    const [w] = sharedTouches(
      [
        access("open", 10, null, { writable: true }),
        access("release", 40, st(1000)),
      ],
      none,
    ).writes
    expect([w?.base, w?.missingAt]).toEqual([null, 970])
  })

  test("an open never released, a process killed, is no write", () => {
    expect(
      sharedTouches([access("open", 1, st(100), { writable: true })], none)
        .writes,
    ).toEqual([])
  })

  test("what the lane read and wrote last is what it knows after", () => {
    const touched = sharedTouches(
      [
        access("open", 1, st(100), { path: "a" }),
        access("open", 2, st(100), { writable: true }),
        access("release", 3, st(200)),
      ],
      none,
    )
    expect([...touched.lastRead]).toEqual([
      ["a", st(100)],
      [P, st(200)],
    ])
  })
})

describe("sharedTouches: a raced release", () => {
  test("is a write marked raced, even where its stamp is the one it was based on", () => {
    const { writes } = sharedTouches(
      [
        access("open", 1, st(100), { writable: true }),
        {
          ...access("release", 2, st(100)),
          kind: "release",
          left: { kind: "raced", stamp: st(100), kernel: st(90) },
        },
      ],
      none,
    )
    expect(writes.map(w => [w.stamp, w.raced])).toEqual([[st(100), true]])
  })
})

describe("planSharedLineages", () => {
  const empty = new Map<string, SharedLineage>()
  const write = (base: Stamp | null, s: Stamp, missingAt = 0): SharedWrite => ({
    path: P,
    base,
    missingAt,
    stamp: s,
    raced: false,
  })
  const plan = (
    lineages: ReadonlyMap<string, SharedLineage>,
    over: Partial<Parameters<typeof planSharedLineages>[0]>,
  ) =>
    planSharedLineages({
      lineages,
      reads: [],
      writes: [],
      seen: [],
      writer: A,
      lastRead: none,
      ...over,
    })
  const lineagesAfter = (planned: ReturnType<typeof planSharedLineages>) =>
    new Map(planned.lineages.map(l => [l.path, l]))

  test("a stamp never seen is a version made outside; a write after it is clean", () => {
    const planned = plan(empty, {
      reads: [{ path: P, stamp: st(100) }],
      writes: [write(st(100), st(200))],
    })
    expect(
      planned.lineages[0]?.versions.map(v => [v.version, v.writer.kind, v.at]),
    ).toEqual([
      [1, "outside", 100],
      [2, "lane", 200],
    ])
    expect(planned.turn).toEqual({
      wrote: [{ path: P, version: 2, concurrent: false }],
    })
  })

  // The race: both read v0 (100); A writes (300); B writes on v0 (400).
  const afterA = plan(empty, { writes: [write(st(100), st(300))] })

  test("a write based on a version another write replaced is concurrent", () => {
    const b = plan(lineagesAfter(afterA), {
      writes: [write(st(100), st(400))],
      writer: B,
    })
    expect(b.turn.wrote).toEqual([{ path: P, version: 3, concurrent: true }])
  })

  test("a write based on the head is clean", () => {
    const b = plan(lineagesAfter(afterA), {
      writes: [write(st(300), st(400))],
      writer: B,
    })
    expect(b.turn.wrote[0]?.concurrent).toBe(false)
  })

  test("a write recorded before an earlier rival is found concurrent once the rival is, and named for its turn", () => {
    const b = plan(empty, { writes: [write(st(100), st(400))], writer: B })
    expect(b.turn.wrote[0]?.concurrent).toBe(false)
    const a = plan(lineagesAfter(b), { writes: [write(st(100), st(300))] })
    expect(a.turn.wrote[0]?.concurrent).toBe(false)
    expect(a.revised).toEqual([{ path: P, version: 2, writer: B }])
  })

  test("a write to a file found missing is concurrent when another made it since, not before", () => {
    expect(
      plan(lineagesAfter(afterA), {
        writes: [write(null, st(400), 200)],
        writer: B,
      }).turn.wrote[0]?.concurrent,
    ).toBe(true)
    expect(
      plan(lineagesAfter(afterA), {
        writes: [write(null, st(400), 350)],
        writer: B,
      }).turn.wrote[0]?.concurrent,
    ).toBe(false)
  })

  test("a version the watcher saw first is claimed by the lane that reports it", () => {
    const seen = plan(empty, {
      seen: [{ path: P, stamp: st(300) }],
      writer: null,
    })
    expect(seen.lineages[0]?.versions[0]?.writer.kind).toBe("outside")
    const claimed = plan(lineagesAfter(seen), {
      writes: [write(st(100), st(300))],
    })
    expect(
      claimed.lineages[0]?.versions.map(v => [v.version, v.writer]),
    ).toEqual([
      [2, { kind: "outside" }],
      [1, A],
    ])
    expect(claimed.turn.wrote).toEqual([
      { path: P, version: 1, concurrent: false },
    ])
  })

  test("your write between a lane's read and its write makes the lane's concurrent", () => {
    const yours = plan(empty, {
      seen: [
        { path: P, stamp: st(100) },
        { path: P, stamp: st(200) },
      ],
      writer: null,
    })
    expect(
      plan(lineagesAfter(yours), { writes: [write(st(100), st(300))] }).turn
        .wrote[0]?.concurrent,
    ).toBe(true)
  })

  // The lstat race: B's write read A's version (300) at its release.
  const contested = plan(lineagesAfter(afterA), {
    writes: [write(st(100), st(300))],
    writer: B,
  })

  test("a version two lanes' turns both claim is contested: concurrent, kept as the first's, and the first's turn named", () => {
    expect(contested.turn.wrote).toEqual([
      { path: P, version: 2, concurrent: true },
    ])
    expect(contested.revised).toEqual([{ path: P, version: 2, writer: A }])
    const v = contested.lineages[0]?.versions.find(x => x.version === 2)
    expect([v?.writer, v?.contested, v?.concurrent]).toEqual([A, true, true])
  })

  test("a write based on a contested version is concurrent", () => {
    expect(
      plan(lineagesAfter(contested), { writes: [write(st(300), st(500))] }).turn
        .wrote[0]?.concurrent,
    ).toBe(true)
  })

  test("a raced release's version is contested, and so concurrent", () => {
    const raced = plan(empty, {
      writes: [{ ...write(st(100), st(300)), raced: true }],
    })
    expect(raced.lineages[0]?.versions.at(-1)?.contested).toBe(true)
    expect(raced.turn.wrote[0]?.concurrent).toBe(true)
  })

  test("one turn's writes that leave one stamp contest nothing", () => {
    const twice = plan(empty, {
      writes: [write(st(100), st(300)), write(st(100), st(300))],
    })
    expect(twice.lineages[0]?.versions.map(v => v.contested)).toEqual([
      false,
      false,
    ])
    expect(twice.revised).toEqual([])
  })

  test("what a lane last read is kept on the lineage, and read back for its next turn", () => {
    const planned = plan(empty, {
      reads: [{ path: P, stamp: st(100) }],
      lastRead: new Map([[P, st(100)]]),
    })
    expect([...laneReads(lineagesAfter(planned), A.lane)]).toEqual([
      [P, st(100)],
    ])
    expect([...laneReads(lineagesAfter(planned), B.lane)]).toEqual([])
  })

  test("nothing touched: no lineage changes", () => {
    expect(plan(empty, {})).toEqual({
      lineages: [],
      turn: { wrote: [] },
      revised: [],
    })
  })

  test("a lineage keeps its newest versions only", () => {
    let lineages: ReadonlyMap<string, SharedLineage> = empty
    for (let i = 0; i < 105; i++)
      lineages = lineagesAfter(
        plan(lineages, {
          writes: [
            write(i === 0 ? null : st(i * 10 - 5), st(i * 10 + 5), i * 10),
          ],
        }),
      )
    const lineage = lineages.get(P)
    expect([
      lineage?.versions.length,
      lineage?.versions[0]?.version,
      lineage?.next,
    ]).toEqual([100, 6, 106])
  })

  test("a lineage round-trips its record", () => {
    const lineage = plan(empty, {
      writes: [write(st(100), st(300))],
      lastRead: new Map([[P, st(300)]]),
    }).lineages[0]
    if (lineage === undefined) throw new Error("no lineage")
    const w = setRecord(SHARED_LINEAGE, lineage)
    expect(SHARED_LINEAGE.decode(w.value, w.key)).toEqual(lineage)
  })
})

describe("planGoneLineages: a full scan lets go of lineages whose file is gone", () => {
  /** A lineage at `path` whose versions were made at each of `ats` µs. */
  const lineage = (path: string, ats: readonly number[]): SharedLineage => ({
    path,
    versions: ats.map((at, i) => ({
      version: i + 1,
      stamp: st(at),
      at,
      writer: { kind: "outside" },
      baseAt: null,
      contested: false,
      concurrent: false,
    })),
    next: ats.length + 1,
    read: {},
  })
  const lineages = (...ls: SharedLineage[]) => new Map(ls.map(l => [l.path, l]))
  const gone = (
    ls: ReadonlyMap<string, SharedLineage>,
    found: readonly string[],
    startedAt = 1_000,
  ) =>
    planGoneLineages({
      lineages: ls,
      dir: "sandbox",
      found: new Set(found),
      startedAt,
    })

  test("a file the scan did not find goes; one it found stays", () => {
    expect(
      gone(lineages(lineage("sandbox/a", [100]), lineage("sandbox/b", [100])), [
        "sandbox/b",
      ]),
    ).toEqual(["sandbox/a"])
  })

  test("a lineage with a version from the host's start or later stays", () => {
    expect(
      gone(lineages(lineage("sandbox/a", [100, 1_000])), [], 1_000),
    ).toEqual([])
  })

  test("only the scanned directory's lineages go", () => {
    expect(
      gone(
        lineages(lineage(".plans/a", [100]), lineage("sandboxed/a", [100])),
        [],
      ),
    ).toEqual([])
  })
})

describe("planForgottenReaders", () => {
  const read = (lanes: readonly string[]): SharedLineage => ({
    path: P,
    versions: [],
    next: 1,
    read: Object.fromEntries(lanes.map(l => [l, st(100)])),
  })

  test("a deleted thread's lane leaves every lineage it read; others stay", () => {
    const ls = new Map([[P, read([A.lane, B.lane])]])
    expect(planForgottenReaders(ls, new Set([A.lane]))).toEqual([
      { ...read([B.lane]) },
    ])
  })

  test("a lineage no forgotten lane read is not rewritten", () => {
    const ls = new Map([[P, read([B.lane])]])
    expect(planForgottenReaders(ls, new Set([A.lane]))).toEqual([])
  })
})
