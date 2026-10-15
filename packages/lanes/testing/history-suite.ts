// lanes/testing/history-suite — the history algebra's laws, each one test
// titled by its sentence (`packages/lanes/TECHNICAL.md` states them), beside
// examples of what any adapter's `LaneHistory` must do. Each runs against a
// rig the adapter's own tests make: accepted work, lanes started on it, a
// lane's files to write, and test-only hooks that read what the port never
// gives (ancestry, a diff). `test` and `expect` are the caller's, so this
// package depends on no test runner.

import {
  type BaseMerge,
  entryId,
  type PointId,
  type ThreadId,
} from "@pinetrie/core"
import type {
  Edits,
  FileAt,
  LaneHistory,
  MergeDone,
  ReadSite,
  TurnMade,
} from "../history-port.ts"

/** A lane of the rig's, started on accepted work as it was then. */
export interface RigLane {
  readonly lane: ThreadId
  /** Write `text` at `path` in the lane's copy, as a tool would. */
  write(path: string, text: string): Promise<void>
  /** `path`'s text in the lane's copy; null when there is none. */
  read(path: string): Promise<string | null>
  /** `f` with the lane's history, on its queue. */
  withHistory<T>(f: (h: LaneHistory) => Promise<T>): Promise<T>
  /** Settles when the work every move's `follow` scheduled so far has. */
  settled(): Promise<void>
  /**
   * Test-only: an agent's own commit of what the copy holds, as `jj commit`
   * in a tool call makes, where its history has one; nothing where it has
   * none.
   */
  commitAsAgent(message: string): Promise<void>
}

/**
 * Accepted work and its lanes. The hooks marked test-only read what a law
 * needs and the port never gives: no lane work calls them.
 */
export interface HistoryRig {
  /** Your own work on accepted work, `files` written; accepted work's new state. */
  yoursOnAccepted(files: Readonly<Record<string, string>>): Promise<PointId>
  /** A new lane, started on accepted work now. */
  lane(): Promise<RigLane>
  /** `path` at `site` of the destination (`Destination.fileAt`). */
  fileAt(site: ReadSite, path: string): Promise<FileAt>
  /** Test-only: whether `a` is `b` or one of its ancestors, in `lane`'s history. */
  isAncestor(lane: ThreadId, a: PointId, b: PointId): Promise<boolean>
  /**
   * Test-only: the paths that differ between `from` and `to`, in `lane`'s
   * history, sorted; read independently of the adapter's own diff, which
   * "A turn's paths are its diff." tests.
   */
  changedPaths(
    lane: ThreadId,
    from: PointId,
    to: PointId,
  ): Promise<readonly string[]>
  /**
   * Test-only: `lane`'s offer accepted into accepted work, as the
   * destination accepts one; accepted work's new state.
   */
  accept(lane: RigLane): Promise<PointId>
  close(): Promise<void>
}

/** The parts of a test runner the suite calls. */
export interface SuiteRunner {
  readonly test: (
    name: string,
    body: () => Promise<void>,
    timeout?: number,
  ) => void
  readonly expect: (value: unknown) => {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toBeNull(): void
  }
}

const TURN = { title: "a turn", entry: entryId("e-1") }

/** A catch-up with accepted work's `point`. */
const acceptedMerge = (point: PointId): BaseMerge => ({
  kind: "accepted",
  point,
  mark: false,
})

/** `lane` caught up with accepted work's `point`, its copy found ready. */
const catchUp = (
  lane: RigLane,
  point: PointId,
  edits: Edits | null = null,
): Promise<MergeDone> =>
  lane.withHistory(async h => {
    const ready = await h.readyToMerge()
    if (typeof ready === "string") throw new Error(ready)
    return h.merge(ready, acceptedMerge(point), edits)
  })

const texts = (lane: RigLane, paths: readonly string[]) =>
  Promise.all(paths.map(p => lane.read(p)))

