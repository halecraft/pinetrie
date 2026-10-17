// The port suite against the folder adapter: lanehost's disks role run in this
// process over a btrfs directory, as `packages/lanehost/disks.test.ts` runs it,
// the project's folder a directory beside it, and a lane's commands run on the
// host in its disk. The rig's test-only hooks read the graph and a diff of
// their own (`git diff --no-index` of two snapshots); an accept is the host's
// own (`accept.ts`), of the proposed changes the host would show. Where there
// is no btrfs, it skips, saying why.

import { mkdir, readFile, rm, statfs, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  type BaseMerge,
  type ConflictRecord,
  entryId,
  type FolderProposedChangesRecord,
  type ForkStart,
  folderCopyReady,
  lineStateId,
  type PointId,
  type StateRecord,
  snapshotId,
  type ThreadId,
  type ThreadName,
  threadIdFor,
  type ValueWrite,
  writerId,
} from "@pinetrie/core"
import {
  folderNewest,
  isAncestor,
  laneNewest,
  planBase,
  type StateGraph,
  shownMergeId,
  stateGraph,
} from "@pinetrie/folder"
import { projectDisks } from "@pinetrie/lanehost"
import { disksInProcess, tarStream } from "@pinetrie/lanehost/fixtures"
import {
  createQueue,
  type FolderDisks,
  type LaneHistory,
  type LaneRuntime,
  laneIgnores,
  lines,
  run,
} from "@pinetrie/lanes"
import {
  type HistoryRig,
  historySuite,
  type RigLane,
} from "@pinetrie/lanes/testing"
import {
  ACCEPT_JOURNAL,
  CONFLICT,
  recordsOf,
  STATE,
  setRecord,
} from "@pinetrie/rules"
import { afterAll, describe, expect, test } from "vitest"
import { createFolderAccept } from "./accept.ts"
import { sourceChanges } from "./changes.ts"
import { folderFileAt } from "./file-at.ts"
import { folderHistory } from "./history.ts"
import { createFolderLine } from "./line.ts"
import { makeShownMerge } from "./proposed.ts"
import type { FolderLane } from "./proven.ts"
import { planSweep } from "./sweep.ts"

const BTRFS_MAGIC = 0x9123683e
const HERE = path.join(import.meta.dirname, "node_modules", ".folder-suite")
const onBtrfs = await mkdir(HERE, { recursive: true })
  .then(() => statfs(HERE))
  .then(s => s.type === BTRFS_MAGIC)
  .catch(() => false)

afterAll(async () => {
  await rm(HERE, { recursive: true, force: true })
})

let rigs = 0

/** The suite's rig, lanehost in this process with a project key and a folder of its own, and what only the folder's tests ask. */
type FolderRig = HistoryRig & {
  statesDir(lane: ThreadId): Promise<string>
  /** A lane branched at `from`, another lane's state: its disk restored from that state's snapshot. */
  branch(from: PointId): Promise<RigLane>
  /** The snapshots of every state the live set of the rig's lanes keeps not, deleted (`planSweep`). */
  sweep(): Promise<readonly PointId[]>
  snapshotExists(state: PointId): Promise<boolean>
  deleteSnapshot(state: PointId): Promise<void>
  graph(): StateGraph
}

