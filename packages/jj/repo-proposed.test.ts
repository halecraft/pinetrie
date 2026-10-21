import { cp, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  baseMessage,
  type CommitId,
  commitId,
  entryId,
  type GetLatestRead,
  hasTrailer,
  NO_EDITOR,
  pointFromCommit,
  type ThreadName,
  trailerRevset,
} from "@pinetrie/core"
import {
  hostBytesRunner,
  hostRunner,
  lines,
  type Runner,
  run,
} from "@pinetrie/lanes"
import { describe, expect, test } from "vitest"
import { fetchLane, jjLaneFor } from "./fixtures.ts"
import { getLatestFiles } from "./get-latest.ts"
import { laneBase } from "./lane/base.ts"
import { readLaneBookmark } from "./lane/bookmarks.ts"
import { mergeBase, mergeUpdate } from "./lane/merge.ts"
import { proposedBookmark } from "./lane/names.ts"
import { fetchById, planForkSetup, planMerge } from "./lane/plan.ts"
import {
  ACCEPTED_THREAD_COMMIT_ROW,
  commitTurn,
  parseAcceptedThreadCommits,
  readCommits,
  readConflictedFiles,
} from "./lane/revisions.ts"
import { gatherLane } from "./lane-read.ts"
import {
  planAbandonProposed,
  planDescribe,
  planProposedChanges,
  planRebuildProposed,
  planRefreshProposed,
} from "./plan.ts"
import {
  fileDiff,
  filesTouched,
  hostCommitIn,
  laneTipIn,
  readChangeId,
  readHostVersion,
  readProposedChanges,
  revisionRead,
  startOfProposed,
} from "./proposed.ts"
import { gatherPlace } from "./proposed-gather.ts"
import { repairProposedChanges } from "./proposed-repair.ts"
import {
  FORK,
  knownStart,
  LANE,
  laneJjRunner,
  laneRigs,
  NAME,
  sshAuthority,
  TURN,
  turnOn,
  useLaneRepos,
} from "./repo-rigs.ts"
import { jjFileBytes } from "./review-content.ts"
import { bytesFor, executeRepo } from "./run.ts"
import { readShared } from "./shared.ts"

