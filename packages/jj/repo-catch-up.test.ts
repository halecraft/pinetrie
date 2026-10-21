import { cp, readFile } from "node:fs/promises"
import path from "node:path"
import {
  entryId,
  firstLine,
  pointFromCommit,
  trailerRevset,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { jjLaneFor } from "./fixtures.ts"
import { readLaneBookmark } from "./lane/bookmarks.ts"
import { bookmarkRevset, proposedBookmark } from "./lane/names.ts"
import { planForkSetup } from "./lane/plan.ts"
import { commitTurn, readCommits } from "./lane/revisions.ts"
import { planRefreshProposed } from "./plan.ts"
import {
  FORK,
  laneJjRunner,
  laneRigs,
  NAME,
  setUpTurn,
  useLaneRepos,
} from "./repo-rigs.ts"
import { executeRepo } from "./run.ts"

describe("a lane's repo, with jj", () => {
  const repos = useLaneRepos()
  const { turnRig, copiedRig } = laneRigs(repos)

  describe("catching up past an accepted thread commit of the lane's work", () => {
    /** Six lines; `at` replaces line n (1-based). */
    const doc = (at: Record<number, string> = {}) =>
      `${[1, 2, 3, 4, 5, 6].map(n => at[n] ?? `line ${n}`).join("\n")}\n`
    /** `turnRig`, with a turn writing `doc.txt`, its proposed changes accepted into accepted work. */
    const acceptedProposedRig = (tag: string) =>
      copiedRig("accepted-proposed", tag, async rig => {
        const turned = await setUpTurn(rig)
        await rig.edit(rig.laneDir, "doc.txt", doc())
        const t1 = await rig.turn()
        await rig.accept(await rig.proposed(turned.base))
        return { ...turned, t1 }
      })
    /** You change `doc.txt` on accepted work, landing it. */
    const repoOnAccepted = async (
      rig: Awaited<ReturnType<typeof acceptedProposedRig>>,
      text: string,
      title: string,
    ) => {
      await rig.repoJj(["new", rig.line.acceptedBookmark])
      await rig.edit(rig.repoDir, "doc.txt", text)
      await rig.repoJj(["commit", "-m", title])
      await rig.repoJj([
        "bookmark",
        "move",
        rig.line.acceptedBookmark,
        "--to",
        "@-",
      ])
    }
    const read = (dir: string, file: string) =>
      readFile(path.join(dir, file), "utf8")
    /**
     * The lane's tip fetched into your repo, then what the one read says
     * catching up would change, and where the proposed changes start; the
     * separate reads say the same (`agrees`).
     */
    const forecast = async (rig: Awaited<ReturnType<typeof turnRig>>) => {
      await rig.fetch(rig.base)
      const gathered = await rig.agrees()
      if (gathered === "none" || gathered === "unfinished")
        throw new Error("not on accepted work")
      return { files: gathered.getLatest?.files, start: gathered.start }
    }

    test("your own acceptance, then your edit to it on accepted work: clean, and the accepted thread commit is not listed as come in", async () => {
      const rig = await acceptedProposedRig("past-own")
      await repoOnAccepted(rig, doc({ 1: "yours" }), "yours: doc line 1")
      await rig.edit(rig.laneDir, "c.txt", "c\n")
      await rig.turn()
      const merged = await rig.getLatest()
      if (merged.kind !== "clean") throw new Error(`not clean: ${merged.kind}`)
      expect(await read(rig.laneDir, "doc.txt")).toBe(doc({ 1: "yours" }))
      expect(await read(rig.laneDir, "c.txt")).toBe("c\n")
      expect(merged.commits).toContain("yours: doc line 1")
      expect(merged.commits).not.toContain("WIP")
      // Its next proposed changes hold the lane's own work alone.
      const next = await rig.proposed([rig.t1])
      expect([next.conflicted, next.files]).toEqual([false, ["c.txt"]])
      await rig.agrees()
    }, 60_000)

    test("the lane re-edits its own accepted lines: clean, with both edits, and the forecast names the file", async () => {
      const rig = await acceptedProposedRig("past-reedit")
      await repoOnAccepted(rig, doc({ 1: "yours" }), "yours: doc line 1")
      await rig.edit(rig.laneDir, "doc.txt", doc({ 5: "lane again" }))
      await rig.turn()
      expect((await forecast(rig)).files).toEqual(["doc.txt"])
      const merged = await rig.getLatest()
      if (merged.kind !== "clean") throw new Error(`not clean: ${merged.kind}`)
      expect(merged.files).toEqual(["doc.txt"])
      expect(await read(rig.laneDir, "doc.txt")).toBe(
        doc({ 1: "yours", 5: "lane again" }),
      )
    }, 60_000)

    test("the lane re-edits a file of its own accepted proposed changes, accepted work unchanged since: the forecast is none, and so is the merge", async () => {
      const rig = await acceptedProposedRig("past-own-reedit")
      await rig.edit(rig.laneDir, "doc.txt", doc({ 5: "lane again" }))
      await rig.turn()
      const { files, start } = await forecast(rig)
      expect(start).toEqual({ kind: "known", start: [rig.t1] })
      expect(files).toEqual([])
      const merged = await rig.getLatest()
      if (merged.kind !== "clean") throw new Error(`not clean: ${merged.kind}`)
      expect(merged.files).toEqual([])
    }, 60_000)

    test("proposed, caught up, then accepted, and re-edited: the proposed changes start at two commits, and the forecast is none, as the merge", async () => {
      const rig = await turnRig("past-two-starts")
      await rig.edit(rig.laneDir, "doc.txt", doc())
      await rig.turn()
      const proposed = await rig.proposed(rig.base)
      // Accepted work moves by a file of yours, and the lane catches up.
      await rig.repoJj(["new", rig.line.acceptedBookmark])
      await rig.edit(rig.repoDir, "other.txt", "other\n")
      await rig.repoJj(["commit", "-m", "yours: other.txt"])
      await rig.repoJj([
        "bookmark",
        "move",
        rig.line.acceptedBookmark,
        "--to",
        "@-",
      ])
      const upToDate = await rig.getLatest()
      expect(upToDate.kind).toBe("clean")
      // The proposed changes, made before, follows accepted work and is
      // accepted.
      const [bottom] = proposed.built.changeIds
      if (bottom === undefined) throw new Error("no proposed changes")
      await executeRepo(
        rig.repoDir,
        planRefreshProposed(bottom, await rig.acceptedNow()),
      )
      await rig.accept(proposed)
      // The lane re-edits what was accepted.
      await rig.edit(rig.laneDir, "doc.txt", doc({ 5: "lane again" }))
      await rig.turn()
      const { files, start } = await forecast(rig)
      expect(start.kind === "known" && start.start.length).toBe(2)
      expect(files).toEqual([])
      const merged = await rig.getLatest()
      if (merged.kind !== "clean") throw new Error(`not clean: ${merged.kind}`)
      expect(merged.files).toEqual([])
    }, 60_000)

    test("two acceptances, your edit to the first between them: clean", async () => {
      const rig = await acceptedProposedRig("past-two")
      await repoOnAccepted(rig, doc({ 1: "yours" }), "yours: doc line 1")
      await rig.edit(rig.laneDir, "doc.txt", doc({ 5: "lane" }))
      await rig.turn()
      await rig.accept(await rig.proposed([rig.t1]))
      await repoOnAccepted(
        rig,
        doc({ 1: "yours", 5: "yours" }),
        "yours: doc line 5",
      )
      expect((await rig.getLatest()).kind).toBe("clean")
      expect(await read(rig.laneDir, "doc.txt")).toBe(
        doc({ 1: "yours", 5: "yours" }),
      )
      await rig.agrees()
    }, 60_000)

    test("a branch holding its parent's accepted work catches up clean", async () => {
      const rig = await turnRig("past-parent")
      await rig.edit(rig.laneDir, "doc.txt", doc())
      const t1 = await rig.turn()
      // The branch is cloned at the parent's turn, and works on.
      const forkDir = path.join(repos.top, "past-parent-fork")
      await cp(rig.laneDir, forkDir, {
        recursive: true,
        verbatimSymlinks: true,
      })
      await rig.inLane(
        planForkSetup(jjLaneFor(FORK), {
          kind: "recorded",
          points: [t1].map(pointFromCommit),
        }),
        forkDir,
      )
      await rig.edit(forkDir, "k.txt", "k\n")
      await commitTurn(laneJjRunner(forkDir), {
        title: "branch work",
        entry: entryId("e-past-parent-fork"),
        lane: FORK,
        bookmark: await readLaneBookmark(laneJjRunner(forkDir), FORK),
      })
      // The parent's proposed changes are accepted, and you edit it on accepted
      // work.
      await rig.accept(await rig.proposed(rig.base))
      await rig.repoJj(["new", rig.line.acceptedBookmark])
      await rig.edit(rig.repoDir, "doc.txt", doc({ 1: "yours" }))
      await rig.repoJj(["commit", "-m", "yours: doc line 1"])
      await rig.repoJj([
        "bookmark",
        "move",
        rig.line.acceptedBookmark,
        "--to",
        "@-",
      ])
      expect((await rig.getLatest(forkDir, FORK)).kind).toBe("clean")
      expect(await read(forkDir, "doc.txt")).toBe(doc({ 1: "yours" }))
      expect(await read(forkDir, "k.txt")).toBe("k\n")
      await rig.agrees()
    }, 60_000)

    test("a line both rewrote still conflicts, on that file alone, and the accepted thread commit is not its side", async () => {
      const rig = await acceptedProposedRig("past-real")
      await repoOnAccepted(rig, doc({ 1: "yours" }), "yours: doc line 1")
      await rig.edit(rig.laneDir, "doc.txt", doc({ 1: "lane again" }))
      await rig.edit(rig.laneDir, "c.txt", "c\n")
      await rig.turn()
      const merged = await rig.getLatest()
      if (merged.kind !== "conflicted") throw new Error("not conflicted")
      expect(merged.contents.map(c => c.path)).toEqual(["doc.txt"])
      expect(merged.theirs.map(r => firstLine(r.description, 200))).toEqual([
        "yours: doc line 1",
      ])
      await rig.agrees()
    }, 60_000)

    test("proposed changes you edited where the lane wrote: its join conflicts, and is left out", async () => {
      const rig = await turnRig("past-edited")
      await rig.edit(rig.laneDir, "doc.txt", doc())
      await rig.turn()
      const proposed = await rig.proposed(rig.base)
      // You reword the lane's first line in the proposed changes, then accept
      // it.
      const [top] = proposed.built.commits
      if (top === undefined) throw new Error("no proposed changes")
      await rig.repoJj(["new", top])
      await rig.edit(rig.repoDir, "doc.txt", doc({ 1: "edited by you" }))
      // The proposed changes keep its message, and so its `Pinetrie-Source`.
      await rig.repoJj([
        "squash",
        "--ignore-immutable",
        "--use-destination-message",
      ])
      expect(
        await readCommits(
          rig.ops,
          `${bookmarkRevset(proposedBookmark(NAME))} & ${trailerRevset(["source"])}`,
        ),
      ).toHaveLength(1)
      await rig.accept(proposed)
      const merged = await rig.getLatest()
      // Merged as before the joins: no join is left in the lane's history.
      expect(merged.kind).toBe("conflicted")
      expect(
        await readCommits(rig.laneJj, 'description(regex:"^join: ")'),
      ).toEqual([])
      await rig.agrees()
    }, 60_000)
  })
})