async function makeRig(): Promise<FolderRig> {
  const n = rigs++
  const key = `f0f0f0f0f0f0f0${String(n).padStart(2, "0")}`
  const dir = path.join(HERE, `rig-${n}`)
  const folder = path.join(dir, "folder")
  const lanesDir = path.join(dir, "lanes")
  await mkdir(folder, { recursive: true })
  await mkdir(lanesDir, { recursive: true })
  const call = disksInProcess({ lanesDir, folder })
  const disks = projectDisks(lanesDir, key)
  const unused = (what: string) => () => {
    throw new Error(`the rig's runtime has no ${what}`)
  }
  const runtime: LaneRuntime = {
    disk: async op => {
      await call({ kind: "disk", project: key, op })
    },
    diskExists: lane => call({ kind: "diskExists", project: key, lane }),
    snapshotExists: id =>
      call({ kind: "snapshotExists", project: key, snapshot: id }),
    diff: (from, to) => call({ kind: "diff", project: key, from, to }),
    readLaneFile: unused("readLaneFile"),
    runSpec: unused("runSpec"),
    run: unused("run"),
    containerFacts: unused("containerFacts"),
    observe: unused("observe"),
    start: unused("start"),
    stop: unused("stop"),
    remove: unused("remove"),
    execArgv: unused("execArgv"),
    imageExists: unused("imageExists"),
    buildImage: unused("buildImage"),
    imagePath: unused("imagePath"),
    runInImage: unused("runInImage"),
  }
  const folderDisks: FolderDisks = {
    pathFacts: (snapshot, paths) =>
      call({ kind: "pathFacts", project: key, snapshot, paths }),
    fileDiff: (a, b, p, limit) =>
      call({ kind: "fileDiff", project: key, a, b, path: p, limit }),
    diffStats: (a, b, paths) =>
      call({ kind: "diffStats", project: key, a, b, paths }),
    filesUnder: (snapshot, paths) =>
      call({ kind: "filesUnder", project: key, snapshot, paths }),
    sameContent: (a, b, paths) =>
      call({ kind: "sameContent", project: key, a, b, paths }),
    applyMerge: m => call({ kind: "applyMerge", project: key, ...m }),
    read: (snapshot, p, limit) =>
      call({ kind: "read", project: key, snapshot, path: p, limit }),
    readIn: r => call({ kind: "readIn", project: key, ...r }),
    tarOut: (state, paths) =>
      tarStream(disks.snapshot(snapshotId(state)), paths),
    states: async (lane, op) => {
      await call({ kind: "states", project: key, lane, op })
    },
  }
  // The session's records, each namespace's values by key, as writes leave them.
  const stored = new Map<string, Map<string, unknown>>()
  const values = (namespace: string) =>
    [...(stored.get(namespace) ?? new Map<string, unknown>())].map(
      ([key, value]) => ({ key, value }),
    )
  const store = {
    states: (): readonly StateRecord[] => [
      ...recordsOf(STATE, values(STATE.namespace)).values(),
    ],
    conflicts: (lane: ThreadId): readonly ConflictRecord[] =>
      [...recordsOf(CONFLICT, values(CONFLICT.namespace)).values()].filter(
        c => c.lane === lane,
      ),
    write: async (writes: readonly ValueWrite[]) => {
      for (const w of writes) {
        const at = stored.get(w.namespace) ?? new Map<string, unknown>()
        if (w.kind === "set") at.set(w.key, w.value)
        else at.delete(w.key)
        stored.set(w.namespace, at)
      }
    },
  }
  let ids = 0
  const newId = () =>
    `0192${String(n).padStart(4, "0")}-${String(ids++).padStart(6, "0")}`
  const own = () => laneIgnores([])
  // The project's one queue, as `startFolderProject` makes it.
  const project = createQueue()
  const line = createFolderLine({
    root: folder,
    own,
    disks: folderDisks,
    queue: project,
    stampsFile: path.join(dir, "folder-stamps.json"),
    states: store.states,
    writeState: r => store.write([setRecord(STATE, r)]),
    newId,
    now: () => ids,
    moved: () => {},
    recover: () => accepter.recover(),
    asides: () => accepter.asides(),
  })
  const reader = { runtime, disks: folderDisks, own }
  // The lane whose proposed changes the rig shows, built as the host builds them.
  let shown: FolderProposedChangesRecord | undefined
  const accepter = createFolderAccept({
    root: folder,
    line,
    queue: project,
    reader,
    states: store.states,
    proposed: lane => (shown?.lane === lane ? shown : undefined),
    journals: () => [
      ...recordsOf(ACCEPT_JOURNAL, values(ACCEPT_JOURNAL.namespace)).values(),
    ],
    write: store.write,
    newId,
    now: () => ids,
    moved: () => {},
    log: () => {},
  })
  const graph = () => stateGraph(store.states())
  let lanes = 0
  const started: ThreadId[] = []

  /** A lane begun on `from`, accepted work's or another lane's, its disk restored from that state's snapshot. */
  async function startLane(
    from: PointId,
    kind: "accepted" | "branch",
  ): Promise<RigLane> {
    const start: ForkStart =
      kind === "accepted"
        ? { kind: "accepted", point: from }
        : { kind: "recorded", points: [from] }
    const lane = threadIdFor(`folder-${n}-${lanes++}`)
    started.push(lane)
    const proven = { lane, history: "folder" } as unknown as FolderLane
    const laneDir = disks.lane(lane)
    const history = folderHistory({
      lane: proven,
      runners: {
        lane: argv => {
          const [program = "", ...args] = argv
          return run(program, args, { cwd: laneDir })
        },
        laneBytes: unused("laneBytes"),
      },
      runtime,
      disks: folderDisks,
      queue: project,
      store,
      own,
      newId,
      now: () => ids,
    })
    await runtime.disk({ kind: "restore", lane, from: snapshotId(from) })
    await history.begun(start)
    let queue: Promise<unknown> = Promise.resolve()
    return {
      lane,
      async write(file, text) {
        await mkdir(path.dirname(path.join(laneDir, file)), {
          recursive: true,
        })
        await writeFile(path.join(laneDir, file), text)
      },
      read: file =>
        readFile(path.join(laneDir, file), "utf8").catch(() => null),
      withHistory<T>(f: (h: LaneHistory) => Promise<T>) {
        const next = queue.then(() => f(history))
        queue = next.catch(() => {})
        return next
      },
      settled: async () => {},
      // A folder's history has no commits of the agent's own.
      commitAsAgent: async () => {},
    }
  }

  return {
    async yoursOnAccepted(files) {
      for (const [file, text] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(folder, file)), { recursive: true })
        await writeFile(path.join(folder, file), text)
      }
      return line.read()
    },

    lane: async () => {
      const newest = await line.read()
      return startLane(newest, "accepted")
    },
    branch: from => startLane(from, "branch"),

    async sweep() {
      const gone = planSweep({
        states: store.states(),
        lanes: started.map(lane => ({ lane, history: "folder" as const })),
        conflicts: [
          ...recordsOf(CONFLICT, values(CONFLICT.namespace)).values(),
        ],
        proposed: [],
        journals: [],
        keep: 1,
      })
      if (gone.length > 0)
        await runtime.disk({
          kind: "deleteSnapshots",
          ids: gone.map(snapshotId),
        })
      return gone
    },
    snapshotExists: state => runtime.snapshotExists(snapshotId(state)),
    deleteSnapshot: state =>
      runtime.disk({ kind: "deleteSnapshots", ids: [snapshotId(state)] }),
    graph,

    fileAt: (site, p) =>
      folderFileAt({ states: store.states, disks: folderDisks }, site, p),

    isAncestor: async (_lane, a, b) => isAncestor(graph(), a, b),

    // Deliberately not the adapter's own diff: git's, of the two snapshots.
    async changedPaths(_lane, from, to) {
      const ran = await run(
        "git",
        ["diff", "--no-index", "--name-only", "--no-renames", from, to],
        { cwd: disks.snapshots },
      )
      if (ran.code !== 0 && ran.code !== 1)
        throw new Error(`git diff: ${ran.stderr}`)
      return lines(ran.stdout)
        .map(l => l.replace(new RegExp(`^(${from}|${to})/`), ""))
        .sort()
    },

    async accept({ lane }) {
      // The proposed changes as the host shows them: the lane's tip merged
      // onto accepted work's newest, read after the folder's last save.
      const newest = await line.read()
      const tip = laneNewest(graph(), lane)
      if (tip === null) throw new Error("nothing to accept")
      const merged = await project.enqueue(() =>
        makeShownMerge(reader, store.states, newest, tip, null),
      )
      if (merged === null) throw new Error("the shown merge's base is gone")
      shown = {
        kind: "folder",
        lane,
        start: newest,
        tip,
        files: await sourceChanges(reader, newest, shownMergeId(newest, tip)),
        conflicts: [...merged.paths],
        description: null,
        at: ids,
      }
      const answer = await accepter.accept(
        lane,
        { kind: "folder", start: newest, tip, conflicted: false },
        writerId("rig@pinetrie.invalid"),
      )
      if (answer.kind !== "done")
        throw new Error(`the accept was refused: ${JSON.stringify(answer)}`)
      const accepted = folderNewest(graph())
      if (accepted === null)
        throw new Error("no accepted work after the accept")
      return accepted
    },

    statesDir: async lane => disks.states(lane),

    close: async () => {
      await call({ kind: "removeProject", project: key })
      await rm(dir, { recursive: true, force: true })
    },
  }
}