describe("a lane's repo, with jj", () => {
  const repos = useLaneRepos()
  const { turnRig } = laneRigs(repos)

  test("a review reads proposed changes' commit: its description, files and one file's diff", async () => {
    const { laneDir, repoDir, repoJj, ops, laneJj, fetch, edit, build, base } =
      await turnRig("review")
    const reads = { jj: ops, jjBytes: bytesFor(repoDir, "host") }
    // An image: its row is media, with its size, read from its bytes.
    const PNG = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1,
    ])
    await writeFile(path.join(laneDir, "a.png"), PNG)
    // Names the template and the fileset must quote, a file under a
    // directory, and a rename.
    await run("mkdir", ["-p", path.join(laneDir, "dir")])
    await edit(laneDir, "a b.txt", "space\n")
    await edit(laneDir, 'we"ird', "quote\n")
    await edit(laneDir, "dir/f.txt", "under\n")
    await edit(laneDir, "a.txt", "a\nmore\n")
    // A grant the base's copy does not make: a widening, once accepted.
    await edit(
      laneDir,
      "pinetrie.json",
      JSON.stringify({ lanes: { ssh: { personal: true } } }),
    )
    await run("mv", [
      path.join(laneDir, "base.txt"),
      path.join(laneDir, "moved.txt"),
    ])
    await turnOn(laneJj, { ...TURN, entry: entryId("e-2") })
    await fetch(base)
    const tip = await laneTipIn(ops, LANE)
    if (tip === null) throw new Error("no tip")
    const proposed = await build([
      { commit: tip, description: "feat: lane\n\nwhy\n" },
    ])
    const [w] = proposed.commits
    const [changeId] = proposed.changeIds
    if (w === undefined || changeId === undefined)
      throw new Error("no proposed changes")

    const span = { kind: "revision", commit: w } as const
    const read = await revisionRead(reads, span, sshAuthority)
    expect(read).toEqual({
      description: "feat: lane\n\nwhy\n",
      files: expect.arrayContaining([
        {
          path: "a b.txt",
          shown: "a b.txt",
          change: "added",
          added: 1,
          removed: 0,
          content: { kind: "lines" },
        },
        {
          path: 'we"ird',
          shown: 'we"ird',
          change: "added",
          added: 1,
          removed: 0,
          content: { kind: "lines" },
        },
        {
          path: "dir/f.txt",
          shown: "dir/f.txt",
          change: "added",
          added: 1,
          removed: 0,
          content: { kind: "lines" },
        },
        {
          path: "a.txt",
          shown: "a.txt",
          change: "added",
          added: 2,
          removed: 0,
          content: { kind: "lines" },
        },
        {
          path: "moved.txt",
          shown: "{base.txt => moved.txt}",
          change: "renamed",
          added: 0,
          removed: 0,
          content: { kind: "lines" },
        },
        {
          path: "a.png",
          shown: "a.png",
          change: "added",
          added: 0,
          removed: 0,
          content: {
            kind: "media",
            before: null,
            after: { content: "image/png", size: 10 },
          },
        },
      ]),
      widenings: [{ kind: "ssh" }],
    })
    expect(await fileDiff(ops, span, 'we"ird')).toContain("+quote")
    expect(await fileDiff(ops, span, "a b.txt")).toContain("+space")
    // An image's bytes, typed by them; none where the side holds no file.
    const png = await jjFileBytes(reads.jjBytes, w, "a.png")
    const served: Uint8Array[] = []
    for await (const c of png?.bytes ?? []) served.push(c)
    expect([png?.content, Buffer.concat(served)]).toEqual(["image/png", PNG])
    expect(await jjFileBytes(reads.jjBytes, `${w}-`, "a.png")).toBeNull()
    // One file exactly: a directory's name names none of its files.
    expect(await fileDiff(ops, span, "dir")).toBe("")
    expect(await fileDiff(ops, span, "dir/f.txt")).toContain("+under")

    // A range reads the same files, with no description, its counts from
    // the range's git diff: here the range is the revision.
    const [parent] = await readCommits(ops, `${w}-`)
    if (parent === undefined) throw new Error("no parent")
    const range = { kind: "range", from: parent, to: w } as const
    const byPath = (r: unknown) =>
      [...((r as { files: { path: string }[] } | null)?.files ?? [])].sort(
        (a, b) => a.path.localeCompare(b.path),
      )
    const ranged = await revisionRead(reads, range, sshAuthority)
    expect(ranged).toMatchObject({
      description: "",
      widenings: [{ kind: "ssh" }],
    })
    expect(byPath(ranged)).toEqual(byPath(read))
    expect(await fileDiff(ops, range, 'we"ird')).toContain("+quote")

    // You reword the proposed changes: its commit changes, and the review of
    // the new one reads your words. `readProposedChanges` finds it by its
    // bookmark.
    await repoJj([
      "describe",
      "--ignore-immutable",
      "-r",
      changeId,
      "-m",
      "feat: as I want it",
    ])
    const facts = await readProposedChanges(ops, {
      name: NAME,
      target: "pinetrie-accepted",
    })
    const [now] = facts?.kind === "present" ? facts.revisions : []
    if (now === undefined) throw new Error("no commit")
    expect(now.commit).not.toBe(w)
    expect(
      await revisionRead(
        reads,
        { kind: "revision", commit: now.commit },
        sshAuthority,
      ),
    ).toMatchObject({
      description: "feat: as I want it\n",
    })
    expect(
      await revisionRead(
        reads,
        { kind: "revision", commit: commitId("1".repeat(40)) },
        sshAuthority,
      ),
    ).toBeNull()
  }, 60_000)

  test("proposed changes on accepted work: built, immutable, refreshed, followed, accepted by a forward move, and the next one", async () => {
    const {
      repoDir,
      laneDir,
      repoJj,
      ops,
      laneJj,
      line,
      fetch,
      edit,
      build,
      acceptedNow,
      accept,
      proposed,
      base,
      agrees,
    } = await turnRig("proposed")
    const bookmark = proposedBookmark(NAME)
    await fetch(base)
    const t1 = await laneTipIn(ops, LANE)
    if (t1 === null) throw new Error("no tip")
    // You work on above accepted work: your stack is yours, and mutable.
    await edit(repoDir, "c.txt", "c yours\n")
    await repoJj(["commit", "-m", "yours: c.txt"])
    await edit(repoDir, "wip.txt", "wip\n")

    // Built by the host on accepted work: immutable, so you cannot edit it by
    // accident; the host's own rewrites pass `--ignore-immutable`.
    const one = await build([
      {
        commit: t1,
        description: `proposed changes: lane\n\nPinetrie-Source: ${t1}\nPinetrie-Start: ${base[0]}\n`,
      },
    ])
    const [c1] = one.changeIds
    const [w1] = one.commits
    if (c1 === undefined || w1 === undefined)
      throw new Error("no proposed changes")
    expect(one.read).toMatchObject({
      files: ["a.txt"],
      onTarget: true,
      placed: true,
      // Its ledger, read from its message: no record needed.
      ledger: { source: t1, start: base },
    })
    expect((await repoJj(["describe", "-r", c1, "-m", "mine"])).ok).toBe(false)
    // Yet your log shows it: setup added the proposed changes to `revsets.log`,
    // since jj's default leaves an immutable head out.
    expect(
      (
        await repoJj([
          "log",
          "--no-graph",
          "-T",
          'description.first_line() ++ "\\n"',
        ])
      ).stdout,
    ).toContain("proposed changes: lane")
    expect(
      (await readCommits(repoJj, `${c1} & immutable()`)).length,
    ).toBeGreaterThan(0)
    expect(
      (
        await readCommits(
          repoJj,
          `description(exact:"yours: c.txt\n") & mutable()`,
        )
      ).length,
    ).toBe(1)
    await executeRepo(repoDir, planDescribe(c1, "proposed changes: described"))

    // The host rewrote it, and nothing recorded that: its newest version is
    // the host's, so it is not yours.
    const sinceNow = async () => {
      const read = await readProposedChanges(ops, {
        name: NAME,
        target: await acceptedNow(),
      })
      return read?.kind === "present" ? read.revisions.map(r => r.since) : null
    }
    expect(await sinceNow()).toEqual([{ reached: true, othersChanged: false }])
    // Your reword of the proposed changes, on purpose: a change of yours, an
    // edit.
    await repoJj([
      "describe",
      "--ignore-immutable",
      "-r",
      c1,
      "-m",
      "as I want",
    ])
    expect(await sinceNow()).toEqual([{ reached: true, othersChanged: true }])
    await executeRepo(
      repoDir,
      planDescribe(c1, `proposed changes: lane\n\nPinetrie-Source: ${t1}\n`),
    )

    // A race: your edit and a host rewrite from the same operation make it
    // divergent. The host keeps yours.
    const opNow = async () =>
      (
        await repoJj([
          "op",
          "log",
          "--ignore-working-copy",
          "--no-graph",
          "-n",
          "1",
          "-T",
          "id",
        ])
      ).stdout.trim()
    const op = await opNow()
    await repoJj(["describe", "--ignore-immutable", "-r", c1, "-m", "yours"])
    await ops([
      "--at-operation",
      op,
      "--ignore-immutable",
      "describe",
      "-r",
      c1,
      "-m",
      `proposed changes: lane\n\nPinetrie-Source: ${t1}\n\nhost`,
    ])
    // Divergent: the batched read says so too.
    await agrees()
    const split = await hostCommitIn(
      ops,
      c1,
      await readHostVersion(ops, bookmark),
    )
    if (split === null) throw new Error("no split")
    await repairProposedChanges(
      { jj: ops, execute: steps => executeRepo(repoDir, steps) },
      { bookmark, changeIds: [c1] },
    )
    // Repaired: yours, edited.
    await agrees()
    expect(await readCommits(repoJj, "divergent()")).toEqual([])
    expect(await readCommits(repoJj, `bookmarks(exact:"${bookmark}")`)).toEqual(
      [split.other],
    )
    await repoJj([
      "describe",
      "--ignore-immutable",
      "-r",
      c1,
      "-m",
      // As the host writes it: so the next proposed changes' revisions are told
      // from this one, accepted, by its base, not its trailer.
      `proposed changes: lane\n\nPinetrie-Thread: ${NAME}\nPinetrie-Source: ${t1}\n`,
    ])

    // Accept: accepted work moved forward to the proposed changes, as the host;
    // your @ and the working copy untouched; the proposed changes' bookmark
    // gone.
    const atBefore = await readCommits(repoJj, "@")
    await accept({ built: one })
    expect(await readCommits(repoJj, "@")).toEqual(atBefore)
    expect(await readFile(path.join(repoDir, "wip.txt"), "utf8")).toBe("wip\n")
    expect(await readChangeId(ops, await acceptedNow())).toBe(c1)
    expect(
      await readCommits(ops, `present(bookmarks(exact:"${bookmark}"))`),
    ).toEqual([])
    // jj itself refuses an acceptance that is not forward.
    expect(
      (
        await ops([
          "bookmark",
          "move",
          line.acceptedBookmark,
          "--to",
          base[0] ?? "",
        ])
      ).ok,
    ).toBe(false)

    // You land work of your own on accepted work, changing what you accepted.
    await repoJj(["new", line.acceptedBookmark])
    await edit(repoDir, "a.txt", "a, then yours\n")
    await repoJj(["commit", "-m", "yours: a.txt"])
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])

    // The next turn: its proposed changes start at what the accepted thread
    // commit's Pinetrie-Source names, and holds only what came after; it does
    // not bring a.txt back.
    await edit(laneDir, "b.txt", "b\n")
    const t2 = await turnOn(laneJj, { ...TURN, entry: entryId("e-2") })
    if (t2 === null) throw new Error("no turn")
    const next = await proposed([t1])
    expect(next.files).toEqual(["b.txt"])
    expect(next.conflicted).toBe(false)
    // You reword your commit under it: jj rebases the proposed changes, as your
    // operation, but changes nothing in it, so it is not yours.
    await repoJj([
      "describe",
      "--ignore-immutable",
      "-r",
      line.acceptedBookmark,
      "-m",
      "yours: a.txt, reworded",
    ])
    expect(await sinceNow()).toEqual([{ reached: true, othersChanged: false }])

    // The lane moves on: the proposed changes are rebuilt from it in place, its
    // change kept, holding what a fresh build would.
    await edit(laneDir, "f.txt", "f\n")
    const t3 = await turnOn(laneJj, { ...TURN, entry: entryId("e-3") })
    if (t3 === null) throw new Error("no turn")
    await fetch([t2])
    const [nc] = next.built.changeIds
    if (nc === undefined) throw new Error("no proposed changes")
    const b3 = await laneBase(ops, t3, line)
    if (b3 === null) throw new Error("no base")
    await executeRepo(
      repoDir,
      planRebuildProposed({
        changeId: nc,
        start: await knownStart(ops, { tip: t3, base: b3, repoConfig: line }),
        tip: t3,
        target: await acceptedNow(),
        description: `WIP\n\nPinetrie-Source: ${t3}\n`,
      }),
    )
    const [followed] = await readCommits(ops, `change_id(${nc})`)
    expect(
      lines((await ops(["diff", "-r", followed ?? "", "--name-only"])).stdout),
    ).toEqual(["b.txt", "f.txt"])
    expect(await readCommits(ops, `${followed} & conflicts()`)).toEqual([])
    await agrees()

    // A stack: one revision per lane revision, each with its own file.
    await executeRepo(repoDir, planAbandonProposed(next.built.changeIds))
    await laneJj(["new", t2])
    await edit(laneDir, "d.txt", "d\n")
    await laneJj(["commit", "-m", "s1: d.txt"])
    await edit(laneDir, "e.txt", "e\n")
    await laneJj(["commit", "-m", "s2: e.txt"])
    const [s1] = await readCommits(laneJj, "@--")
    const [s2] = await readCommits(laneJj, "@-")
    if (s1 === undefined || s2 === undefined) throw new Error("no stack")
    await laneJj([
      "bookmark",
      "set",
      "--allow-backwards",
      `pinetrie/${LANE}`,
      "-r",
      s2,
    ])
    await fetch([t2])
    // Each revision names its thread, as the host writes it: found by that,
    // above the accepted proposed changes and your commit under it, which are
    // on accepted work.
    const ours = `Pinetrie-Thread: ${NAME}\nPinetrie-Source: ${t2}`
    const stack = await build([
      { commit: s1, description: `s1: d.txt\n\n${ours}\n` },
      { commit: s2, description: `s2: e.txt\n\n${ours}\n` },
    ])
    expect(stack.read).toMatchObject({ chained: true })
    await agrees()
    const per = await Promise.all(
      stack.commits.map(async c =>
        lines((await ops(["diff", "-r", c, "--name-only"])).stdout),
      ),
    )
    expect(per).toEqual([["b.txt", "d.txt"], ["e.txt"]])
  }, 60_000)

  test("a squash of two accepted proposed changes keep both sources: the next proposed changes start above them", async () => {
    const {
      agrees,
      laneDir,
      repoJj,
      ops,
      edit,
      proposed,
      accept,
      turn,
      acceptedNow,
      base,
    } = await turnRig("squashed")
    const first = await proposed(base)
    await accept(first)
    const t1 = await laneTipIn(ops, LANE)
    if (t1 === null) throw new Error("no tip")
    await edit(laneDir, "b.txt", "b\n")
    const t2 = await turn()
    const second = await proposed([t1])
    await accept(second)
    // You squash the two accepted proposed changes, as jj's editor offers both
    // messages.
    const line = await acceptedNow()
    const ran = await run(
      "jj",
      [
        "-R",
        (await repoJj(["root"])).stdout.trim(),
        "squash",
        "--ignore-immutable",
        "--from",
        line,
        "--into",
        `${line}-`,
      ],
      { env: { ...NO_EDITOR, JJ_EDITOR: "true" } },
    )
    expect(ran.ok, ran.stderr).toBe(true)
    await edit(laneDir, "c.txt", "c\n")
    await turn()
    expect((await proposed([t2])).files).toEqual(["c.txt"])
    expect(await readCommits(ops, "divergent()")).toEqual([])
    await agrees()
  }, 60_000)

  test("proposed changes after a catch-up start at accepted work it merged, not at what you accepted below it", async () => {
    const {
      agrees,
      laneDir,
      repoDir,
      repoJj,
      ops,
      line,
      edit,
      proposed,
      accept,
      turn,
      update,
      acceptedNow,
      base,
    } = await turnRig("caught-up")
    await accept(await proposed(base))
    const t1 = await laneTipIn(ops, LANE)
    if (t1 === null) throw new Error("no tip")
    // You change accepted work you accepted into, then the lane catches up
    // with it: the accepted thread commit is joined to the lane's commit, so
    // the merge is clean, and the lane has your text.
    await repoJj(["new", line.acceptedBookmark])
    await edit(repoDir, "a.txt", "a, then yours\n")
    await repoJj(["commit", "-m", "yours: a.txt"])
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    expect(await update()).toEqual([])
    expect(await readFile(path.join(laneDir, "a.txt"), "utf8")).toBe(
      "a, then yours\n",
    )
    await edit(laneDir, "c.txt", "c\n")
    await turn()
    // The accepted source is below accepted work the lane merged: the proposed
    // changes start there alone, and holds only what came after.
    const after = await proposed([t1])
    expect([after.conflicted, after.files]).toEqual([false, ["c.txt"]])
    const tip = await laneTipIn(ops, LANE)
    if (tip === null) throw new Error("no tip")
    const b = await laneBase(ops, tip, line)
    if (b === null) throw new Error("no base")
    expect(await knownStart(ops, { tip, base: b, repoConfig: line })).toEqual([
      await acceptedNow(),
    ])
    await agrees()
  }, 60_000)

  test("a branch cloned from a conflicted catch-up: its proposed changes' conflict came with its copy, and catching up with its parent settles it", async () => {
    const rig = await turnRig("parent")
    const {
      laneDir,
      repoDir,
      repoJj,
      ops,
      line,
      edit,
      proposed,
      accept,
      turn,
    } = rig
    const BRANCH = "copper-owl" as ThreadName
    // The parent changes base.txt; you change the same line on accepted work;
    // the parent catches up, and the merge stays conflicted.
    await edit(laneDir, "base.txt", "base, lane\n")
    await turn()
    await repoJj(["new", line.acceptedBookmark])
    await edit(repoDir, "base.txt", "base, yours\n")
    await repoJj(["commit", "-m", "yours: base.txt"])
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const l2 = await rig.acceptedNow()
    await rig.inLane([fetchById([l2])])
    const { merge } = await mergeBase(
      rig.laneJj,
      LANE,
      l2,
      baseMessage("catch up: accepted work", {
        kind: "accepted",
        commit: l2,
      }),
    )
    if (merge === null) throw new Error("nothing merged")
    expect(await readConflictedFiles(rig.laneJj, merge)).toEqual(["base.txt"])
    // A prompt on it commits nothing, and its record names the merge: the
    // turn says it is conflicted, as a branch from it would start.
    expect(
      await commitTurn(rig.laneJj, {
        title: "a prompt",
        entry: entryId("e-parent-prompt"),
        lane: LANE,
        bookmark: merge,
      }),
    ).toEqual({ point: null, conflicted: true })
    // The branch is cloned there, conflicted.
    const forkDir = path.join(repos.top, "parent-fork")
    await cp(laneDir, forkDir, { recursive: true, verbatimSymlinks: true })
    await rig.inLane(
      planForkSetup(jjLaneFor(FORK), {
        kind: "recorded",
        points: [merge].map(pointFromCommit),
      }),
      forkDir,
    )
    const forkJj = laneJjRunner(forkDir)
    const forkRunners = {
      lane: hostRunner(forkDir),
      laneBytes: hostBytesRunner(forkDir),
    }
    const fetchFork = (have: readonly CommitId[]) =>
      fetchLane(forkRunners, repoDir, {
        lane: FORK,
        have,
        bundle: path.join(repos.top, "parent-fork.bundle"),
      })
    // Both resolve it the same way; the parent's is accepted.
    const resolved = "base, yours, lane\n"
    await edit(laneDir, "base.txt", resolved)
    const parentResolved = await turn()
    await accept(await proposed(rig.base))
    await edit(forkDir, "base.txt", resolved)
    const resolving = await commitTurn(forkJj, {
      title: "resolve",
      entry: entryId("e-fork-1"),
      lane: FORK,
      bookmark: await readLaneBookmark(forkJj, FORK),
    })
    expect(resolving.conflicted).toBe(false)
    await fetchFork(rig.base)
    // The branch's proposed changes start at the conflicted merge, and
    // conflicts in the file it started conflicted in.
    const branchProposed = async () => {
      const tip = await laneTipIn(ops, FORK)
      if (tip === null) throw new Error("no tip")
      const b = await laneBase(ops, tip, line)
      if (b === null) throw new Error("no base")
      const read = await startOfProposed(ops, {
        tip,
        base: b,
        repoConfig: line,
        lane: FORK,
      })
      if (read.kind !== "known") throw new Error("an untraced start")
      return { tip, base: b, start: read.start }
    }
    const before = await branchProposed()
    expect(before.start).toEqual([merge])
    await executeRepo(
      repoDir,
      planProposedChanges({
        name: BRANCH,
        start: before.start,
        sources: [
          {
            commit: before.tip,
            description: `WIP\n\nPinetrie-Thread: ${BRANCH}\nPinetrie-Source: ${before.tip}\nPinetrie-Start: ${merge}\n`,
          },
        ],
        target: await rig.acceptedNow(),
        nonce: "n-parent",
      }),
    )
    const read = await readProposedChanges(ops, {
      name: BRANCH,
      target: await rig.acceptedNow(),
    })
    expect(read).toMatchObject({
      kind: "present",
      conflicts: ["base.txt"],
      startConflicts: ["base.txt"],
    })
    const op = (await ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"]))
      .stdout
    const gathered = await gatherLane(ops, {
      lane: FORK,
      name: BRANCH,
      repoConfig: line,
      shared: await readShared(op, ops, line),
      known: null,
    })
    expect(gathered).toMatchObject({
      proposed: { conflicts: ["base.txt"], startConflicts: ["base.txt"] },
    })
    // The parent catches up with accepted work after the fork, past its own
    // accepted thread commit;
    // then the branch catches up with the parent's newest commit, fetched
    // from your repo, where only the parent's ref reaches it.
    const acceptedCommit = await rig.acceptedNow()
    await rig.inLane([fetchById([acceptedCommit])])
    const upToDate = await mergeBase(
      rig.laneJj,
      LANE,
      acceptedCommit,
      baseMessage("catch up: accepted work", {
        kind: "accepted",
        commit: acceptedCommit,
      }),
    )
    expect(upToDate.merge).not.toBeNull()
    await rig.fetch([parentResolved])
    const newest = await laneTipIn(ops, LANE)
    if (newest === null) throw new Error("no parent tip")
    const plan = planMerge(jjLaneFor(LANE), {
      kind: "parent",
      lane: LANE,
      name: NAME,
      point: pointFromCommit(newest),
      upToDateWith: pointFromCommit(merge),
    })
    // The plan's fetch names your repo by its path in a lane: run it here.
    await rig.inLane(plan.steps, forkDir)
    const merged = await mergeUpdate(forkJj, forkRunners, FORK, {
      ...plan,
      steps: [],
    })
    expect(merged.kind).toBe("clean")
    await fetchFork([merge])
    // Its base is now the parent's newer one, and its work changes no file:
    // its proposed changes are withdrawn.
    const after = await branchProposed()
    expect(after.base.start).toBe(acceptedCommit)
    expect(
      await filesTouched(ops, {
        start: { kind: "known", start: after.start },
        tip: after.tip,
      }),
    ).toBe("none")
    await rig.agrees()
  }, 60_000)

  test("unchanged proposed changes' refresh reads at most 2 jj processes, none of them its evolog, and what catching up changes is read once per move", async () => {
    const rig = await turnRig("count")
    const { ops, line, fetch, build, acceptedNow, base } = rig
    await fetch(base)
    const tip = await laneTipIn(ops, LANE)
    if (tip === null) throw new Error("no tip")
    const b = await laneBase(ops, tip, line)
    if (b === null) throw new Error("no base")
    const start = await knownStart(ops, { tip, base: b, repoConfig: line })
    // As the host builds one: its ledger names the tip and the start.
    await build([
      {
        commit: tip,
        description: `WIP\n\nPinetrie-Thread: ${NAME}\nPinetrie-Source: ${tip}\n${start.map(c => `Pinetrie-Start: ${c}`).join("\n")}\n`,
      },
    ])
    const op = (await ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"]))
      .stdout
    const shared = await readShared(op, ops, line)
    let ran = 0
    const evologs: string[] = []
    const counted: Runner = args => {
      ran += 1
      if (args.includes("evolog")) evologs.push(args.join(" "))
      return ops(args)
    }
    const gathered = await gatherLane(counted, {
      lane: LANE,
      name: NAME,
      repoConfig: line,
      shared,
      known: null,
    })
    expect(gathered).toMatchObject({
      tip,
      target: await acceptedNow(),
      work: "some",
    })
    // One `jj log`, and whether the lane's work changes any file: the
    // proposed changes' top is the host's version, so no evolog is read.
    expect(ran).toBe(2)
    expect(evologs).toEqual([])
    // Accepted work moves: what catching up changes is read once, in two diffs,
    // and kept while the lane's tip and accepted work stay where they are.
    await rig.edit(rig.repoDir, "line.txt", "line\n")
    await rig.repoJj(["commit", "-m", "accepted work moves"])
    await rig.repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const gather = async (known: GetLatestRead | null) => {
      const now = (
        await ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"])
      ).stdout
      const facts = await readShared(now, ops, line)
      ran = 0
      const read = await gatherLane(counted, {
        lane: LANE,
        name: NAME,
        repoConfig: line,
        shared: facts,
        known,
      })
      if (read === "none" || read === "unfinished")
        throw new Error("not on accepted work")
      return { read, ran }
    }
    const moved = await gather(null)
    expect(moved.read.getLatest).toEqual({
      tip,
      to: await acceptedNow(),
      files: ["line.txt"],
    })
    expect(moved.ran).toBe(4)
    expect((await gather(moved.read.getLatest)).ran).toBe(2)
    // Moved again: what was read at accepted work before is read again.
    await rig.edit(rig.repoDir, "line.txt", "line, again\n")
    await rig.repoJj(["commit", "-m", "accepted work moves again"])
    await rig.repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    const again = await gather(moved.read.getLatest)
    expect([again.ran, again.read.getLatest?.to]).toEqual([
      4,
      await acceptedNow(),
    ])
  }, 60_000)

  test("proposed changes accepted work already holds is empty, and the lane's work still changes files: it is kept, not withdrawn and built again", async () => {
    const rig = await turnRig("held")
    const {
      ops,
      repoJj,
      repoDir,
      line,
      fetch,
      build,
      acceptedNow,
      base,
      agrees,
    } = rig
    await fetch(base)
    const tip = await laneTipIn(ops, LANE)
    if (tip === null) throw new Error("no tip")
    const b = await laneBase(ops, tip, line)
    if (b === null) throw new Error("no base")
    const start = await knownStart(ops, { tip, base: b, repoConfig: line })
    const [proposed] = (
      await build([
        {
          commit: tip,
          description: `WIP\n\nPinetrie-Thread: ${NAME}\nPinetrie-Source: ${tip}\n${start.map(c => `Pinetrie-Start: ${c}`).join("\n")}\n`,
        },
      ])
    ).changeIds
    if (proposed === undefined) throw new Error("no proposed changes")
    // You land the lane's change yourself; the proposed changes follow accepted
    // work.
    await rig.edit(repoDir, "a.txt", "a\n")
    await repoJj(["commit", "-m", "you: the same a.txt"])
    await repoJj(["bookmark", "move", line.acceptedBookmark, "--to", "@-"])
    await executeRepo(
      repoDir,
      planRefreshProposed(proposed, await acceptedNow()),
    )
    const op = (await ops(["op", "log", "--no-graph", "-n", "1", "-T", "id"]))
      .stdout
    const shared = await readShared(op, ops, line)
    const gathered = await gatherLane(ops, {
      lane: LANE,
      name: NAME,
      repoConfig: line,
      shared,
      known: null,
    })
    expect(gathered).toMatchObject({ work: "some", proposed: { files: [] } })
    await agrees()
  }, 60_000)

  test("an accepted thread commit of the lane that names no source makes its start untraced, read either way, until it catches up past it", async () => {
    const {
      ops,
      laneDir,
      line,
      edit,
      fetch,
      build,
      accept,
      turn,
      update,
      agrees,
      acceptedNow,
      base,
    } = await turnRig("untraced")
    await fetch(base)
    const t1 = await laneTipIn(ops, LANE)
    if (t1 === null) throw new Error("no tip")
    // Accepted as proposed changes were before they carried their ledger.
    const built = await build([
      {
        commit: t1,
        description: `feat: a\n\nPinetrie-Thread: ${NAME}\nPinetrie-Lane: ${LANE}\n`,
      },
    ])
    await accept({ built })
    await edit(laneDir, "b.txt", "b\n")
    const t2 = await turn()
    await fetch([t1])
    await agrees()
    const b2 = await laneBase(ops, t2, line)
    if (b2 === null) throw new Error("no base")
    expect(
      await startOfProposed(ops, {
        tip: t2,
        base: b2,
        repoConfig: line,
        lane: LANE,
      }),
    ).toEqual({
      kind: "untraced",
      acceptedThreadCommits: [await acceptedNow()],
    })
    const input = { lane: LANE, name: NAME, repoConfig: line, known: null }
    expect(await gatherPlace({ jj: ops }, input)).toEqual({
      kind: "untraced",
      tip: t2,
      base: b2,
      state: "ok",
      target: await acceptedNow(),
    })
    // The revset that finds a thread's commits matches what hasTrailer does.
    const all = parseAcceptedThreadCommits(
      (
        await ops([
          "log",
          "--no-graph",
          "-r",
          "all()",
          "-T",
          ACCEPTED_THREAD_COMMIT_ROW,
        ])
      ).stdout,
    )
    const found = await readCommits(ops, trailerRevset(["thread"], NAME))
    expect(found.length).toBeGreaterThan(0)
    expect(
      all
        .filter(c => hasTrailer(c.description, "thread", NAME))
        .map(c => c.commit)
        .sort(),
    ).toEqual([...found].sort())
    // Caught up: the accepted thread commit is under its base, and the start is
    // accepted work.
    expect(await update()).toEqual([])
    await edit(laneDir, "c.txt", "c\n")
    await turn()
    await fetch([t2])
    await agrees()
    const t3 = await laneTipIn(ops, LANE)
    if (t3 === null) throw new Error("no tip")
    const b3 = await laneBase(ops, t3, line)
    if (b3 === null) throw new Error("no base")
    expect(
      await startOfProposed(ops, {
        tip: t3,
        base: b3,
        repoConfig: line,
        lane: LANE,
      }),
    ).toEqual({ kind: "known", start: [await acceptedNow()] })
    expect(await gatherPlace({ jj: ops }, input)).toMatchObject({
      kind: "placed",
      tip: t3,
      start: [await acceptedNow()],
    })
  }, 60_000)

  test("catching up with your own acceptance of the lane's work changes no file, as getLatestFiles says", async () => {
    const { ops, laneJj, inLane, proposed, accept, acceptedNow, base } =
      await turnRig("own-acceptance")
    await accept(await proposed(base))
    const tip = await laneTipIn(ops, LANE)
    const [start] = base
    if (tip === null || start === undefined) throw new Error("no tip")
    const to = await acceptedNow()
    expect(to).not.toBe(start)
    expect(await getLatestFiles(ops, { holds: [start], to, tip })).toEqual([])
    await inLane([fetchById([to])])
    const { ours, merge } = await mergeBase(laneJj, LANE, to, "update")
    if (merge === null) throw new Error("nothing merged")
    expect(
      lines(
        (await laneJj(["diff", "--from", ours, "--to", merge, "--name-only"]))
          .stdout,
      ),
    ).toEqual([])
  }, 60_000)

  test("a lane whose work undoes itself changes no file, over a range jj diffs as one", async () => {
    const { laneDir, ops, turn, fetch, base } = await turnRig("undone")
    await fetch(base)
    const first = await laneTipIn(ops, LANE)
    const [start] = base
    if (first === null || start === undefined) throw new Error("no tip")
    expect(
      await filesTouched(ops, {
        start: { kind: "known", start: [start] },
        tip: first,
      }),
    ).toBe("some")
    await rm(path.join(laneDir, "a.txt"))
    await turn()
    await fetch(base)
    const undone = await laneTipIn(ops, LANE)
    if (undone === null) throw new Error("no tip")
    expect(
      await filesTouched(ops, {
        start: { kind: "known", start: [start] },
        tip: undone,
      }),
    ).toBe("none")
    expect(
      await filesTouched(ops, {
        start: { kind: "known", start: [first] },
        tip: undone,
      }),
    ).toBe("some")
    // A range jj refuses, here for a commit it does not have, is not a change.
    expect(
      await filesTouched(ops, {
        start: { kind: "known", start: [first, commitId("1".repeat(40))] },
        tip: undone,
      }),
    ).toBe("unknown")
    expect(
      await filesTouched(ops, {
        start: { kind: "untraced", acceptedThreadCommits: [first] },
        tip: undone,
      }),
    ).toBe("unknown")
  }, 60_000)
})
