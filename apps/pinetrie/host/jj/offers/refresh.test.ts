// A refresh against real jj, as the host runs it: the owner, the gather,
// `planRefresh` and its steps. Each history here is one your repo has held, and
// each must settle: refreshed until a round writes nothing, by the second
// round.

import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  baseMessage,
  type CommitId,
  commitId,
  HOST_OPERATOR,
  NO_EDITOR,
  type ThreadId,
  type ThreadName,
  threadIdFor,
} from "@pinetrie/core"
import {
  DEFAULT_REPO,
  laneTipRef,
  offerBookmark,
  startRepoOwner,
} from "@pinetrie/jj"
import { lines, run } from "@pinetrie/lanes"
import type { PiSetup } from "@pinetrie/pi"
import { readBases, readOffers } from "@pinetrie/reads"
import { NAME, setRecord } from "@pinetrie/rules"
import { afterAll, expect, test } from "vitest"
import { applyWrites, basics, putValue, record } from "../../fakes.ts"
import type { Records } from "../../records.ts"
import { createRefresh } from "./refresh.ts"
import { createOfferDeps } from "./state.ts"

const LANE = threadIdFor("1")
const THREAD = "vernal-pine" as ThreadName
const ENV = { ...NO_EDITOR, JJ_USER: "Probe", JJ_EMAIL: "probe@example.com" }

const dirs: string[] = []
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

/** A repo of yours, with accepted work at a first commit, and how to write to it. */
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
  const moveAccepted = (to: CommitId) =>
    jj(
      "bookmark",
      "set",
      DEFAULT_REPO.acceptedBookmark,
      "-r",
      to,
      "--allow-backwards",
    )
  /** The lane's tip in your repo, as a fetch leaves it. */
  const setTip = async (lane: ThreadId, tip: CommitId) => {
    await run("git", ["update-ref", laneTipRef(lane), tip], { cwd: dir })
    await jj("git", "import")
  }
  await write("base.txt", "base\n")
  await jj("commit", "-m", "base")
  const base = await parent()
  await moveAccepted(base)
  return { dir, jj, commit, moveAccepted, setTip, base }
}

/**
 * Refresh `lane`'s offer as the host does, until a round writes nothing to
 * your repo: it must by the second. Then the offer's files, or null for none.
 */
