// The helper's runs, hashes and tool writes, as a local process. A run's
// events come from the machine's observer, which is not here: the drain's
// source gives none.

import { createHash } from "node:crypto"
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context"
import {
  type DiskPath,
  diskPath,
  flushed,
  type LaneRuns,
  type RunSource,
  type SharedAccess,
} from "@pinetrie/core"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { type LaneChannel, laneEnv, openChannel } from "./lane-env.ts"
import { drainLaneRuns } from "./lane-runs.ts"

/** A test's output path, checked. */
const checkedPath = (p: string): DiskPath => {
  const checked = diskPath(p)
  if (checked === null) throw new Error(`${p} leaves the disk`)
  return checked
}

const HELPER = path.join(import.meta.dirname, "lane-helper.ts")

const helper = async () => {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "pinetrie-lane-runs-")),
  )
  await mkdir(path.join(dir, ".plans"))
  const channel = openChannel([
    "env",
    `PINETRIE_WORKSPACE_ROOT=${dir}`,
    `PINETRIE_SHARED=${dir}/.plans`,
    process.execPath,
    HELPER,
  ])
  await channel.ready
  return { dir, channel }
}

const close = async (h: { dir: string; channel: LaneChannel }) => {
  h.channel.close()
  await h.channel.closed
  await rm(h.dir, { recursive: true, force: true })
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")

/** No events: the observer is the machine's. */
const unobserved: RunSource = { flush: async () => flushed([]) }

/** The lane's runs since the last drain, folded as the host folds them. */
const drained = (channel: LaneChannel): Promise<LaneRuns> =>
  drainLaneRuns(channel, unobserved)

/** A shared access's stamp: an open's, or what a release left. */
const stampOf = (a: SharedAccess | undefined) =>
  a === undefined ? undefined : a.kind === "open" ? a.stamp : a.left.stamp

describe("the helper", () => {
  let h: { dir: string; channel: LaneChannel }
  beforeAll(async () => {
    h = await helper()
  })
  afterAll(() => close(h))

  test("the write tools' paths are drained once, relative to the lane", async () => {
    const env = laneEnv(h.dir, () => Promise.resolve(h.channel))
    await env.writeFile(path.join(h.dir, "src/a.ts"), "a", BACKGROUND_CONTEXT)
    await env.writeFile("b.ts", "b", BACKGROUND_CONTEXT)
    expect(await drained(h.channel)).toEqual({
      runs: [],
      toolWrites: ["b.ts", "src/a.ts"],
      toolShared: [],
    })
    expect((await drained(h.channel)).toolWrites).toEqual([])
  })

  test("a write tool's write into a shared directory is stamped before and after, as one write", async () => {
    const env = laneEnv(h.dir, () => Promise.resolve(h.channel))
    await drained(h.channel)
    await env.writeFile(".plans/t.md", "one", BACKGROUND_CONTEXT)
    const [opened, released] = (await drained(h.channel)).toolShared
    expect([
      opened?.kind,
      stampOf(opened),
      released?.kind,
      opened?.pid,
    ]).toEqual(["open", null, "release", released?.pid])
    expect(stampOf(released)).toMatch(/^3:\d+$/)
    expect((released?.at ?? 0) >= (opened?.at ?? 1)).toBe(true)
  })

  test("a read tool's read of a shared file is an open for reading, with its stamp; an append is marked so", async () => {
    const env = laneEnv(h.dir, () => Promise.resolve(h.channel))
    await env.writeFile(".plans/r.md", "one", BACKGROUND_CONTEXT)
    await drained(h.channel)
    await env.readTextFile(".plans/r.md", BACKGROUND_CONTEXT)
    await env.appendFile(".plans/r.md", "two", BACKGROUND_CONTEXT)
    const shared = (await drained(h.channel)).toolShared
    expect(
      shared.map(a => [
        a.kind,
        a.writable,
        a.append,
        stampOf(a)?.split(":")[0],
      ]),
    ).toEqual([
      ["open", false, false, "3"],
      ["open", true, true, "3"],
      ["release", true, true, "6"],
    ])
  })

  test("every write method's path is a tool write; a rename's is its destination", async () => {
    const env = laneEnv(h.dir, () => Promise.resolve(h.channel))
    await drained(h.channel)
    await env.appendFile("log.txt", "a", BACKGROUND_CONTEXT)
    await env.renameFile("log.txt", "moved.txt", BACKGROUND_CONTEXT)
    await env.createDir("made", { recursive: true }, BACKGROUND_CONTEXT)
    expect((await drained(h.channel)).toolWrites).toEqual([
      "log.txt",
      "made",
      "moved.txt",
    ])
  })

  test("hashes: each file's sha256, null where none, a new one after a rewrite", async () => {
    await writeFile(path.join(h.dir, "h.txt"), "one")
    expect(await h.channel.hashes(["h.txt", "nope"])).toEqual({
      "h.txt": sha256("one"),
      nope: null,
    })
    await writeFile(path.join(h.dir, "h.txt"), "two")
    expect(await h.channel.hashes(["h.txt"])).toEqual({
      "h.txt": sha256("two"),
    })
  })
  test("checkRecipes: a recipe holds until an input changes or a lookup is found", async () => {
    await writeFile(path.join(h.dir, "lock"), "one")
    const recipe = {
      run: "r1",
      key: {
        command: "i",
        image: "img",
        inputs: { lock: sha256("one") },
        missing: ["rc"],
        shared: {},
      },
      outputs: [checkedPath("out")],
    }
    expect(await h.channel.checkRecipes([recipe])).toEqual([
      { run: "r1", broken: null },
    ])
    await writeFile(path.join(h.dir, "lock"), "two")
    expect(await h.channel.checkRecipes([recipe])).toEqual([
      { run: "r1", broken: "lock" },
    ])
    await writeFile(path.join(h.dir, "lock"), "one")
    await writeFile(path.join(h.dir, "rc"), "x")
    expect(await h.channel.checkRecipes([recipe])).toEqual([
      { run: "r1", broken: "rc" },
    ])
  })
  test("an exec is a run, launched with its number in its environment", async () => {
    const env = laneEnv(h.dir, () => Promise.resolve(h.channel))
    const ran = await env.exec(
      'printf %s "$PINETRIE_RUN" > run.txt',
      undefined,
      BACKGROUND_CONTEXT,
    )
    expect(ran.ok && ran.value.exitCode).toBe(0)
    const runs = await drained(h.channel)
    const number = await readFile(path.join(h.dir, "run.txt"), "utf8")
    expect(number).toMatch(/^\d+$/)
    expect(runs.runs.map(r => [r.id, r.command])).toEqual([
      [number, 'printf %s "$PINETRIE_RUN" > run.txt'],
    ])
  })
})