describe.skipIf(!onBtrfs)(
  "the port suite against the folder adapter, on btrfs (skipped: not on btrfs here)",
  () => {
    historySuite({ test, expect }, makeRig)
  },
)

describe.skipIf(!onBtrfs)(
  "a folder lane's conflicts, on btrfs (skipped: not on btrfs here)",
  () => {
    const TURN = { title: "a turn", entry: entryId("e-1") }
    test("a conflicted catch-up shows three versions; resolve_conflict writes the one chosen and closes it", async () => {
      const rig = await makeRig()
      try {
        await rig.yoursOnAccepted({ "a.txt": "one\ntwo\nthree\n" })
        const lane = await rig.lane()
        await lane.write("a.txt", "one\ntwo (lane)\nthree\n")
        await lane.withHistory(h => h.recordTurn(TURN))
        const point = await rig.yoursOnAccepted({
          "a.txt": "one\ntwo (yours)\nthree\n",
        })
        const merged = await lane.withHistory(async h =>
          h.merge(
            folderCopyReady(),
            { kind: "accepted", point, mark: false },
            null,
          ),
        )
        expect(merged.kind).toBe("conflicted")
        expect(await lane.read("a.txt")).toBe("one\ntwo (lane)\nthree\n")
        const versions = await rig.statesDir(lane.lane)
        expect(
          await readFile(path.join(versions, "conflicts/a.txt/theirs"), "utf8"),
        ).toBe("one\ntwo (yours)\nthree\n")
        expect(
          await lane.withHistory(h => h.resolve("a.txt", "theirs")),
        ).toEqual({ kind: "resolved" })
        expect(await lane.read("a.txt")).toBe("one\ntwo (yours)\nthree\n")
        expect(await lane.withHistory(h => h.conflicts())).toEqual([])
        expect(await lane.withHistory(h => h.resolve("a.txt", "ours"))).toEqual(
          { kind: "refused", why: "no-conflict" },
        )
      } finally {
        await rig.close()
      }
    })
  },
)

