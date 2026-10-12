// The helper's runs, hashes and tool writes, as a local process. The runs
// need the supervisor: on the PATH (the lane runtime's, in a lane), else
// they skip, saying why.

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/pi-agent-core/harness/context"
import {
  type DiskPath,
  diskPath,
  type LaneRuns,
  type RunRecord,
  type SharedAccess,
  stamp,
} from "@pinetrie/core"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { type LaneChannel, laneEnv, openChannel } from "./lane-env.ts"
import { drainLaneRuns, supervisorSource } from "./lane-runs.ts"

/** A test's output path, checked. */
const checkedPath = (p: string): DiskPath => {
  const checked = diskPath(p)
  if (checked === null) throw new Error(`${p} leaves the disk`)
  return checked
}

const HELPER = path.join(import.meta.dirname, "lane-helper.ts")

const supervise = (() => {
  try {
    return execFileSync("sh", ["-c", "command -v supervise"], {
      encoding: "utf8",
    }).trim()
  } catch {
    return null
  }
})()

/**
 * The stand-in supervisor (`fixtures/stand-in-supervise.mjs`), run by a
 * shell script: `superviseCommand` execs its path with the arguments.
 */
const standIn = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-stand-in-"))
  const at = path.join(dir, "supervise")
  const script = path.join(
    import.meta.dirname,
    "fixtures",
    "stand-in-supervise.mjs",
  )
  await writeFile(
    at,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} "$@"\n`,
  )
  await chmod(at, 0o755)
  return at
}

const helper = async (supervised: boolean | string) => {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "pinetrie-lane-runs-")),
  )
  await mkdir(path.join(dir, ".plans"))
  const channel = openChannel([
    "env",
    `PINETRIE_WORKSPACE_ROOT=${dir}`,
    `PINETRIE_SHARED=${dir}/.plans`,
    ...(typeof supervised === "string"
      ? [`PINETRIE_SUPERVISE=${supervised}`]
      : supervised && supervise !== null
        ? [`PINETRIE_SUPERVISE=${supervise}`]
        : []),
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

/** The lane's runs since the last drain, folded as the host folds them. */
const drained = (channel: LaneChannel): Promise<LaneRuns> =>
  drainLaneRuns(channel, supervisorSource(channel))

/** A shared access's stamp: an open's, or what a release left. */
const stampOf = (a: SharedAccess | undefined) =>
  a === undefined ? undefined : a.kind === "open" ? a.stamp : a.left.stamp

describe("the helper, without a supervisor", () => {
  let h: { dir: string; channel: LaneChannel }
  beforeAll(async () => {
    h = await helper(false)
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
})

test("the helper exits when its channel closes, though a daemon still reports to it", async () => {
  const other = await helper(await standIn())
  const ran = await laneEnv(other.dir, () =>
    Promise.resolve(other.channel),
  ).exec("true", undefined, BACKGROUND_CONTEXT)
  expect(ran.ok && ran.value.exitCode).toBe(0)
  other.channel.close()
  const exited = await Promise.race([
    other.channel.closed.then(() => true),
    new Promise(r => setTimeout(() => r(false), 1500)),
  ])
  expect(exited).toBe(true)
  await rm(other.dir, { recursive: true, force: true })
})

describe.skipIf(supervise === null)(
  `the helper's runs${supervise === null ? " (skipped: no supervise on the PATH)" : ""}`,
  () => {
    let h: { dir: string; channel: LaneChannel }
    beforeAll(async () => {
      h = await helper(true)
    })
    afterAll(() => close(h))

    const exec = (command: string, signal?: AbortSignal) =>
      laneEnv(h.dir, () => Promise.resolve(h.channel)).exec(
        command,
        undefined,
        signal === undefined
          ? BACKGROUND_CONTEXT
          : withAbortSignal(signal, BACKGROUND_CONTEXT),
      )

    const only = (drained: LaneRuns): RunRecord => {
      expect(drained.runs).toHaveLength(1)
      return drained.runs[0] as RunRecord
    }

    test("a command's exit, output, reads, writes and failed lookups, drained once", async () => {
      await writeFile(path.join(h.dir, "in.txt"), "x")
      const result = await exec(
        "cat in.txt > out.txt; cat .npmrc 2>/dev/null; echo hi; exit 4",
      )
      expect(result.ok && result.value.exitCode).toBe(4)
      const record = only(await drained(h.channel))
      expect(record).toMatchObject({
        command:
          "cat in.txt > out.txt; cat .npmrc 2>/dev/null; echo hi; exit 4",
        exit: 4,
        alive: false,
        reads: ["in.txt"],
        writes: [{ path: "out.txt", created: true, dir: false }],
        missing: [".npmrc"],
      })
      expect((await drained(h.channel)).runs).toEqual([])
    })

    test("a daemon's write comes at a later drain, with the run then ended", async () => {
      await exec(
        'setsid sh -c "sleep 0.4; echo y > daemon.txt" </dev/null >/dev/null 2>&1 &',
      )
      expect(only(await drained(h.channel))).toMatchObject({
        exit: 0,
        alive: true,
        writes: [],
      })
      await new Promise(r => setTimeout(r, 700))
      expect(only(await drained(h.channel))).toMatchObject({
        alive: false,
        writes: [{ path: "daemon.txt", created: true, dir: false }],
      })
    })

    test("a shared file's write is released with its stamp", async () => {
      await exec("echo plan > .plans/p.md")
      const record = only(await drained(h.channel))
      expect(record.shared.at(-1)).toMatchObject({
        path: ".plans/p.md",
        kind: "release",
        writable: true,
      })
      expect(stampOf(record.shared.at(-1))).toMatch(/^5:\d+$/)
    })

    test("the supervisor's stamp of a shared file is the helper's: a recipe that read it holds", async () => {
      await exec("echo plan > .plans/s.md")
      const released = only(await drained(h.channel)).shared.at(-1)
      const recipe = {
        run: "r",
        key: {
          command: "c",
          image: "i",
          inputs: {},
          missing: [],
          shared: { ".plans/s.md": stampOf(released) ?? stamp("none") },
        },
        outputs: [checkedPath("o")],
      }
      expect(await h.channel.checkRecipes([recipe])).toEqual([
        { run: "r", broken: null },
      ])
    })

    test("an abort ends the command", async () => {
      const control = new AbortController()
      const call = exec("sleep 30", control.signal)
      await new Promise(r => setTimeout(r, 200))
      control.abort()
      const result = await call
      expect(result.ok ? "ran" : result.error.code).toBe("aborted")
      expect(only(await drained(h.channel))).toMatchObject({
        exit: 137,
        alive: false,
      })
    })
  },
)
