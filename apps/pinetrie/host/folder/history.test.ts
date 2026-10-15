// The port suite against the folder adapter: lanehost's disks role run in
// this process over a btrfs directory, as `packages/lanehost/disks.test.ts`
// runs it, your folder a directory beside it, and a lane's commands run on
// the host in its disk. The rig's test-only hooks read the graph and a
// diff of their own (`git diff --no-index` of two snapshots), and accept an
// offer by writing the lane's tip into your folder and recording the read
// as an accept. Where there is no btrfs, it skips, saying why.

import { cp, mkdir, readFile, rm, statfs, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  type ConflictRecord,
  entryId,
  folderCopyReady,
  lineStateId,
  type StateRecord,
  snapshotId,
  type ThreadId,
  threadIdFor,
  type ValueWrite,
} from "@pinetrie/core"
import {
  folderNewest,
  isAncestor,
  laneNewest,
  stateGraph,
} from "@pinetrie/folder"
import { projectDisks } from "@pinetrie/lanehost"
import { disksInProcess } from "@pinetrie/lanehost/fixtures"
import {
  type FolderDisks,
  type LaneHistory,
  type LaneRuntime,
  laneIgnores,
  lines,
  run,
} from "@pinetrie/lanes"
import { type HistoryRig, historySuite } from "@pinetrie/lanes/testing"
import { CONFLICT, recordsOf, STATE, setRecord } from "@pinetrie/rules"
import { afterAll, describe, expect, test } from "vitest"
import { folderFileAt } from "./file-at.ts"
import { folderHistory } from "./history.ts"
import { createFolderLine } from "./line.ts"
import type { FolderLane } from "./proven.ts"
import { scanFolder } from "./scan.ts"

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

/** A rig: lanehost in this process, a project key and a folder of its own. */
/** The suite's rig, and where a lane's states directory is. */
type FolderRig = HistoryRig & { statesDir(lane: ThreadId): Promise<string> }

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
  const line = createFolderLine({
    root: folder,
    own,
    disks: folderDisks,
    stampsFile: path.join(dir, "folder-stamps.json"),
    states: store.states,
    writeState: r => store.write([setRecord(STATE, r)]),
    newId,
    now: () => ids,
    moved: () => {},
  })
  const graph = () => stateGraph(store.states())
  let lanes = 0

  return {
    async yoursOnAccepted(files) {
      for (const [file, text] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(folder, file)), { recursive: true })
        await writeFile(path.join(folder, file), text)
      }
      return line.read()
    },

    async lane() {
      const lane = threadIdFor(`folder-${n}-${lanes++}`)
      const newest = await line.read()
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
        store,
        own,
        newId,
        now: () => ids,
      })
      await runtime.disk({ kind: "restore", lane, from: snapshotId(newest) })
      await history.begun({ kind: "accepted", point: newest })
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
    },

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
      const g = graph()
      const tip = laneNewest(g, lane)
      const newest = folderNewest(g)
      if (tip === null || newest === null) throw new Error("nothing to accept")
      // Your folder made the lane's tip, as the next plan's accept writes it.
      await rm(folder, { recursive: true, force: true })
      await cp(disks.snapshot(tip), folder, {
        recursive: true,
        verbatimSymlinks: true,
      })
      const scan = await scanFolder({ root: folder, own: own() })
      const state = lineStateId(newId())
      const answered = await folderDisks.readIn({
        from: null,
        state,
        paths: [...scan].map(([p, s]) => ({
          path: p,
          stamp: { size: s.size, ctimeNs: s.ctimeNs },
        })),
        deleted: [],
      })
      if (answered.kind !== "made") throw new Error("the accept's read moved")
      const record: StateRecord = {
        id: state,
        parents: [newest, tip],
        made: { kind: "accept", lane },
        at: ids,
        by: null,
      }
      await store.write([setRecord(STATE, record)])
      return state
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

test("a folder lane's fork restores from your folder's state, or from its source's snapshot when branched", () => {
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
