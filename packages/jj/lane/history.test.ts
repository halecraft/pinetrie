// The port suite against jj's adapter: lanes as throwaway repos on the host,
// with your repo beside them, and the host's runner standing in for a lane's
// channel. A lane's `/workspace` and `/mnt/host-working-copy` are directories
// here.

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
import {
  type CommitId,
  HOST_WORKING_COPY,
  NO_EDITOR,
  threadIdFor,
  WORKSPACE_ROOT,
} from "@pinetrie/core"
import {
  executeOrThrow,
  hostBytesRunner,
  LANE_JJ_CONFIG,
  type LaneRunners,
  type LaneStep,
  laneIgnores,
  run,
} from "@pinetrie/lanes"
import { type HistoryRig, historySuite } from "@pinetrie/lanes/testing"
import { afterAll, beforeAll, expect, test } from "vitest"
import { fileAt } from "../file-at.ts"
import { planImport } from "../plan.ts"
import { executeRepo, hostJj } from "../run.ts"
import { historyOf } from "./history.ts"
import { bookmarkName, DEFAULT_REPO } from "./names.ts"
import { planBaseCheckout, planBundle, planForkSetup } from "./plan.ts"
import { commitsOf } from "./revisions.ts"

let top = ""
beforeAll(async () => {
  top = await realpath(await mkdtemp(path.join(tmpdir(), "pinetrie-suite-")))
  process.env.JJ_USER = "Probe"
  process.env.JJ_EMAIL = "probe@example.com"
  const ignore = path.join(top, "lane-git", "ignore")
  await mkdir(path.dirname(ignore), { recursive: true })
  await writeFile(ignore, laneIgnores([]))
  process.env.GIT_CONFIG_COUNT = "1"
  process.env.GIT_CONFIG_KEY_0 = "core.excludesFile"
  process.env.GIT_CONFIG_VALUE_0 = ignore
})
afterAll(async () => {
  for (const name of [
    "GIT_CONFIG_COUNT",
    "GIT_CONFIG_KEY_0",
    "GIT_CONFIG_VALUE_0",
  ])
    delete process.env[name]
  await rm(top, { recursive: true, force: true })
})

/** A lane's argument list on the host: its mounts are directories here. */
const onHost = (
  argv: readonly string[],
  dirs: Readonly<Record<string, string>>,
): string[] =>
  argv.map(a =>
    Object.entries(dirs).reduce(
      (t, [from, to]) =>
        t.replace(new RegExp(`(^|[\\s'])${from}(?=[/\\s']|$)`, "g"), `$1${to}`),
      a,
    ),
  )

let rigs = 0

async function makeRig(): Promise<HistoryRig> {
  const dir = path.join(top, `rig-${rigs++}`)
  const yoursDir = path.join(dir, "yours")
  await mkdir(yoursDir, { recursive: true })
  await run("jj", ["git", "init", "--colocate", yoursDir])
  const yours = hostJj(yoursDir)
  let lanes = 0

  /** A lane's runners at `laneDir`, as its container's would run there. */
  const runnersAt = (laneDir: string): LaneRunners => {
    const dirs = { [HOST_WORKING_COPY]: yoursDir, [WORKSPACE_ROOT]: laneDir }
    const config = path.join(
      laneDir,
      path.relative(WORKSPACE_ROOT, LANE_JJ_CONFIG),
    )
    return {
      lane: argv => {
        const [program = "", ...args] = onHost(argv, dirs)
        return run(program, args, {
          cwd: laneDir,
          env: { ...NO_EDITOR, JJ_CONFIG: config },
        })
      },
      laneBytes: argv => hostBytesRunner(laneDir)(onHost(argv, dirs)),
    }
  }

  return {
    async accept(files) {
      for (const [file, text] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(yoursDir, file)), {
          recursive: true,
        })
        await writeFile(path.join(yoursDir, file), text)
      }
      await yours(["commit", "-m", "accepted"])
      await yours([
        "bookmark",
        "set",
        "--allow-backwards",
        DEFAULT_REPO.acceptedBookmark,
        "-r",
        "@-",
      ])
      const [commit] = await commitsOf(yours, "@-")
      if (commit === undefined) throw new Error("nothing accepted")
      return commit
    },

    async lane() {
      const lane = threadIdFor(`${lanes++}`)
      const laneDir = path.join(dir, `lane-${lane}`)
      await mkdir(laneDir, { recursive: true })
      const runners = runnersAt(laneDir)
      const [accepted] = await commitsOf(
        yours,
        `present(${JSON.stringify(DEFAULT_REPO.acceptedBookmark)})`,
      )
      if (accepted === undefined) throw new Error("no accepted work")
      const steps: LaneStep[] = [
        ...planBaseCheckout({ yours: [accepted], fresh: true }),
        ...planForkSetup(lane, { kind: "accepted", commit: accepted }),
      ]
      await executeOrThrow(steps, runners)
      const fetched: unknown[] = []
      const pending: Promise<void>[] = []
      /** The lane into your repo by bundle, as the host's fetch does. */
      const fetch = (have: readonly (CommitId | null)[]) => {
        fetched.push(have)
        pending.push(
          (async () => {
            const bundle = path.join(dir, `${lane}-${fetched.length}.bundle`)
            const held: CommitId[] = []
            for (const c of have)
              if (
                c !== null &&
                (
                  await run("git", ["cat-file", "-e", `${c}^{commit}`], {
                    cwd: yoursDir,
                  })
                ).ok
              )
                held.push(c)
            await executeOrThrow(
              [
                planBundle({
                  bookmark: bookmarkName(lane),
                  have: held,
                  to: bundle,
                }),
              ],
              runners,
            )
            await executeRepo(
              yoursDir,
              planImport({ lane, bundle, stack: false }),
            )
          })(),
        )
      }
      const history = historyOf({
        lane,
        runners,
        repoConfig: DEFAULT_REPO,
        fetch,
      })
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
        withHistory(f) {
          const next = queue.then(() => f(history))
          queue = next.catch(() => {})
          return next
        },
        async offLine() {
          await runners.lane(["jj", "-R", WORKSPACE_ROOT, "new", "root()"])
        },
        fetched,
        async settled() {
          await Promise.all(pending)
        },
      }
    },

    fileAt: (point, file) => fileAt(yours, DEFAULT_REPO, point, file),

    close: () => rm(dir, { recursive: true, force: true }),
  }
}

historySuite({ test, expect }, makeRig)
