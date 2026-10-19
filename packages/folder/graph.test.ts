// The graph's laws (`packages/folder/TECHNICAL.md`, "The graph's laws"), each
// one test titled by its sentence (`scripts/laws.ts`): the structural ones as
// properties over graphs from a seeded walk of a folder's line and its lanes,
// and the merge's over the flows of a folder's catch-ups and accepts, merged
// by `git merge-file` as lanehost merges.

import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  type BasePlan,
  type DiskChange,
  entryId,
  fileContent,
  type PathFact,
  type PointId,
  pointId,
  type StateMade,
  type StateRecord,
  threadIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  ancestors,
  folderNewest,
  folderStateHeld,
  isAncestor,
  laneNewest,
  mergeBases,
  parentLane,
  planBase,
  planState,
  type StateGraph,
  stateGraph,
  virtualBaseName,
  virtualBaseRecord,
} from "./graph.ts"
import {
  type PathFacts,
  pathsToCompare,
  pathsToGather,
  planPathMerge,
} from "./merge.ts"

const LANE = threadIdFor("1")

/** A graph grown one state at a time, each one through `planState`. */
class Growing {
  readonly records: StateRecord[] = []
  get graph(): StateGraph {
    return stateGraph(this.records)
  }
  add(id: string, made: StateMade, ...parents: PointId[]): PointId {
    const record: StateRecord = {
      id: pointId(id),
      parents,
      made,
      at: this.records.length,
      by: null,
    }
    const planned = planState(this.graph, record)
    if (planned.kind !== "record")
      throw new Error(`${id} refused: ${JSON.stringify(planned)}`)
    this.records.push(planned.record)
    return record.id
  }
}

/** A seeded generator: the same seed walks the same graph. */
function random(seed: number) {
  let s = seed >>> 0
  return (n: number) => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (((t ^ (t >>> 14)) >>> 0) % n) as number
  }
}

/**
 * A folder project's history from a seeded walk: your saves on its line,
 * lanes begun on it, their turns, catch-ups and accepts as merges, and now
 * and then an accept of a lane's older state, which makes a criss-cross.
 */
function walked(
  seed: number,
  steps: number,
): { readonly graph: StateGraph; readonly folder: PointId } {
  const pick = random(seed)
  const g = new Growing()
  let folder = g.add("line-0", { kind: "read" })
  const lanes: PointId[][] = []
  for (let i = 1; i <= steps; i++) {
    const lane = lanes[pick(Math.max(lanes.length, 1))]
    const tip = lane?.at(-1)
    const action = lane === undefined || tip === undefined ? 1 : pick(6)
    if (action === 0) folder = g.add(`line-${i}`, { kind: "read" }, folder)
    else if (action === 1)
      lanes.push([g.add(`s-${i}`, { kind: "start", lane: LANE }, folder)])
    else if (lane === undefined || tip === undefined) continue
    else if (action === 2)
      lane.push(
        g.add(
          `t-${i}`,
          { kind: "turn", lane: LANE, entry: entryId(`e-${i}`) },
          tip,
        ),
      )
    else if (action === 3 && !isAncestor(g.graph, folder, tip))
      lane.push(
        g.add(`c-${i}`, { kind: "get-latest", lane: LANE }, tip, folder),
      )
    else if (action >= 4) {
      // Mostly the lane's tip; now and then proposed changes shown earlier.
      const proposed = action === 5 ? (lane[pick(lane.length)] ?? tip) : tip
      if (!isAncestor(g.graph, proposed, folder))
        folder = g.add(
          `line-${i}`,
          { kind: "accept", lane: LANE },
          folder,
          proposed,
        )
    }
  }
  return { graph: g.graph, folder }
}

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34]
const GRAPHS = SEEDS.map(seed => walked(seed, 40).graph)

/** Every ordered pair of a graph's states. */
function* pairs(g: StateGraph) {
  const ids = [...g.states.keys()]
  for (const a of ids) for (const b of ids) yield [a, b] as const
}

const isAntichain = (g: StateGraph, xs: readonly PointId[]) =>
  xs.every(x => xs.every(y => x === y || !isAncestor(g, x, y)))