export function historySuite(
  { test, expect }: SuiteRunner,
  make: () => Promise<HistoryRig>,
): void {
  /** `body` with a rig whose accepted work holds `a.txt`, closed after. */
  const withRig = (name: string, body: (rig: HistoryRig) => Promise<void>) =>
    test(name, async () => {
      const rig = await make()
      try {
        await rig.yoursOnAccepted({ "a.txt": "one\ntwo\nthree\n" })
        await body(rig)
      } finally {
        await rig.close()
      }
    }, 60_000)

  withRig(
    "a lane started from accepted work has a base naming it",
    async rig => {
      const accepted = await rig.yoursOnAccepted({ "b.txt": "b\n" })
      const lane = await rig.lane()
      const base = await lane.withHistory(h => h.base())
      expect(base?.base).toEqual({ kind: "accepted" })
      expect(base?.start).toBe(accepted)
    },
  )

  withRig("A merge of what the lane holds merges nothing.", async rig => {
    const lane = await rig.lane()
    const paths = ["a.txt", "b.txt"]
    const start = (await lane.withHistory(h => h.base()))?.start
    if (start === undefined) throw new Error("the lane has no base")
    const before = await texts(lane, paths)
    const own = await catchUp(lane, start)
    expect(own.kind).toBe("nothing")
    expect(own.kind === "nothing" ? own.mark : null).toBeNull()
    expect(await texts(lane, paths)).toEqual(before)
    const accepted = await rig.yoursOnAccepted({ "b.txt": "b\n" })
    expect((await catchUp(lane, accepted)).kind).toBe("clean")
    const held = await texts(lane, paths)
    expect((await catchUp(lane, accepted)).kind).toBe("nothing")
    expect(await texts(lane, paths)).toEqual(held)
  })

  // The paths are compared with the rig's own diff alone, never with a
  // list written here: then a bug in the adapter's diff fails this test
  // only while the rig's diff is independent of it.
  withRig("A turn's paths are its diff.", async rig => {
    const lane = await rig.lane()
    const empty = await lane.withHistory(h => h.recordTurn(TURN))
    expect(empty.committed).toBeNull()
    expect(empty.paths).toEqual([])
    /** The turn's paths, and the rig's diff from its newest state to it. */
    const sides = async (made: TurnMade) => {
      if (made.newest === null || made.committed === null)
        throw new Error("the turn has no state, or none before it")
      return {
        paths: [...made.paths].sort(),
        diff: await rig.changedPaths(lane.lane, made.newest, made.committed),
      }
    }
    await lane.write("a.txt", "one\n2\nthree\n")
    await lane.write("d/c.txt", "c\n")
    const made = await lane.withHistory(h => h.recordTurn(TURN))
    expect(made.conflicts).toEqual([])
    const two = await sides(made)
    expect(two.paths).toEqual(two.diff)
    // A turn the agent committed itself, in two commits, is adopted whole.
    await lane.write("e.txt", "e\n")
    await lane.commitAsAgent("agent: e")
    await lane.write("a.txt", "one\n2\n3\n")
    await lane.commitAsAgent("agent: a")
    const adopted = await sides(await lane.withHistory(h => h.recordTurn(TURN)))
    expect(adopted.paths).toEqual(adopted.diff)
  })

  withRig("a commit with nothing changed commits nothing", async rig => {
    const lane = await rig.lane()
    expect((await lane.withHistory(h => h.commit(TURN))).point).toBeNull()
  })

  withRig("A clean merge descends from both sides.", async rig => {
    const lane = await rig.lane()
    await lane.write("a.txt", "one\ntwo (lane)\nthree\n")
    await lane.withHistory(h => h.recordTurn(TURN))
    const accepted = await rig.yoursOnAccepted({ "b.txt": "b\n" })
    await lane.write("c.txt", "edited between runs\n")
    const merged = await catchUp(lane, accepted, {
      title: "edits between runs",
      entry: entryId("e-2"),
    })
    if (merged.kind !== "clean") throw new Error(`not clean: ${merged.kind}`)
    expect(await rig.isAncestor(lane.lane, merged.ours, merged.merge)).toBe(
      true,
    )
    expect(await rig.isAncestor(lane.lane, merged.from, merged.merge)).toBe(
      true,
    )
    expect(await lane.read("a.txt")).toBe("one\ntwo (lane)\nthree\n")
    expect(await lane.read("b.txt")).toBe("b\n")
    expect(await lane.read("c.txt")).toBe("edited between runs\n")
  })

  withRig(
    "a catch-up that changed a line the lane changed differently is conflicted there, schedules no fetch, and its conflicts name it",
    async rig => {
      const lane = await rig.lane()
      await lane.write("a.txt", "one\ntwo (lane)\nthree\n")
      await lane.withHistory(h => h.recordTurn(TURN))
      const accepted = await rig.yoursOnAccepted({
        "a.txt": "one\ntwo (yours)\nthree\n",
      })
      const merged = await catchUp(lane, accepted)
      expect(merged.kind).toBe("conflicted")
      expect(merged.follow).toBeNull()
      expect(await lane.withHistory(h => h.conflicts())).toEqual(["a.txt"])
    },
  )

  withRig("a copy on its line is ready to merge", async rig => {
    const lane = await rig.lane()
    const ready = await lane.withHistory(h => h.readyToMerge())
    expect(typeof ready).toBe("object")
  })

  withRig(
    "a file is read at accepted work, at a lane's tip and at its start",
    async rig => {
      const lane = await rig.lane()
      expect(
        await rig.fileAt({ kind: "tip", lane: lane.lane }, "a.txt"),
      ).toEqual({ kind: "no-site" })
      await lane.write("a.txt", "one\ntwo (lane)\nthree\n")
      const made = await lane.withHistory(h => h.recordTurn(TURN))
      made.follow?.()
      await lane.settled()
      const text = async (site: ReadSite) => {
        const read = await rig.fileAt(site, "a.txt")
        return read.kind === "read" ? read.text : "no site"
      }
      expect(await text({ kind: "accepted" })).toBe("one\ntwo\nthree\n")
      expect(await text({ kind: "tip", lane: lane.lane })).toBe(
        "one\ntwo (lane)\nthree\n",
      )
      expect(await text({ kind: "start", lane: lane.lane })).toBe(
        "one\ntwo\nthree\n",
      )
    },
  )

  withRig("An accept then a catch-up changes no file.", async rig => {
    /** `lane`'s catch-up with `point`: nothing, or clean with no file, its copy unchanged. */
    const changesNoFile = async (lane: RigLane, point: PointId) => {
      const before = await texts(lane, ["a.txt"])
      const merged = await catchUp(lane, point)
      expect(
        merged.kind === "conflicted"
          ? merged.kind
          : merged.kind === "clean"
            ? merged.files
            : [],
      ).toEqual([])
      expect(await texts(lane, ["a.txt"])).toEqual(before)
    }
    // Caught up at once.
    const a = await rig.lane()
    await a.write("a.txt", "one\ntwo (a)\nthree\n")
    await a.withHistory(h => h.recordTurn(TURN))
    await changesNoFile(a, await rig.accept(a))
    // The accepted lines edited again first, with no catch-up between.
    const b = await rig.lane()
    await b.write("a.txt", "one\ntwo (b)\nthree\n")
    await b.withHistory(h => h.recordTurn(TURN))
    const accepted = await rig.accept(b)
    await b.write("a.txt", "one\ntwo (b again)\nthree\n")
    await b.withHistory(h => h.recordTurn(TURN))
    await changesNoFile(b, accepted)
  })
}