describe.skipIf(!onBtrfs)(
  "a folder lane's catch-ups after a sweep, and its virtual bases, on btrfs (skipped: not on btrfs here)",
  () => {
    const turn = (n: number) => ({
      title: `turn ${n}`,
      entry: entryId(`e-${n}`),
    })
    const recorded = async (lane: RigLane, n: number) => {
      const made = await lane.withHistory(h => h.recordTurn(turn(n)))
      if (made.committed === null) throw new Error("the turn changed nothing")
      return made.committed
    }
    const merge = (lane: RigLane, from: BaseMerge) =>
      lane.withHistory(h => h.merge(folderCopyReady(), from, null))
    const withAccepted = (point: PointId): BaseMerge => ({
      kind: "accepted",
      point,
      mark: false,
    })
    const withParent = (
      parent: RigLane,
      point: PointId,
      caughtUpWith: PointId,
    ): BaseMerge => ({
      kind: "parent",
      lane: parent.lane,
      name: "amber-fox" as ThreadName,
      point,
      caughtUpWith,
    })
    const lines = (...ls: string[]) => `${ls.join("\n")}\n`

    test("a branch catches up with its parent after a sweep, the parent's turn it began on kept", async () => {
      const rig = await makeRig()
      try {
        await rig.yoursOnAccepted({ "a.txt": lines("1", "2", "3", "4") })
        const parent = await rig.lane()
        await parent.write("a.txt", lines("P", "2", "3", "4"))
        const p1 = await recorded(parent, 1)
        const branch = await rig.branch(p1)
        await branch.write("a.txt", lines("P", "2", "3", "B"))
        await recorded(branch, 2)
        await parent.write("a.txt", lines("P", "PP", "3", "4"))
        const p2 = await recorded(parent, 3)
        await rig.sweep()
        expect(await rig.snapshotExists(p1)).toBe(true)
        const merged = await merge(branch, withParent(parent, p2, p1))
        expect(merged.kind).toBe("clean")
        expect(await branch.read("a.txt")).toBe(lines("P", "PP", "3", "B"))
      } finally {
        await rig.close()
      }
    })

    test("a branch whose fork began on accepted work catches up cleanly with its parent after a sweep", async () => {
      const rig = await makeRig()
      try {
        await rig.yoursOnAccepted({ "a.txt": lines("1", "2", "3", "4") })
        const parent = await rig.lane()
        await parent.write("a.txt", lines("P", "2", "3", "4"))
        const p1 = await recorded(parent, 1)
        // Its source snapshot lost, the fork began on accepted work's newest.
        const branch = await rig.lane()
        await branch.write("a.txt", lines("1", "2", "3", "B"))
        await recorded(branch, 2)
        await parent.write("a.txt", lines("P", "PP", "3", "4"))
        const p2 = await recorded(parent, 3)
        expect(await rig.sweep()).toContain(p1)
        const merged = await merge(branch, withParent(parent, p2, p1))
        expect(merged.kind).toBe("clean")
        expect(await branch.read("a.txt")).toBe(lines("P", "PP", "3", "B"))
      } finally {
        await rig.close()
      }
    })

    test("a catch-up whose base's snapshot is gone is refused with words, and makes nothing", async () => {
      const rig = await makeRig()
      try {
        await rig.yoursOnAccepted({ "a.txt": lines("1", "2") })
        const parent = await rig.lane()
        await parent.write("a.txt", lines("P", "2"))
        const p1 = await recorded(parent, 1)
        const branch = await rig.branch(p1)
        await branch.write("a.txt", lines("P", "B"))
        const b1 = await recorded(branch, 2)
        await parent.write("a.txt", lines("PP", "2"))
        const p2 = await recorded(parent, 3)
        await rig.deleteSnapshot(p1)
        const states = rig.graph().states.size
        expect(await merge(branch, withParent(parent, p2, p1))).toEqual({
          kind: "refused",
          reason:
            "the state this thread shares with amber-fox is no longer kept",
          follow: null,
        })
        expect(rig.graph().states.size).toBe(states)
        expect(laneNewest(rig.graph(), branch.lane)).toBe(b1)
        expect(await branch.read("a.txt")).toBe(lines("P", "B"))
      } finally {
        await rig.close()
      }
    })

    /**
     * A criss-cross, as the graph's flows E2 and F (`graph.test.ts`): the
     * lane's turn; a read with a change of yours; the turn accepted over
     * that read, and the lane caught up with the read alone. Accepted
     * work's newest (`theirs`) and the lane then have two merge bases, the
     * turn and the read.
     */
    async function crissCross(
      rig: FolderRig,
      files: {
        readonly start: string
        readonly lane: string
        readonly yours: string
        /** The lane's file once its first catch-up conflicted, resolved as its own. */
        readonly accepted: string
      },
    ) {
      await rig.yoursOnAccepted({ "a.txt": files.start })
      const lane = await rig.lane()
      await lane.write("a.txt", files.lane)
      await recorded(lane, 1)
      const yours = await rig.yoursOnAccepted({ "a.txt": files.yours })
      await rig.accept(lane)
      // Accepted work then takes its own file.
      const theirs = await rig.yoursOnAccepted({ "a.txt": files.accepted })
      const first = await merge(lane, withAccepted(yours))
      if (first.kind === "conflicted")
        await lane.withHistory(h => h.resolve("a.txt", "ours"))
      const caughtUp = laneNewest(rig.graph(), lane.lane)
      if (caughtUp === null) throw new Error("the lane has no state")
      const plan = planBase(rig.graph(), caughtUp, theirs)
      if (plan?.kind !== "virtual") throw new Error("no criss-cross")
      return { lane, theirs, caughtUp, base: plan.name }
    }

    const E2 = {
      start: lines("x", "1", "2", "y", "3", "4", "z"),
      lane: lines("x", "1", "2", "Y1", "3", "4", "z"),
      yours: lines("X", "1", "2", "y", "3", "4", "z"),
      accepted: lines("X", "1", "2", "Y1", "3", "4", "z"),
    }
    // Your change and the lane's are on lines of their own, so the accept
    // is clean; the conflict comes after, at the last line, which the lane
    // and accepted work then change apart.
    const F = {
      start: lines("x", "1", "2", "y", "3", "4", "z"),
      lane: lines("x", "1", "2", "Y1", "3", "4", "z"),
      yours: lines("X", "1", "2", "y", "3", "4", "z"),
      accepted: lines("X", "1", "2", "Y1", "3", "4", "Zyours"),
    }

    test("a clean catch-up over a virtual base leaves no snapshot of it; two in turn each make it", async () => {
      const rig = await makeRig()
      try {
        const { lane, theirs, caughtUp, base } = await crissCross(rig, E2)
        const branch = await rig.branch(caughtUp)
        expect((await merge(lane, withAccepted(theirs))).kind).toBe("clean")
        expect(await rig.snapshotExists(base)).toBe(false)
        expect(rig.graph().states.has(base)).toBe(false)
        expect((await merge(branch, withAccepted(theirs))).kind).toBe("clean")
        expect(await rig.snapshotExists(base)).toBe(false)
      } finally {
        await rig.close()
      }
    })

    test("a virtual base a conflict names is recorded and kept, a clean catch-up over it after included", async () => {
      const rig = await makeRig()
      try {
        const { lane, theirs, caughtUp, base } = await crissCross(rig, F)
        // Branched before the conflict, it takes your line: clean over the same bases.
        const branch = await rig.branch(caughtUp)
        await branch.write("a.txt", F.accepted)
        await recorded(branch, 2)
        await lane.write("a.txt", lines("X", "1", "2", "Y1", "3", "4", "Zlane"))
        await recorded(lane, 3)
        expect((await merge(lane, withAccepted(theirs))).kind).toBe(
          "conflicted",
        )
        expect(rig.graph().states.get(base)?.made).toEqual({
          kind: "bases-merged",
        })
        expect(await rig.snapshotExists(base)).toBe(true)
        expect((await merge(branch, withAccepted(theirs))).kind).toBe("clean")
        expect(await rig.snapshotExists(base)).toBe(true)
      } finally {
        await rig.close()
      }
    })
  },
)