describe("the graph's laws", () => {
  test("A state and its descendant have that state as their one base.", () => {
    for (const g of GRAPHS)
      for (const [a, b] of pairs(g))
        if (isAncestor(g, a, b)) {
          expect(mergeBases(g, a, b)).toEqual([a])
          expect(mergeBases(g, b, a)).toEqual([a])
        }
  })

  test("Merge bases are lowest common ancestors, none below another.", () => {
    let several = 0
    for (const g of GRAPHS)
      for (const [a, b] of pairs(g)) {
        const bases = mergeBases(g, a, b)
        for (const m of bases) {
          expect(isAncestor(g, m, a)).toBe(true)
          expect(isAncestor(g, m, b)).toBe(true)
        }
        expect(isAntichain(g, bases)).toBe(true)
        if (bases.length > 1) several++
      }
    // The walk makes criss-crosses, so the law is tested where it bites.
    expect(several).toBeGreaterThan(0)
  })

  test("Every common ancestor is at or below a merge base.", () => {
    for (const g of GRAPHS)
      for (const [a, b] of pairs(g)) {
        const bases = mergeBases(g, a, b)
        const ofB = ancestors(g, b)
        for (const c of ancestors(g, a))
          if (ofB.has(c))
            expect(bases.some(m => isAncestor(g, c, m))).toBe(true)
      }
  })

  test("Bases merged first give the right file or a conflict, never a wrong one.", () => {
    for (const flow of flows()) {
      const merged = mergeOver(flow)
      if (flow.expected === "conflict")
        expect(merged.conflicts).toEqual(["f.txt"])
      else expect(merged).toEqual({ files: flow.expected, conflicts: [] })
    }
  })
})

// The flows, each state's files beside the graph: `git merge-file`
// merges them as lanehost's disks role does.

type Files = ReadonlyMap<string, string>

const lines = (...ls: string[]) => `${ls.join("\n")}\n`
const F = "f.txt"
const X = "x.txt"