async function settles(dir: string, lane: ThreadId, name: ThreadName) {
  const b = basics()
  putValue(b, setRecord(NAME, { lane, name, at: 1 }))
  const scribe = record<Records>({
    writeValues: async writes => applyWrites(b, writes),
  })
  const owner = startRepoOwner({ root: dir, repoConfig: DEFAULT_REPO })
  try {
    const deps = createOfferDeps({
      owner,
      repoConfig: DEFAULT_REPO,
      basics: b,
      records: scribe.port,
      piSetup: record<PiSetup>({}).port,
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

test("a catch-up that merged your acceptance of the lane's work leaves nothing to offer", async () => {
  const you = await yourRepo("caught-up")
  const work = await you.commit(
    [you.base],
    { "lane.txt": "the lane's\n" },
    `turn\n\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e1\n`,
  )
  const accepted = await you.commit(
    [you.base],
    { "lane.txt": "the lane's\n" },
    `feat: the lane's\n\nPinetrie-Thread: ${THREAD}\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e1\nPinetrie-Source: ${work}\nPinetrie-Start: ${you.base}\n`,
  )
  await you.moveAccepted(accepted)
  // The lane catches up: a merge of its work and your accepted-offer
  // commit. Its range from that commit has a gap, which jj refuses to diff.
  const merged = await you.commit(
    [work, accepted],
    {},
    baseMessage("catch up: accepted work", {
      kind: "accepted",
      commit: accepted,
    }),
  )
  await you.setTip(LANE, merged)
  // The empty offer an older host built from it, when it read jj's refusal as
  // work, as the host's own.
  await run(
    "jj",
    [
      "-R",
      you.dir,
      "--config",
      `operation.username=${HOST_OPERATOR}`,
      "new",
      accepted,
      "-m",
      `WIP (${THREAD}): x\n\nPinetrie-Thread: ${THREAD}\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e2\nPinetrie-Source: ${merged}\nPinetrie-Start: ${accepted}\n`,
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

test("an accepted-offer commit with no Pinetrie-Source builds nothing until the lane catches up past it", async () => {
  const you = await yourRepo("untraced")
  const work = await you.commit(
    [you.base],
    { "a.txt": "the lane's\n" },
    `turn\n\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e1\n`,
  )
  // Accepted before offers carried their ledger: no source, no start.
  const accepted = await you.commit(
    [you.base],
    { "a.txt": "the lane's\n" },
    `feat: the lane's\n\nPinetrie-Thread: ${THREAD}\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e1\n`,
  )
  const yours = await you.commit([accepted], { "a.txt": "yours\n" }, "yours")
  await you.moveAccepted(yours)
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
      untraced: [accepted],
      catchUp: { tip: more, to: yours, files: ["a.txt"] },
    }),
  })
  const merged = await you.commit(
    [more, yours],
    { "a.txt": "yours\n" },
    baseMessage("catch up: accepted work", {
      kind: "accepted",
      commit: yours,
    }),
  )
  await you.setTip(LANE, merged)
  expect(await settles(you.dir, LANE, THREAD)).toMatchObject({
    files: ["b.txt"],
    record: { files: ["b.txt"], acceptedAs: null },
    base: { untraced: [], catchUp: null },
  })
}, 60_000)

test("work you landed yourself leaves the offer held: kept, with no files, and settled", async () => {
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
  await you.moveAccepted(yours)
  // Accepted work moved by work the lane has: catching up would change nothing.
  expect(await settles(you.dir, LANE, THREAD)).toMatchObject({
    files: [],
    record: { files: [], acceptedAs: null },
    base: { catchUp: { tip: work, to: yours, files: [] } },
  })
}, 60_000)

/** The commits `revset` names in your repo at `dir`. */
const commitsAt = async (dir: string, revset: string) =>
  lines(
    (
      await run(
        "jj",
        [
          "-R",
          dir,
          "log",
          "--no-graph",
          "-r",
          revset,
          "-T",
          'commit_id ++ "\\n"',
        ],
        { env: ENV },
      )
    ).stdout,
  )
/** The host's version of `name`'s offer, tracked, as a revset. */
const tracked = (name: ThreadName) =>
  `tracked_remote_bookmarks(exact:"${offerBookmark(name)}", remote=exact:"pinetrie-host")`

test("an offer the host builds is its version, tracked, and the round after writes nothing", async () => {
  const you = await yourRepo("marked")
  const work = await you.commit(
    [you.base],
    { "a.txt": "a\n" },
    `turn\n\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e1\n`,
  )
  await you.setTip(LANE, work)
  expect(await settles(you.dir, LANE, THREAD)).toMatchObject({
    files: ["a.txt"],
  })
  const offered = await commitsAt(you.dir, `present(${offerBookmark(THREAD)})`)
  expect(await commitsAt(you.dir, tracked(THREAD))).toEqual(offered)
}, 60_000)

test("an offer the host built before offers had a version of the host's is marked by its refresh", async () => {
  const you = await yourRepo("legacy")
  const work = await you.commit(
    [you.base],
    { "a.txt": "a\n" },
    `turn\n\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e1\n`,
  )
  await you.setTip(LANE, work)
  expect(await settles(you.dir, LANE, THREAD)).toMatchObject({
    files: ["a.txt"],
  })
  // As an older host left it: the bookmark, with no version of the host's.
  await you.jj(
    "bookmark",
    "untrack",
    offerBookmark(THREAD),
    "--remote",
    "pinetrie-host",
  )
  await run(
    "git",
    ["update-ref", "-d", `refs/remotes/pinetrie-host/${offerBookmark(THREAD)}`],
    { cwd: you.dir },
  )
  await you.jj("git", "import")
  expect(await commitsAt(you.dir, tracked(THREAD))).toEqual([])
  expect(await settles(you.dir, LANE, THREAD)).toMatchObject({
    files: ["a.txt"],
  })
  expect(await commitsAt(you.dir, tracked(THREAD))).toEqual(
    await commitsAt(you.dir, `present(${offerBookmark(THREAD)})`),
  )
}, 60_000)

test("you deleted the offer's bookmark and the lane has nothing to offer: the host's version is forgotten", async () => {
  const you = await yourRepo("left")
  const work = await you.commit(
    [you.base],
    { "a.txt": "a\n" },
    `turn\n\nPinetrie-Lane: ${LANE}\nPinetrie-Entry: e1\n`,
  )
  await you.setTip(LANE, work)
  await settles(you.dir, LANE, THREAD)
  await you.jj("bookmark", "delete", offerBookmark(THREAD))
  await you.setTip(LANE, you.base)
  expect(await settles(you.dir, LANE, THREAD)).toMatchObject({
    files: null,
    record: null,
  })
  expect(
    await commitsAt(
      you.dir,
      `remote_bookmarks(exact:"${offerBookmark(THREAD)}", remote=exact:"pinetrie-host")`,
    ),
  ).toEqual([])
}, 60_000)