test("a folder lane's fork restores from accepted work's state, or from its source's snapshot when branched", () => {
  const h = folderHistory({
    lane: {
      lane: threadIdFor("fork"),
      history: "folder",
    } as unknown as FolderLane,
    runners: {
      lane: async () => {
        throw new Error("no lane")
      },
      laneBytes: async () => {
        throw new Error("no lane")
      },
    },
    runtime: {} as LaneRuntime,
    disks: {} as FolderDisks,
    queue: createQueue(),
    store: { states: () => [], conflicts: () => [], write: async () => {} },
    own: () => "",
    newId: () => "0",
    now: () => 0,
  })
  const line = lineStateId("0192aaaa")
  expect(h.forkSteps({ kind: "accepted", point: line })).toMatchObject({
    from: line,
    steps: [],
  })
  expect(
    h.forkSteps({ kind: "recorded", points: [lineStateId("0192bbbb")] }),
  ).toMatchObject({ from: null, steps: [] })
})

test("every folder state is snapshotted straight after its lane's sync", async () => {
  // One list of the lane's commands and the runtime's disk ops, in order.
  const calls: string[] = []
  const lane = threadIdFor("sync")
  const read = (id: string, ...parents: PointId[]): StateRecord => ({
    id: lineStateId(id),
    parents,
    made: { kind: "read" },
    at: 0,
    by: null,
  })
  const first = read("0192aaaa")
  const records: StateRecord[] = [first]
  let ids = 0
  const h = folderHistory({
    lane: { lane, history: "folder" } as unknown as FolderLane,
    runners: {
      lane: async argv => {
        calls.push(`lane ${argv.join(" ")}`)
        return { ok: true, code: 0, stdout: "", stderr: "" }
      },
      laneBytes: async () => {
        throw new Error("no bytes")
      },
    },
    runtime: {
      disk: async op => {
        calls.push(`disk ${op.kind}`)
      },
      snapshotExists: async () => true,
      // A turn's diff from the lane's start reports the file it wrote.
      diff: async from => ({
        changes: from.includes("start-")
          ? [{ kind: "file", path: "a.txt", change: "added" }]
          : [],
      }),
    } as Partial<LaneRuntime> as LaneRuntime,
    disks: {
      filesUnder: async () => [],
      sameContent: async () => [],
      pathFacts: async () => [],
      read: async () => null,
      applyMerge: async () => [],
      states: async () => {},
    } as Partial<FolderDisks> as FolderDisks,
    queue: createQueue(),
    store: {
      states: () => records,
      conflicts: () => [],
      write: async writes => {
        for (const w of writes)
          if (w.kind === "set" && w.namespace === STATE.namespace)
            records.push(
              ...recordsOf(STATE, [{ key: w.key, value: w.value }]).values(),
            )
      },
    },
    own: () => "",
    newId: () => `0192${String(ids++).padStart(4, "0")}`,
    now: () => 0,
  })
  await h.begun({ kind: "accepted", point: first.id })
  const turn = await h.recordTurn({ title: "a turn", entry: entryId("e-1") })
  expect(turn.committed).not.toBeNull()
  const next = read("0192bbbb", first.id)
  records.push(next)
  const merged = await h.merge(
    folderCopyReady(),
    { kind: "accepted", point: next.id, mark: false },
    null,
  )
  expect(merged.kind).toBe("clean")
  const snapshots = calls.flatMap((c, i) => (c === "disk snapshot" ? [i] : []))
  expect(snapshots).toHaveLength(3)
  for (const i of snapshots) expect(calls[i - 1]).toBe("lane sync")
})
