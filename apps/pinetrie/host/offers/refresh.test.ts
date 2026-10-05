// A refresh against real jj, as the host runs it: the owner, the gather,
// `planRefresh` and its steps. Each history here is one your repo has held
// (S97), and each must settle: refreshed until a round writes nothing, by
// the second round.

import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  baseMessage,
  type CommitId,
  commitId,
  HOST_OPERATOR,
  type LaneName,
  laneNameForThread,
  NO_EDITOR,
  type ThreadName,
} from "@pinetrie/core"
import {
  DEFAULT_LINE,
  laneTipRef,
  lines,
  offerBookmark,
  run,
} from "@pinetrie/lanes"
import type { Agent } from "@pinetrie/pi"
import { readBases, readOffers } from "@pinetrie/reads"
import { startRepoOwner } from "@pinetrie/repo"
import { NAME, setRecord } from "@pinetrie/rules"
import { afterAll, expect, test } from "vitest"
import { applyWrites, basics, putValue, record } from "../fakes.ts"
import { createRefresh } from "./refresh.ts"
import { createOfferDeps } from "./state.ts"

const LANE = laneNameForThread("1")
const THREAD = "vernal-pine" as ThreadName
const ENV = { ...NO_EDITOR, JJ_USER: "Probe", JJ_EMAIL: "probe@example.com" }

const dirs: string[] = []
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

/** A repo of yours, with the line at a first commit, and how to write to it. */
async function yourRepo(tag: string) {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), `pinetrie-refresh-${tag}-`)),
  )
  dirs.push(dir)
  const jj = (...args: string[]) =>
    run("jj", ["-R", dir, ...args], { env: ENV })
  await run("jj", ["git", "init", "--colocate", dir], { env: ENV })
  const write = (file: string, text: string) =>
    writeFile(path.join(dir, file), text)
  /** `@-`'s commit. */
  const parent = async (): Promise<CommitId> =>
    commitId(
      (await jj("log", "--no-graph", "-r", "@-", "-T", "commit_id")).stdout,
    )
  /** Commit `@` with `message` on `parents`, writing `files` first. */
  const commit = async (
    parents: readonly string[],
    files: Record<string, string>,
    message: string,
  ): Promise<CommitId> => {
    await jj("new", ...parents)
    for (const [file, text] of Object.entries(files)) await write(file, text)
    await jj("commit", "-m", message)
    return parent()
  }
  const moveLine = (to: CommitId) =>
    jj("bookmark", "set", DEFAULT_LINE.onto, "-r", to, "--allow-backwards")
  /** The lane's tip in your repo, as a fetch leaves it. */
  const setTip = async (lane: LaneName, tip: CommitId) => {
    await run("git", ["update-ref", laneTipRef(lane), tip], { cwd: dir })
    await jj("git", "import")
  }
  await write("base.txt", "base\n")
  await jj("commit", "-m", "base")
  const base = await parent()
  await moveLine(base)
  return { dir, jj, commit, moveLine, setTip, base }
}

/**
 * Refresh `lane`'s offer as the host does, until a round writes nothing to
 * your repo: it must by the second. Then the offer's files, or null for none.
 */
async function settles(dir: string, lane: LaneName, name: ThreadName) {
  const b = basics()
  putValue(b, setRecord(NAME, { lane, name, at: 1 }))
  const agent = record<Agent>({
    writeValues: async writes => applyWrites(b, writes),
  })
  const owner = startRepoOwner({ root: dir, line: DEFAULT_LINE })
  try {
    const deps = createOfferDeps({
      owner,
      line: DEFAULT_LINE,
      basics: b,
      agent: () => agent.port,
      running: () => false,
      baseChanged: () => {},
    })
    const refresh = createRefresh(deps)
    const op = () =>
      owner.command(
        async ops =>
          (await ops.jj(["op", "log", "--no-graph", "-n", "1", "-T", "id"]))
            .stdout,
      )
    let rounds = 0
    for (;;) {
      const before = await op()
      await owner.command(ops => refresh.refresh(ops, lane))
      rounds += 1
      if ((await op()) === before) break
      if (rounds > 2) throw new Error(`still writing after ${rounds} rounds`)
    }
    const files = await owner.command(async ops => {
      const ran = await ops.jj([
        "diff",
        "-r",
        `present(${offerBookmark(name)})`,
        "--name-only",
      ])
      const bookmarked = await ops.jj([
        "log",
        "--no-graph",
        "-r",
        `present(${offerBookmark(name)})`,
        "-T",
        "commit_id",
      ])
      return bookmarked.stdout === "" ? null : lines(ran.stdout)
    })
    return {
      files,
      record: readOffers(b.session).get(lane) ?? null,
      base: readBases(b.session).get(lane) ?? null,
    }
  } finally {
    owner.close()
  }
}

