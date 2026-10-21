import { readFile } from "node:fs/promises"
import path from "node:path"
import { threadIdFor } from "@pinetrie/core"
import { hostRunner, type Runner, run } from "@pinetrie/lanes"
import { describe, expect, test } from "vitest"
import { acceptedFacts } from "./accepted.ts"
import {
  bookmarkRevset,
  HOST_REMOTE,
  hostProposedRef,
  proposedBookmark,
  revsetName,
} from "./lane/names.ts"
import { readCommits } from "./lane/revisions.ts"
import {
  forgetSteps,
  IMPORT,
  laneRefSteps,
  markSteps,
  planDescribe,
  planGetLatestUndo,
  planPublishGetLatest,
  planPublishMove,
  planRefreshProposed,
} from "./plan.ts"
import {
  hostCommitIn,
  laneTipIn,
  readHostVersion,
  readProposedChanges,
} from "./proposed.ts"
import { LANE, laneRigs, NAME, useLaneRepos } from "./repo-rigs.ts"
import { executeRepo } from "./run.ts"
import { git, host } from "./step.ts"

describe("a lane's repo, with jj", () => {
  const repos = useLaneRepos()
  const { proposedRig, turnRig } = laneRigs(repos)

  describe("the host's version of proposed changes", () => {
    const BOOKMARK = proposedBookmark(NAME)
    /** The proposed changes as `readProposedChanges` finds it on accepted work, whole. */
    const proposedNow = async (rig: Awaited<ReturnType<typeof turnRig>>) => {
      const read = await readProposedChanges(rig.ops, {
        name: NAME,
        target: await rig.acceptedNow(),
      })
      if (read?.kind !== "present") throw new Error("no proposed changes")
      return read
    }
    /** The commit tracked as the host's version, or none. */
    const tracked = (rig: Awaited<ReturnType<typeof turnRig>>) =>
      readCommits(
        rig.ops,
        `tracked_remote_bookmarks(exact:${revsetName(BOOKMARK)}, remote=exact:${revsetName(HOST_REMOTE)})`,
      )
    /** Your repo's op log cut to its head, everything it held collected. */
    const cutHistory = async (rig: Awaited<ReturnType<typeof turnRig>>) => {
      await rig.repoJj(["op", "abandon", "..@-"])
      await rig.repoJj(["util", "gc", "--expire=now"])
    }
    const HOST = { reached: true, othersChanged: false }

    test("proposed changes the host builds are its version, tracked, and reads as the host's with no evolog", async () => {
      const rig = await turnRig("host-built")
      await rig.proposed(rig.base)
      const read = await proposedNow(rig)
      expect(read.marked).toBe(true)
      expect(await tracked(rig)).toEqual([read.revisions[0]?.commit])
      expect(read.revisions.map(r => r.since)).toEqual([HOST])
      await rig.agrees()
    }, 60_000)

    test("you change the proposed changes' file: it is no longer the host's version, and reads as your edit", async () => {
      const rig = await turnRig("host-yours")
      await rig.proposed(rig.base)
      await rig.repoJj(["new", BOOKMARK])
      await rig.edit(rig.repoDir, "a.txt", "yours\n")
      const squashed = await rig.repoJj([
        "squash",
        "--ignore-immutable",
        "--into",
        BOOKMARK,
      ])
      if (!squashed.ok) throw new Error(squashed.stderr)
      const read = await proposedNow(rig)
      expect(read.marked).toBe(false)
      expect(read.revisions.map(r => r.since)).toEqual([
        { reached: true, othersChanged: true },
      ])
      await rig.agrees()
    }, 60_000)

    test("a host step that stopped before its mark is not your edit, even once the op log is cut", async () => {
      const rig = await turnRig("host-unmarked")
      await rig.proposed(rig.base)
      const [bottom] = (await proposedNow(rig)).revisions
      if (bottom === undefined) throw new Error("no proposed changes")
      await rig.edit(rig.repoDir, "line.txt", "line\n")
      await rig.repoJj(["commit", "-m", "accepted work moves"])
      await rig.repoJj(["bookmark", "move", "pinetrie-accepted", "--to", "@-"])
      // The host's rebase, without the mark that follows it.
      await executeRepo(
        rig.repoDir,
        planRefreshProposed(bottom.changeId, await rig.acceptedNow()),
      )
      const moved = await proposedNow(rig)
      expect([moved.marked, moved.revisions.map(r => r.since)]).toEqual([
        false,
        [HOST],
      ])
      await rig.agrees()
      // One more operation, then the log cut to it: the evolog no longer
      // reaches the host's rebase, and the host's version says it.
      await rig.repoJj(["new", "pinetrie-accepted"])
      await cutHistory(rig)
      const evolog = await rig.ops([
        "evolog",
        "--no-graph",
        "-r",
        BOOKMARK,
        "-T",
        'if(operation, operation.user(), "-") ++ "\\n"',
      ])
      expect(evolog.stdout.split("\n")[0]).toBe("-")
      expect((await proposedNow(rig)).revisions.map(r => r.since)).toEqual([
        HOST,
      ])
      await executeRepo(rig.repoDir, markSteps(BOOKMARK))
      expect((await proposedNow(rig)).marked).toBe(true)
    }, 60_000)

    test("proposed changes built before proposed changes had a host version read as the host's by its evolog, and one mark makes it the version", async () => {
      const rig = await turnRig("host-legacy")
      await rig.proposed(rig.base)
      // As an older host left it: the bookmark alone, with no host version.
      await executeRepo(rig.repoDir, [
        host("bookmark", "untrack", BOOKMARK, "--remote", HOST_REMOTE),
        git("update-ref", "-d", hostProposedRef(BOOKMARK)),
        IMPORT,
      ])
      expect(await readHostVersion(rig.ops, BOOKMARK)).toBeNull()
      const read = await proposedNow(rig)
      expect([read.marked, read.revisions.map(r => r.since)]).toEqual([
        false,
        [HOST],
      ])
      await executeRepo(rig.repoDir, markSteps(BOOKMARK))
      expect((await proposedNow(rig)).marked).toBe(true)
      expect(await tracked(rig)).toHaveLength(1)
      await rig.agrees()
    }, 60_000)

    test("your edit races a host step that marked: its version names the host's commit, after the op log is cut too", async () => {
      const rig = await turnRig("host-race")
      await rig.proposed(rig.base)
      const [bottom] = (await proposedNow(rig)).revisions
      if (bottom === undefined) throw new Error("no proposed changes")
      const op = (
        await rig.ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"])
      ).stdout.trim()
      await executeRepo(rig.repoDir, [
        ...planDescribe(bottom.changeId, "the host's\n"),
        ...markSteps(BOOKMARK),
      ])
      const marked = await readHostVersion(rig.ops, BOOKMARK)
      await rig.repoJj([
        "--at-operation",
        op,
        "describe",
        "--ignore-immutable",
        "-r",
        bottom.changeId,
        "-m",
        "yours\n",
      ])
      await rig.repoJj(["new", "pinetrie-accepted"])
      await cutHistory(rig)
      const split = await hostCommitIn(
        rig.ops,
        bottom.changeId,
        await readHostVersion(rig.ops, BOOKMARK),
      )
      expect(split?.host).toBe(marked)
      await rig.agrees()
    }, 60_000)

    test("you delete the proposed changes' bookmark and build on its commit: the host's forget leaves your commits where they are", async () => {
      const rig = await turnRig("host-forget")
      await rig.proposed(rig.base)
      const proposed = (await readCommits(rig.ops, BOOKMARK))[0]
      await rig.repoJj(["bookmark", "delete", BOOKMARK])
      await rig.repoJj(["new", "--ignore-immutable", proposed ?? ""])
      await rig.edit(rig.repoDir, "mine.txt", "mine\n")
      await rig.repoJj(["commit", "-m", "mine, on the old proposed changes"])
      const mine = await readCommits(rig.ops, "@-")
      const below = await readCommits(rig.ops, "::@-")
      await executeRepo(rig.repoDir, forgetSteps(BOOKMARK))
      expect(await readHostVersion(rig.ops, BOOKMARK)).toBeNull()
      expect(await readCommits(rig.ops, "@-")).toEqual(mine)
      expect(await readCommits(rig.ops, "::@-")).toEqual(below)
      await rig.agrees()
    }, 60_000)

    test("an acceptance forgets the proposed changes' bookmark and the host's version, and accepted work holds the commit", async () => {
      const rig = await turnRig("host-accept")
      const proposed = await rig.proposed(rig.base)
      const [top] = proposed.built.commits
      await rig.accept(proposed)
      expect(await readHostVersion(rig.ops, BOOKMARK)).toBeNull()
      expect(
        await readCommits(rig.ops, `present(${bookmarkRevset(BOOKMARK)})`),
      ).toEqual([])
      expect(await rig.acceptedNow()).toBe(top)
      await rig.agrees()
    }, 60_000)

    test("an archived lane's history is parked: after the op log is cut and collected, its restore still finds it", async () => {
      const rig = await turnRig("host-park")
      await rig.fetch(rig.base)
      const tip = await laneTipIn(rig.ops, LANE)
      if (tip === null) throw new Error("no tip")
      await executeRepo(
        rig.repoDir,
        laneRefSteps([
          { lane: LANE, commit: null },
          { lane: threadIdFor("9"), commit: null },
        ]),
      )
      expect(await laneTipIn(rig.ops, LANE)).toBeNull()
      await cutHistory(rig)
      await executeRepo(
        rig.repoDir,
        laneRefSteps([{ lane: LANE, commit: tip }]),
      )
      expect(await laneTipIn(rig.ops, LANE)).toBe(tip)
      const parked = await run("git", ["for-each-ref", "refs/pinetrie/"], {
        cwd: rig.repoDir,
      })
      expect(parked.stdout).toBe("")
    }, 60_000)
  })

  test("a lane's ref deleted and imported: the history under accepted work is kept", async () => {
    const { agrees, repoDir, repoJj, ops, edit, proposed, accept, base } =
      await turnRig("refgone")
    await accept(await proposed(base))
    await edit(repoDir, "mine.txt", "mine\n")
    await repoJj(["commit", "-m", "mine on accepted work"])
    await repoJj(["bookmark", "move", "pinetrie-accepted", "--to", "@-"])
    const before = await readCommits(ops, "::@-")
    await executeRepo(repoDir, laneRefSteps([{ lane: LANE, commit: null }]))
    expect(await readCommits(ops, "::@-")).toEqual(before)
    expect(await readCommits(ops, "conflicts()")).toEqual([])
    await agrees()
  }, 60_000)

  test("a publish's catch-up: a preview that writes nothing, then your work rebased onto accepted work, conflicts recorded", async () => {
    const { repoDir, repoJj, ops, edit, line, setUpAccepted } =
      await proposedRig("catchup")
    const git: Runner = args => hostRunner(repoDir)(["git", ...args])
    const changeId = async (rev: string) =>
      (
        await repoJj(["log", "--no-graph", "-r", rev, "-T", "change_id"])
      ).stdout.trim()
    await edit(repoDir, "f.txt", "a\nb\nc\n")
    await edit(repoDir, "g.txt", "base\n")
    await repoJj(["commit", "-m", "L0"])
    await setUpAccepted()
    // Your work: Y1 changes g.txt, with a second head on it besides @.
    await edit(repoDir, "g.txt", "yours\n")
    await repoJj(["describe", "-m", "Y1"])
    const y1 = await changeId("@")
    await repoJj(["new", y1, "-m", "sibling"])
    await edit(repoDir, "s.txt", "s\n")
    await repoJj(["new", y1])
    // A file in @, so leaving it does not abandon it as empty.
    await edit(repoDir, "h.txt", "h\n")
    const at = await changeId("@")
    // Accepted work moves on: L1 changes f.txt and g.txt.
    await repoJj(["new", line.acceptedBookmark, "-m", "L1"])
    await edit(repoDir, "f.txt", "a\nB\nc\n")
    await edit(repoDir, "g.txt", "line\n")
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@"])
    await repoJj(["edit", at])
    // Not yet snapshotted: the rebase, run as you, snapshots it first.
    await edit(repoDir, "i.txt", "i\n")
    const before = (await repoJj(["op", "log", "-n", "1", "-T", "id"])).stdout
    const facts = await acceptedFacts(ops, git, line)
    expect(facts.workingCopy.behind).toBe(1)
    expect(facts.workingCopy.getLatest).toEqual({
      changes: 2,
      conflicts: ["g.txt"],
      heads: 1,
    })
    expect(facts.workingCopy.conflicts).toEqual({ commits: 0, files: [] })
    // The preview wrote no operation.
    expect(
      (
        await repoJj([
          "--ignore-working-copy",
          "op",
          "log",
          "-n",
          "1",
          "-T",
          "id",
        ])
      ).stdout,
    ).toBe(before)
    await executeRepo(
      repoDir,
      planPublishGetLatest({ acceptedBookmark: line.acceptedBookmark }),
    )
    const after = await acceptedFacts(ops, git, line)
    expect(after.workingCopy.behind).toBe(0)
    expect(after.workingCopy.getLatest).toBe(null)
    // Y1 and @ conflict; the sibling moved too, and conflicts outside @'s line.
    expect(after.workingCopy.conflicts).toEqual({
      commits: 2,
      files: ["g.txt"],
    })
    expect(await readFile(path.join(repoDir, "h.txt"), "utf8")).toBe("h\n")
    expect(await readFile(path.join(repoDir, "i.txt"), "utf8")).toBe("i\n")
    expect(await readFile(path.join(repoDir, "f.txt"), "utf8")).toBe(
      "a\nB\nc\n",
    )
    expect(
      await readCommits(
        ops,
        `description(exact:"sibling\\n") & ${revsetName(line.acceptedBookmark)}::`,
      ),
    ).toHaveLength(1)
  }, 60_000)

  test("publish's move: main moved forward to accepted work as the host, git's main with it; refused once main has its own commits", async () => {
    const { repoDir, repoJj, ops, edit, line, setUpAccepted } =
      await proposedRig("publish")
    const git: Runner = args => hostRunner(repoDir)(["git", ...args])
    const gitMain = async () =>
      (await git(["rev-parse", "refs/heads/main"])).stdout.trim()
    await edit(repoDir, "a.txt", "a\n")
    await repoJj(["commit", "-m", "M0"])
    await repoJj(["bookmark", "create", "main", "-r", "@-"])
    await setUpAccepted()
    // No unpublished work yet: accepted work is main.
    expect((await acceptedFacts(ops, git, line)).published).toMatchObject({
      behind: 0,
      ahead: 0,
    })
    await edit(repoDir, "b.txt", "b\n")
    await repoJj(["commit", "-m", "L1"])
    await edit(repoDir, "c.txt", "c\n")
    await repoJj(["commit", "-m", "L2"])
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const before = await acceptedFacts(ops, git, line)
    expect(before.published).toMatchObject({ behind: 2, ahead: 0 })
    await executeRepo(
      repoDir,
      planPublishMove({
        acceptedBookmark: line.acceptedBookmark,
        publish: line.publish,
        accept: false,
      }),
    )
    const after = await acceptedFacts(ops, git, line)
    expect(after.published).toEqual({
      commit: before.commit,
      behind: 0,
      ahead: 0,
    })
    // The host's move, with --ignore-working-copy, still reaches git.
    expect(await gitMain()).toBe(before.commit)
    // main moved sideways, outside pinetrie: its own commit, which accepted work lacks.
    await repoJj(["new", "main", "-m", "hotfix"])
    await edit(repoDir, "h.txt", "h\n")
    await repoJj(["bookmark", "move", "main", "--to", "@"])
    await repoJj(["new", line.acceptedBookmark])
    await edit(repoDir, "d.txt", "d\n")
    await repoJj(["commit", "-m", "L3"])
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const sideways = await acceptedFacts(ops, git, line)
    expect(sideways.published).toMatchObject({ behind: 1, ahead: 1 })
    const moved = (await acceptedFacts(ops, git, line)).published.commit
    await expect(
      executeRepo(
        repoDir,
        planPublishMove({
          acceptedBookmark: line.acceptedBookmark,
          publish: line.publish,
          accept: false,
        }),
      ),
    ).rejects.toThrow()
    expect((await acceptedFacts(ops, git, line)).published.commit).toBe(moved)
  }, 60_000)

  test("publish from an empty @ on main: main at accepted work, and @ empty on it", async () => {
    const { repoDir, repoJj, ops, edit, line, setUpAccepted } =
      await proposedRig("publish-empty")
    const git: Runner = args => hostRunner(repoDir)(["git", ...args])
    await edit(repoDir, "a.txt", "a\n")
    await repoJj(["commit", "-m", "M0"])
    await repoJj(["bookmark", "create", "main", "-r", "@-"])
    await setUpAccepted()
    // An accept: accepted work moves on past main, and your empty @ stays on main.
    await repoJj(["new", line.acceptedBookmark, "-m", "accepted"])
    await edit(repoDir, "b.txt", "b\n")
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@"])
    await repoJj(["new", "main"])
    const before = await acceptedFacts(ops, git, line)
    expect(before.workingCopy).toMatchObject({ behind: 1, ahead: 0 })
    await executeRepo(
      repoDir,
      planPublishGetLatest({ acceptedBookmark: line.acceptedBookmark }),
    )
    await executeRepo(
      repoDir,
      planPublishMove({
        acceptedBookmark: line.acceptedBookmark,
        publish: line.publish,
        accept: false,
      }),
    )
    const after = await acceptedFacts(ops, git, line)
    expect(after.published).toMatchObject({ behind: 0, ahead: 0 })
    expect(after.workingCopy).toMatchObject({ behind: 0, ahead: 0 })
    expect(await readCommits(ops, "main")).toEqual(
      await readCommits(ops, revsetName(line.acceptedBookmark)),
    )
    expect(await readCommits(ops, "@-")).toEqual(await readCommits(ops, "main"))
    expect(await readCommits(ops, "@ & empty()")).toHaveLength(1)
    expect(await readFile(path.join(repoDir, "b.txt"), "utf8")).toBe("b\n")
  }, 60_000)

  test("publish with your commits: rebased onto accepted work, counted, then accepted work and main moved to them in one operation", async () => {
    const { repoDir, repoJj, ops, edit, line, setUpAccepted } =
      await proposedRig("publish-mine")
    const git: Runner = args => hostRunner(repoDir)(["git", ...args])
    await edit(repoDir, "a.txt", "a\n")
    await repoJj(["commit", "-m", "M0"])
    await repoJj(["bookmark", "create", "main", "-r", "@-"])
    await setUpAccepted()
    await repoJj(["new", line.acceptedBookmark, "-m", "accepted"])
    await edit(repoDir, "b.txt", "b\n")
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@"])
    await repoJj(["new", "main"])
    await edit(repoDir, "m.txt", "mine\n")
    await repoJj(["commit", "-m", "mine"])
    expect((await acceptedFacts(ops, git, line)).workingCopy).toMatchObject({
      behind: 1,
      ahead: 1,
    })
    await executeRepo(
      repoDir,
      planPublishGetLatest({ acceptedBookmark: line.acceptedBookmark }),
    )
    expect((await acceptedFacts(ops, git, line)).workingCopy).toMatchObject({
      behind: 0,
      ahead: 1,
    })
    const ops0 = await repoJj(["op", "log", "--no-graph", "-T", 'id ++ "\\n"'])
    await executeRepo(
      repoDir,
      planPublishMove({
        acceptedBookmark: line.acceptedBookmark,
        publish: line.publish,
        accept: true,
      }),
    )
    const ops1 = await repoJj(["op", "log", "--no-graph", "-T", 'id ++ "\\n"'])
    // One operation moved both bookmarks.
    expect(
      ops1.stdout.split("\n").length - ops0.stdout.split("\n").length,
    ).toBe(1)
    const mine = await readCommits(ops, 'description(exact:"mine\\n")')
    expect(await readCommits(ops, revsetName(line.acceptedBookmark))).toEqual(
      mine,
    )
    expect(await readCommits(ops, "main")).toEqual(mine)
  }, 60_000)

  test("a publish's second round reads your commits conflicted by the catch-up, and its revert keeps your edit", async () => {
    const { repoDir, repoJj, ops, edit, line, setUpAccepted } =
      await proposedRig("publish-undo")
    const git: Runner = args => hostRunner(repoDir)(["git", ...args])
    await edit(repoDir, "g.txt", "base\n")
    await repoJj(["commit", "-m", "M0"])
    await repoJj(["bookmark", "create", "main", "-r", "@-"])
    await setUpAccepted()
    // Y1 changes g.txt; Y2 puts it back, so @'s tree merges cleanly.
    await edit(repoDir, "g.txt", "yours\n")
    await repoJj(["commit", "-m", "Y1"])
    await edit(repoDir, "g.txt", "base\n")
    await repoJj(["commit", "-m", "Y2"])
    // A file in @, so leaving it does not abandon it as empty.
    await edit(repoDir, "h.txt", "h\n")
    const at = (
      await repoJj(["log", "--no-graph", "-r", "@", "-T", "change_id"])
    ).stdout.trim()
    await repoJj(["new", line.acceptedBookmark, "-m", "accepted"])
    await edit(repoDir, "g.txt", "line\n")
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@"])
    await repoJj(["edit", at])
    // Not yet snapshotted: the catch-up snapshots it first, as you.
    await edit(repoDir, "e.txt", "edited\n")
    const before = await acceptedFacts(ops, git, line)
    expect(before.workingCopy.getLatest?.conflicts).toEqual([])
    expect(before.workingCopy.conflicts.commits).toBe(0)
    const commitsBefore = await readCommits(ops, "::@- ~ ::main")
    await executeRepo(
      repoDir,
      planPublishGetLatest({ acceptedBookmark: line.acceptedBookmark }),
    )
    const op = (
      await repoJj([
        "--ignore-working-copy",
        "op",
        "log",
        "-n",
        "1",
        "--no-graph",
        "-T",
        "id",
      ])
    ).stdout.trim()
    expect(
      (await acceptedFacts(ops, git, line)).workingCopy.conflicts.commits,
    ).toBeGreaterThan(0)
    await executeRepo(repoDir, planGetLatestUndo(op))
    const undone = await acceptedFacts(ops, git, line)
    expect(undone.workingCopy.behind).toBe(1)
    expect(undone.workingCopy.conflicts.commits).toBe(0)
    expect(await readCommits(ops, "::@- ~ ::main")).toEqual(commitsBefore)
    expect(await readCommits(ops, "@ & divergent()")).toEqual([])
    expect(await readFile(path.join(repoDir, "e.txt"), "utf8")).toBe("edited\n")
    expect(await readFile(path.join(repoDir, "g.txt"), "utf8")).toBe("base\n")
  }, 60_000)

  /** `jj` and `git` on `repoDir`, each command counted by its program. */
  const countedRunners = (ops: Runner, repoDir: string) => {
    const ran = { jj: 0, git: 0 }
    const jj: Runner = args => {
      ran.jj++
      return ops(args)
    }
    const git: Runner = args => {
      ran.git++
      return hostRunner(repoDir)(["git", ...args])
    }
    return { ran, jj, git }
  }

  test("accepted work's facts are two jj reads, whatever the WIPs", async () => {
    const { repoDir, repoJj, ops, edit, line, setUpAccepted } =
      await proposedRig("facts")
    await edit(repoDir, "a.txt", "a\n")
    await repoJj(["commit", "-m", "M0"])
    await repoJj(["bookmark", "create", "main", "-r", "@-"])
    await setUpAccepted()
    const wip = async (name: string, titles: readonly string[]) => {
      await repoJj(["new", line.acceptedBookmark])
      for (const title of titles) {
        await edit(repoDir, `${title}.txt`, `${title}\n`)
        await repoJj(["commit", "-m", title])
      }
      await repoJj(["bookmark", "create", name, "-r", "@-"])
      const [commit] = await readCommits(ops, "@-")
      return commit
    }
    const one = await wip("wip/one", ["w1"])
    const two = await wip("wip/two", ["w2a", "w2b"])
    await repoJj(["new", line.acceptedBookmark])
    await edit(repoDir, "l.txt", "l\n")
    await repoJj(["commit", "-m", "L1"])
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const counted = countedRunners(ops, repoDir)
    const facts = await acceptedFacts(counted.jj, counted.git, line)
    expect(counted.ran).toEqual({ jj: 2, git: 0 })
    expect(
      [...facts.unfinishedWork].sort((a, b) =>
        a.bookmark.localeCompare(b.bookmark),
      ),
    ).toEqual([
      { bookmark: "wip/one", commit: one, behind: 1, ahead: 1 },
      { bookmark: "wip/two", commit: two, behind: 1, ahead: 2 },
    ])
    expect(facts.published).toMatchObject({ behind: 1, ahead: 0 })
    expect(facts.workingCopy).toEqual({
      behind: 0,
      ahead: 0,
      getLatest: null,
      conflicts: { commits: 0, files: [] },
    })
    expect(facts.heads).toContain(line.acceptedBookmark)
    expect(facts.log).not.toBeNull()
  }, 60_000)

  test("a working copy sharing only the root with accepted work has no preview, and runs no git", async () => {
    const { repoDir, repoJj, ops, edit, line, setUpAccepted } =
      await proposedRig("rootonly")
    await edit(repoDir, "a.txt", "a\n")
    await repoJj(["commit", "-m", "M0"])
    await setUpAccepted()
    await repoJj(["new", "root()"])
    const counted = countedRunners(ops, repoDir)
    const facts = await acceptedFacts(counted.jj, counted.git, line)
    expect(facts.workingCopy.behind).toBe(1)
    expect(facts.workingCopy.getLatest).toBeNull()
    expect(counted.ran.git).toBe(0)
  }, 60_000)
})
