// lanes/testing/history-suite — what any adapter's `LaneHistory` must do, run
// against a rig the adapter's own tests make: accepted work, lanes started
// on it, and a lane's files to write. `test` and `expect` are the caller's,
// so this package depends on no test runner.

import {
  type BaseMerge,
  type CommitId,
  entryId,
  type ThreadId,
} from "@pinetrie/core"
import type { FileAt, LaneHistory, Point } from "../history-port.ts"

/** A lane of the rig's, started on accepted work as it was then. */
export interface RigLane {
  readonly lane: ThreadId
  /** Write `text` at `path` in the lane's copy, as a tool would. */
  write(path: string, text: string): Promise<void>
  /** `path`'s text in the lane's copy; null when there is none. */
  read(path: string): Promise<string | null>
  /** `f` with the lane's history, on its queue. */
  withHistory<T>(f: (h: LaneHistory) => Promise<T>): Promise<T>
  /** Move the copy off the lane's line, as a split's stack leaves it. */
  offLine(): Promise<void>
  /** Each fetch a move's `follow` scheduled, as it was scheduled. */
  readonly fetched: readonly unknown[]
  /** Settles when every fetch scheduled so far has. */
  settled(): Promise<void>
}

export interface HistoryRig {
  /** Make accepted work's next commit, with `files` written; returns it. */
  accept(files: Readonly<Record<string, string>>): Promise<CommitId>
  /** A new lane, started on accepted work now. */
  lane(): Promise<RigLane>
  /** `path` at `point` of the destination (`Destination.fileAt`). */
  fileAt(point: Point, path: string): Promise<FileAt>
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

/** A catch-up with accepted work's `commit`. */
const acceptedMerge = (commit: CommitId): BaseMerge => ({
  kind: "accepted",
  commit,
  mark: false,
})

export function historySuite(
  { test, expect }: SuiteRunner,
  make: () => Promise<HistoryRig>,
): void {
  /** `body` with a rig whose accepted work holds `a.txt`, closed after. */
  const withRig = (name: string, body: (rig: HistoryRig) => Promise<void>) =>
    test(name, async () => {
      const rig = await make()
      try {
        await rig.accept({ "a.txt": "one\ntwo\nthree\n" })
        await body(rig)
      } finally {
        await rig.close()
      }
    }, 60_000)

  withRig(
    "a lane started from accepted work has a base naming it",
    async rig => {
      const accepted = await rig.accept({ "b.txt": "b\n" })
      const lane = await rig.lane()
      const base = await lane.withHistory(h => h.base())
      expect(base?.base).toEqual({ kind: "accepted" })
      expect(base?.start).toBe(accepted)
    },
  )

  withRig(
    "a turn that writes two files records both; one that writes nothing records none",
    async rig => {
      const lane = await rig.lane()
      expect(
        (await lane.withHistory(h => h.recordTurn(TURN))).committed,
      ).toBeNull()
      await lane.write("a.txt", "one\n2\nthree\n")
      await lane.write("d/c.txt", "c\n")
      const made = await lane.withHistory(h => h.recordTurn(TURN))
      expect([...made.paths].sort()).toEqual(["a.txt", "d/c.txt"])
      expect(made.conflicts).toEqual([])
    },
  )

  withRig("a commit with nothing changed commits nothing", async rig => {
    const lane = await rig.lane()
    expect((await lane.withHistory(h => h.commit(TURN))).commit).toBeNull()
  })

  withRig(
    "a turn that committed, and a clean merge, each schedule one fetch",
    async rig => {
      const lane = await rig.lane()
      await lane.write("a.txt", "one\ntwo (lane)\nthree\n")
      const made = await lane.withHistory(h => h.recordTurn(TURN))
      expect(made.committed === null).toBe(false)
      made.follow?.()
      await lane.settled()
      expect(lane.fetched.length).toBe(1)
      const accepted = await rig.accept({ "b.txt": "b\n" })
      const merged = await lane.withHistory(async h => {
        const ready = await h.readyToMerge()
        if (typeof ready === "string") throw new Error(ready)
        return h.merge(ready, acceptedMerge(accepted), null)
      })
      expect(merged.kind).toBe("clean")
      merged.follow?.()
      await lane.settled()
      expect(lane.fetched.length).toBe(2)
    },
  )

  withRig(
    "a catch-up with accepted work on other files merges clean, and the lane holds both",
    async rig => {
      const lane = await rig.lane()
      await lane.write("a.txt", "one\ntwo (lane)\nthree\n")
      await lane.withHistory(h => h.recordTurn(TURN))
      const accepted = await rig.accept({ "b.txt": "b\n" })
      await lane.write("c.txt", "edited between runs\n")
      const merged = await lane.withHistory(async h => {
        const ready = await h.readyToMerge()
        if (typeof ready === "string") throw new Error(ready)
        return h.merge(ready, acceptedMerge(accepted), {
          title: "edits between runs",
          entry: entryId("e-2"),
        })
      })
      expect(merged.kind).toBe("clean")
      expect(await lane.read("a.txt")).toBe("one\ntwo (lane)\nthree\n")
      expect(await lane.read("b.txt")).toBe("b\n")
      expect(await lane.read("c.txt")).toBe("edited between runs\n")
    },
  )

  withRig(
    "a catch-up that changed a line the lane changed differently is conflicted there, schedules no fetch, and its conflicts name it",
    async rig => {
      const lane = await rig.lane()
      await lane.write("a.txt", "one\ntwo (lane)\nthree\n")
      await lane.withHistory(h => h.recordTurn(TURN))
      const accepted = await rig.accept({
        "a.txt": "one\ntwo (yours)\nthree\n",
      })
      const merged = await lane.withHistory(async h => {
        const ready = await h.readyToMerge()
        if (typeof ready === "string") throw new Error(ready)
        return h.merge(ready, acceptedMerge(accepted), null)
      })
      expect(merged.kind).toBe("conflicted")
      expect(merged.follow).toBeNull()
      expect(await lane.withHistory(h => h.conflicts())).toEqual(["a.txt"])
    },
  )

  withRig(
    "a copy on its line is ready to merge; one off it is refused",
    async rig => {
      const lane = await rig.lane()
      const ready = await lane.withHistory(h => h.readyToMerge())
      expect(typeof ready).toBe("object")
      await lane.offLine()
      expect(await lane.withHistory(h => h.readyToMerge())).toBe("off-line")
    },
  )

  withRig(
    "a file is read at accepted work, at a lane's tip and at its start",
    async rig => {
      const lane = await rig.lane()
      expect(
        await rig.fileAt({ kind: "tip", lane: lane.lane }, "a.txt"),
      ).toEqual({ kind: "no-point" })
      await lane.write("a.txt", "one\ntwo (lane)\nthree\n")
      const made = await lane.withHistory(h => h.recordTurn(TURN))
      made.follow?.()
      await lane.settled()
      const text = async (point: Point) => {
        const read = await rig.fileAt(point, "a.txt")
        return read.kind === "read" ? read.text : "no point"
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
}