test("a catch-up that merged your integration of the lane's work leaves nothing to offer: an empty offer built before is withdrawn (S97)", async () => {
  const you = await yourRepo("caught-up")
  const work = await you.commit(
    [you.base],
    { "lane.txt": "the lane's\n" },
    `turn\n\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e1\n`,
  )
  const integrated = await you.commit(
    [you.base],
    { "lane.txt": "the lane's\n" },
    `feat: the lane's\n\nPinetrie-Thread: ${THREAD}\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e1\nPinetrie-Source: ${work}\nPinetrie-Start: ${you.base}\n`,
  )
  await you.moveLine(integrated)
  // The lane catches up: a merge of its work and your integrated-offer
  // commit. Its range from that commit has a gap, which jj refuses to diff.
  const merged = await you.commit(
    [work, integrated],
    {},
    baseMessage("update: pinetrie-onto", {
      bookmark: DEFAULT_LINE.onto,
      commit: integrated,
    }),
  )
  await you.setTip(LANE, merged)
  // The empty offer a host before S97 built from it, as the host's own.
  await run(
    "jj",
    [
      "-R",
      you.dir,
      "--config",
      `operation.username=${HOST_OPERATOR}`,
      "new",
      integrated,
      "-m",
      `WIP (${THREAD}): x\n\nPinetrie-Thread: ${THREAD}\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e2\nPinetrie-Source: ${merged}\nPinetrie-Start: ${integrated}\n`,
    ],
    { env: ENV },
  )
  await run(
    "jj",
    [
      "-R",
      you.dir,
      "--config",
      `operation.username=${HOST_OPERATOR}`,
      "bookmark",
      "create",
      offerBookmark(THREAD),
      "-r",
      "@",
    ],
    { env: ENV },
  )
  await you.jj("new", you.base)
  expect(await settles(you.dir, LANE, THREAD)).toEqual({
    files: null,
    record: null,
    base: expect.objectContaining({ catchUp: null, untraced: [] }),
  })
}, 60_000)

test("an integrated-offer commit of the lane with no Pinetrie-Source builds nothing until the lane catches up past it; then only what is new (S97)", async () => {
  const you = await yourRepo("untraced")
  const work = await you.commit(
    [you.base],
    { "a.txt": "the lane's\n" },
    `turn\n\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e1\n`,
  )
  // Integrated before offers carried their ledger: no source, no start.
  const integrated = await you.commit(
    [you.base],
    { "a.txt": "the lane's\n" },
    `feat: the lane's\n\nPinetrie-Thread: ${THREAD}\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e1\n`,
  )
  const yours = await you.commit([integrated], { "a.txt": "yours\n" }, "yours")
  await you.moveLine(yours)
  const more = await you.commit(
    [work],
    { "b.txt": "more\n" },
    `turn\n\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e2\n`,
  )
  await you.setTip(LANE, more)
  // From its old base, the offer would replay a.txt onto yours. Catching up
  // is the way on, and brings your a.txt.
  expect(await settles(you.dir, LANE, THREAD)).toEqual({
    files: null,
    record: null,
    base: expect.objectContaining({
      untraced: [integrated],
      catchUp: { tip: more, to: yours, files: ["a.txt"] },
    }),
  })
  const merged = await you.commit(
    [more, yours],
    { "a.txt": "yours\n" },
    baseMessage("update: pinetrie-onto", {
      bookmark: DEFAULT_LINE.onto,
      commit: yours,
    }),
  )
  await you.setTip(LANE, merged)
  expect(await settles(you.dir, LANE, THREAD)).toMatchObject({
    files: ["b.txt"],
    record: { files: ["b.txt"], integratedAs: null },
    base: { untraced: [], catchUp: null },
  })
}, 60_000)

test("work you landed yourself leaves the offer held: kept, with no files, and settled (S89)", async () => {
  const you = await yourRepo("held")
  const work = await you.commit(
    [you.base],
    { "a.txt": "a\n" },
    `turn\n\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e1\n`,
  )
  await you.setTip(LANE, work)
  expect(await settles(you.dir, LANE, THREAD)).toMatchObject({
    files: ["a.txt"],
  })
  const yours = await you.commit(
    [you.base],
    { "a.txt": "a\n" },
    "you: the same a.txt",
  )
  await you.moveLine(yours)
  // The line moved by work the lane has: catching up would change nothing.
  expect(await settles(you.dir, LANE, THREAD)).toMatchObject({
    files: [],
    record: { files: [], integratedAs: null },
    base: { catchUp: { tip: work, to: yours, files: [] } },
  })
}, 60_000)