function gitMergeFile(
  base: string,
  ours: string,
  theirs: string,
): { readonly text: string; readonly clean: boolean } {
  const dir = mkdtempSync(path.join(tmpdir(), "merge-"))
  try {
    const at = (n: string, v: string) => {
      const p = path.join(dir, n)
      writeFileSync(p, v)
      return p
    }
    const ran = spawnSync(
      "git",
      [
        "merge-file",
        "-p",
        at("ours", ours),
        at("base", base),
        at("theirs", theirs),
      ],
      { encoding: "utf8" },
    )
    if (ran.status === null || ran.status < 0) throw new Error(ran.stderr)
    return { text: ran.stdout, clean: ran.status === 0 }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const diffFiles = (from: Files, to: Files): DiskChange[] =>
  [...new Set([...from.keys(), ...to.keys()])].flatMap((p): DiskChange[] => {
    const a = from.get(p)
    const b = to.get(p)
    if (a === b) return []
    const change =
      a === undefined ? "added" : b === undefined ? "deleted" : "changed"
    return [{ path: p, change, kind: "file" }]
  })

const factOf = (files: Files, p: string): PathFact => {
  const v = files.get(p)
  return v === undefined
    ? { kind: "absent" }
    : {
        kind: "file",
        exec: false,
        content: fileContent(new TextEncoder().encode(v)),
        size: v.length,
      }
}

/** The path merge of `theirs` into `ours` over `base`, carried out on maps of files. */
function mergeFiles(
  base: Files,
  ours: Files,
  theirs: Files,
  markers: boolean,
): { readonly files: Files; readonly conflicts: readonly string[] } {
  const o = diffFiles(base, ours)
  const t = diffFiles(base, theirs)
  const facts = new Map<string, PathFacts>(
    pathsToGather(o, t).map(p => [
      p,
      {
        base: factOf(base, p),
        ours: factOf(ours, p),
        theirs: factOf(theirs, p),
      },
    ]),
  )
  const same = new Set(
    pathsToCompare(t, facts).filter(p => ours.get(p) === theirs.get(p)),
  )
  const planned = planPathMerge({ ours: o, theirs: t, facts, same })
  const out = new Map(ours)
  const conflicts = [...planned.conflicts]
  for (const step of planned.steps) {
    if (step.kind === "take") out.set(step.path, theirs.get(step.path) ?? "")
    else if (step.kind === "delete") out.delete(step.path)
    else if (step.kind === "text") {
      const m = gitMergeFile(
        base.get(step.path) ?? "",
        ours.get(step.path) ?? "",
        theirs.get(step.path) ?? "",
      )
      if (m.clean || markers) out.set(step.path, m.text)
      if (!m.clean) conflicts.push(step.path)
    }
  }
  return { files: out, conflicts }
}

/** A base plan's files: a state's, or its bases merged first with git's markers kept. */
function filesOfBase(
  plan: BasePlan | null,
  content: ReadonlyMap<PointId, Files>,
): Files {
  if (plan === null) return new Map()
  if (plan.kind === "state") return content.get(plan.state) ?? new Map()
  let acc = content.get(plan.first) ?? new Map()
  for (const m of plan.merges)
    acc = mergeFiles(
      filesOfBase(m.base, content),
      acc,
      content.get(m.other) ?? new Map(),
      true,
    ).files
  return acc
}

interface Flow {
  readonly name: string
  readonly graph: StateGraph
  readonly content: ReadonlyMap<PointId, Files>
  readonly ours: PointId
  readonly theirs: PointId
  /** The file a person expects, or a conflict where no file is right. */
  readonly expected: Files | "conflict"
}

/** The lane's catch-up of each flow: its tip merged with accepted work's over the planned base. */
function mergeOver(flow: Flow) {
  const plan = planBase(flow.graph, flow.ours, flow.theirs)
  return mergeFiles(
    filesOfBase(plan, flow.content),
    flow.content.get(flow.ours) ?? new Map(),
    flow.content.get(flow.theirs) ?? new Map(),
    false,
  )
}

/**
 * Catch-ups after accepts, an accept recorded as a merge: A to D with one
 * base each; E to F criss-crosses, proposed changes shown before the lane's
 * catch-up accepted after it, where neither base alone is always right.
 */
function flows(): readonly Flow[] {
  const out: Flow[] = []
  let g = new Growing()
  let content = new Map<PointId, Files>()
  let n = 0
  const state = (
    files: Record<string, string> | Files,
    made: StateMade,
    ...parents: PointId[]
  ) => {
    const id = g.add(`s${n++}-${made.kind}`, made, ...parents)
    content.set(
      id,
      files instanceof Map ? files : new Map(Object.entries(files)),
    )
    return id
  }
  const merged = (base: PointId, ours: PointId, theirs: PointId) =>
    mergeFiles(
      content.get(base) ?? new Map(),
      content.get(ours) ?? new Map(),
      content.get(theirs) ?? new Map(),
      false,
    ).files
  const read: StateMade = { kind: "read" }
  const turn: StateMade = { kind: "turn", lane: LANE, entry: entryId("e") }
  const accept: StateMade = { kind: "accept", lane: LANE }
  const getLatest: StateMade = { kind: "get-latest", lane: LANE }
  const fresh = () => {
    g = new Growing()
    content = new Map()
  }
  const flow = (
    name: string,
    ours: PointId,
    theirs: PointId,
    expected: Record<string, string> | "conflict",
  ) =>
    out.push({
      name,
      graph: g.graph,
      content,
      ours,
      theirs,
      expected:
        expected === "conflict" ? expected : new Map(Object.entries(expected)),
    })

  // A: accepted, then the lane changes the accepted line again.
  const f0 = state({ [F]: lines("a", "b", "c") }, read)
  const l1 = state({ [F]: lines("a", "B1", "c") }, turn, f0)
  const f1 = state(merged(f0, f0, l1), accept, f0, l1)
  const l2 = state({ [F]: lines("a", "B2", "c") }, turn, l1)
  flow("A", l2, f1, { [F]: lines("a", "B2", "c") })

  // B: accepted, then you change the accepted line; the lane goes on elsewhere.
  const f2 = state({ [F]: lines("a", "Yours", "c") }, read, f1)
  const l1b = state({ [F]: lines("a", "B1", "c"), [X]: lines("new") }, turn, l1)
  flow("B", l1b, f2, { [F]: lines("a", "Yours", "c"), [X]: lines("new") })

  // C: accepted twice, then the lane changes its own accepted line again.
  fresh()
  const g0 = state({ [F]: lines("a", "b", "c", "d") }, read)
  const m1 = state({ [F]: lines("A", "b", "c", "d") }, turn, g0)
  const g1 = state(merged(g0, g0, m1), accept, g0, m1)
  const m2 = state({ [F]: lines("A", "B", "c", "d") }, turn, m1)
  const [cb] = mergeBases(g.graph, g1, m2)
  const g2 = state(merged(cb ?? g0, g1, m2), accept, g1, m2)
  const m3 = state({ [F]: lines("A", "BB", "c", "d") }, turn, m2)
  flow("C", m3, g2, { [F]: lines("A", "BB", "c", "d") })

  // D: a branch caught up with its parent, both accepted, the branch changes its line.
  fresh()
  const h0 = state({ [F]: lines("1", "2", "3", "4") }, read)
  const p1 = state({ [F]: lines("P", "2", "3", "4") }, turn, h0)
  const c1 = state({ [F]: lines("P", "2", "C", "4") }, turn, p1)
  const p2 = state({ [F]: lines("P", "PP", "3", "4") }, turn, p1)
  const c2 = state(merged(p1, c1, p2), getLatest, c1, p2)
  const h1 = state(merged(h0, h0, p2), accept, h0, p2)
  const [db] = mergeBases(g.graph, h1, c2)
  const h2 = state(merged(db ?? h0, h1, c2), accept, h1, c2)
  const c3 = state({ [F]: lines("P", "PP", "CC", "4") }, turn, c2)
  flow("D", c3, h2, { [F]: lines("P", "PP", "CC", "4") })

  // E: criss-cross: proposed changes shown before the lane's catch-up is
  // accepted after it.
  fresh()
  const k0 = state({ [F]: lines("x", "y", "z") }, read)
  const k1 = state({ [F]: lines("x", "Y1", "z") }, turn, k0)
  const ky = state({ [F]: lines("X", "y", "z") }, read, k0)
  const k2 = state(merged(k0, k1, ky), getLatest, k1, ky)
  const ka = state(merged(k0, ky, k1), accept, ky, k1)
  const k3 = state({ [F]: lines("X", "Y2", "z") }, turn, k2)
  // In E the virtual base conflicts: a conflict, not the file.
  flow("E", k3, ka, "conflict")

  // E2: as E, the two changes far apart in the file.
  fresh()
  const q0 = state({ [F]: lines("x", "1", "2", "y", "3", "4", "z") }, read)
  const q1 = state({ [F]: lines("x", "1", "2", "Y1", "3", "4", "z") }, turn, q0)
  const qy = state({ [F]: lines("X", "1", "2", "y", "3", "4", "z") }, read, q0)
  const q2 = state(merged(q0, q1, qy), getLatest, q1, qy)
  const qa = state(merged(q0, qy, q1), accept, qy, q1)
  const q3 = state({ [F]: lines("X", "1", "2", "Y2", "3", "4", "z") }, turn, q2)
  flow("E2", q3, qa, { [F]: lines("X", "1", "2", "Y2", "3", "4", "z") })

  // E3: as E2; then you change another line, and the lane catches up.
  const r3 = state({ [F]: lines("X", "1", "2", "Y1", "3", "4", "Z") }, read, qa)
  flow("E3", q2, r3, { [F]: lines("X", "1", "2", "Y1", "3", "4", "Z") })

  // F: a criss-cross whose two sides resolved one conflict two ways: the
  // lane kept its line, you kept yours. Either base alone takes one side's
  // resolution silently; the right answer is a conflict.
  fresh()
  const j0 = state({ [F]: lines("x", "y", "z") }, read)
  const j1 = state({ [F]: lines("x", "Y1", "z") }, turn, j0)
  const jy = state({ [F]: lines("x", "Yy", "z") }, read, j0)
  const j2 = state({ [F]: lines("x", "Y1", "z") }, getLatest, j1, jy)
  const ja = state({ [F]: lines("x", "Yy", "z") }, accept, jy, j1)
  flow("F", j2, ja, "conflict")
  return out
}

test("folderNewest: accepted work's newest state, along its line, whatever lanes did", () => {
  for (const seed of SEEDS) {
    const { graph, folder } = walked(seed, 40)
    expect(folderNewest(graph)).toBe(folder)
  }
  expect(folderNewest(stateGraph([]))).toBeNull()
})

test("laneNewest and folderStateHeld: a lane's newest state, and the state of accepted work its line holds", () => {
  const OTHER = threadIdFor("2")
  const g = new Growing()
  const l0 = g.add("line-0", { kind: "read" })
  const s = g.add("start-1", { kind: "start", lane: LANE }, l0)
  const t = g.add(
    "turn-1",
    { kind: "turn", lane: LANE, entry: entryId("e") },
    s,
  )
  const l1 = g.add("line-1", { kind: "read" }, l0)
  const c = g.add("catch-up-1", { kind: "get-latest", lane: LANE }, t, l1)
  const t2 = g.add(
    "turn-2",
    { kind: "turn", lane: LANE, entry: entryId("f") },
    c,
  )
  // A lane branched at the first lane's turn walks on into it.
  const b = g.add("start-2", { kind: "start", lane: OTHER }, t)
  expect(laneNewest(g.graph, LANE)).toBe(t2)
  expect(laneNewest(g.graph, OTHER)).toBe(b)
  expect(laneNewest(g.graph, threadIdFor("3"))).toBeNull()
  expect(folderStateHeld(g.graph, t2)).toBe(l1)
  expect(folderStateHeld(g.graph, t)).toBe(l0)
  expect(folderStateHeld(g.graph, b)).toBe(l0)
  expect(folderStateHeld(g.graph, l1)).toBe(l1)
})

describe("parentLane", () => {
  const OTHER = threadIdFor("2")
  const THIRD = threadIdFor("3")
  const g = new Growing()
  const l0 = g.add("line-0", { kind: "read" })
  const s = g.add("start-1", { kind: "start", lane: LANE }, l0)
  const t = g.add(
    "turn-1",
    { kind: "turn", lane: LANE, entry: entryId("e") },
    s,
  )
  const b = g.add("start-2", { kind: "start", lane: OTHER }, t)
  g.add("start-3", { kind: "start", lane: THIRD }, b)

  test("a lane started on accepted work's line has none", () => {
    expect(parentLane(g.graph, LANE)).toBeNull()
  })

  test("a branch at another lane's turn has that lane", () => {
    expect(parentLane(g.graph, OTHER)).toBe(LANE)
  })

  test("a branch of a branch has its own parent, not the grandparent", () => {
    expect(parentLane(g.graph, THIRD)).toBe(OTHER)
  })
})

describe("the flows of catch-ups and accepts", () => {
  test("A to D give one base, and the graph's base merges each right", () => {
    for (const flow of flows().slice(0, 4)) {
      expect(planBase(flow.graph, flow.ours, flow.theirs)?.kind).toBe("state")
      expect(mergeOver(flow)).toEqual({ files: flow.expected, conflicts: [] })
    }
  })

  test("either base alone of two resolutions merges one silently", () => {
    const f = flows().find(x => x.name === "F")
    if (f === undefined) throw new Error("no flow F")
    for (const base of mergeBases(f.graph, f.ours, f.theirs))
      expect(
        mergeFiles(
          f.content.get(base) ?? new Map(),
          f.content.get(f.ours) ?? new Map(),
          f.content.get(f.theirs) ?? new Map(),
          false,
        ).conflicts,
      ).toEqual([])
  })

  test("a criss-cross gives two bases, planned as one virtual base named by them", () => {
    const e = flows().find(f => f.name === "E")
    if (e === undefined) throw new Error("no flow E")
    const bases = mergeBases(e.graph, e.ours, e.theirs)
    expect(bases).toHaveLength(2)
    const plan = planBase(e.graph, e.ours, e.theirs)
    expect(plan).toEqual(planBase(e.graph, e.theirs, e.ours))
    expect(plan?.kind === "virtual" && plan.name).toBe(virtualBaseName(bases))
    expect(virtualBaseName([...bases].reverse())).toBe(virtualBaseName(bases))
  })

  test("a virtual base's record has its bases as parents, and records once", () => {
    const e = flows().find(f => f.name === "E")
    const plan = e && planBase(e.graph, e.ours, e.theirs)
    if (e === undefined || plan?.kind !== "virtual")
      throw new Error("no virtual base")
    const record = virtualBaseRecord(plan, 9)
    expect(record.parents).toEqual(mergeBases(e.graph, e.ours, e.theirs))
    const planned = planState(e.graph, record)
    expect(planned.kind).toBe("record")
    const recorded = stateGraph([...e.graph.states.values(), record])
    expect(planState(recorded, { ...record, at: 10 })).toEqual({
      kind: "recorded",
    })
  })
})

describe("planState", () => {
  const g = new Growing()
  const first = g.add("line-1", { kind: "read" })
  const lane = g.add("s-1", { kind: "start", lane: LANE }, first)
  const graph = g.graph
  const proposed = (
    id: string,
    made: StateMade,
    ...parents: string[]
  ): StateRecord => ({
    id: pointId(id),
    parents: parents.map(pointId),
    made,
    at: 1,
    by: null,
  })

  test("an id a commit could have, or no disk could, is refused", () => {
    for (const id of [
      "0123456789abcdef0123456789abcdef01234567",
      "line",
      "a-b/c",
    ])
      expect(planState(graph, proposed(id, { kind: "read" }, first))).toEqual({
        kind: "refused",
        why: "not-a-state-id",
      })
  })

  test("an id recorded with other parents is refused, with the same answered recorded", () => {
    expect(
      planState(graph, proposed("s-1", { kind: "start", lane: LANE }, lane)),
    ).toEqual({
      kind: "refused",
      why: "id-in-use",
    })
    expect(
      planState(graph, proposed("s-1", { kind: "start", lane: LANE }, first)),
    ).toEqual({
      kind: "recorded",
    })
  })

  test("a parent not in the graph is refused", () => {
    expect(
      planState(
        graph,
        proposed(
          "t-1",
          { kind: "turn", lane: LANE, entry: entryId("e") },
          "line-9",
        ),
      ),
    ).toEqual({
      kind: "refused",
      why: "unknown-parent",
      parent: pointId("line-9"),
    })
  })

  test("parents whose number how it was made contradicts are refused", () => {
    const refused = { kind: "refused", why: "parents" }
    expect(
      planState(graph, proposed("line-2", { kind: "read" }, first, lane)),
    ).toEqual(refused)
    expect(planState(graph, proposed("line-2", { kind: "read" }))).toEqual(
      refused,
    )
    expect(
      planState(graph, proposed("line-2", { kind: "restore", of: lane })),
    ).toEqual(refused)
    expect(
      planState(
        graph,
        proposed("line-2", { kind: "accept", lane: LANE }, first),
      ),
    ).toEqual(refused)
    expect(
      planState(
        graph,
        proposed("c-1", { kind: "get-latest", lane: LANE }, lane, lane),
      ),
    ).toEqual(refused)
    expect(
      planState(graph, proposed("bases-1", { kind: "bases-merged" }, first)),
    ).toEqual(refused)
  })

  test("a resolve on its lane's newest state is recorded; on another's refused", () => {
    expect(
      planState(
        graph,
        proposed("resolve-1", { kind: "resolve", lane: LANE, path: "a" }, lane),
      ).kind,
    ).toBe("record")
    expect(
      planState(
        graph,
        proposed(
          "resolve-1",
          { kind: "resolve", lane: threadIdFor("2"), path: "a" },
          lane,
        ),
      ),
    ).toEqual({ kind: "refused", why: "resolve-off-lane" })
    expect(
      planState(
        graph,
        proposed(
          "resolve-1",
          { kind: "resolve", lane: LANE, path: "a" },
          first,
        ),
      ),
    ).toEqual({ kind: "refused", why: "resolve-off-lane" })
  })

  test("the first read of the project's folder has no parent, and a restore its line's newest", () => {
    expect(
      planState(stateGraph([]), proposed("line-1", { kind: "read" })).kind,
    ).toBe("record")
    expect(
      planState(graph, proposed("line-2", { kind: "restore", of: lane }, first))
        .kind,
    ).toBe("record")
  })
})
