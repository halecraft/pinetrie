// The port suite against jj's adapter: lanes as throwaway repos on the host,
// with your repo beside them, and the host's runner standing in for a lane's
// channel. A lane's `/workspace` and `/mnt/host-working-copy` are directories
// here. The harness supplies the rig's test-only hooks with jj run in the
// lane's own repo, and accepts an offer by the steps `repo.test.ts` uses
// (`fixtures.ts`).

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
  type PointId,
  pointFromCommit,
  type ThreadId,
  type ThreadName,
  threadIdFor,
  WORKSPACE_ROOT,
} from "@pinetrie/core"
import {
  describeFailure,
  executeOrThrow,
  hostBytesRunner,
  LANE_JJ_CONFIG,
  type LaneRunners,
  type LaneStep,
  laneIgnores,
  lines,
  run,
} from "@pinetrie/lanes"
import { type HistoryRig, historySuite } from "@pinetrie/lanes/testing"
import { afterAll, beforeAll, expect, test } from "vitest"
import { fileAt } from "../file-at.ts"
import {
  acceptedIn,
  acceptOffer,
  fetchLane,
  jjLaneFor,
  offerTip,
} from "../fixtures.ts"
import { hostJj } from "../run.ts"
import { historyOf } from "./history.ts"
import { DEFAULT_REPO } from "./names.ts"
import { planBaseCheckout, planForkSetup } from "./plan.ts"
import { commitFromPoint } from "./points.ts"
import { commitsOf, isAncestor } from "./revisions.ts"
import { laneJj } from "./run.ts"

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
  /** Each lane's runners, by its id: the hooks run in the lane's own repo. */
  const runnersOf = new Map<ThreadId, LaneRunners>()
  const runnersFor = (lane: ThreadId): LaneRunners => {
    const runners = runnersOf.get(lane)
    if (runners === undefined) throw new Error(`no lane ${lane}`)
    return runners
  }
  /** `lane`'s jj, and its points read as commits. */
  const inLane = (lane: ThreadId) => {
    const proven = jjLaneFor(lane)
    return {
      jj: laneJj(runnersFor(lane).lane),
      commit: (p: PointId) => commitFromPoint(proven, p),
    }
  }

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
    async yoursOnAccepted(files) {
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
      return pointFromCommit(commit)
    },

    async lane() {
      const lane = threadIdFor(`${lanes++}`)
      const laneDir = path.join(dir, `lane-${lane}`)
      await mkdir(laneDir, { recursive: true })
      const runners = runnersAt(laneDir)
      runnersOf.set(lane, runners)
      const accepted = await acceptedIn(yours, DEFAULT_REPO)
      const steps: LaneStep[] = [
        ...planBaseCheckout({ yours: [accepted], fresh: true }),
        ...planForkSetup(jjLaneFor(lane), {
          kind: "accepted",
          point: pointFromCommit(accepted),
        }),
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
            await fetchLane(runners, yoursDir, { lane, have: held, bundle })
          })(),
        )
      }
      const history = historyOf({
        lane: jjLaneFor(lane),
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
          await laneJj(runners.lane)(["new", "root()"])
        },
        fetched,
        async settled() {
          await Promise.all(pending)
        },
        async commitAsAgent(message) {
          const ran = await laneJj(runners.lane)(["commit", "-m", message])
          if (!ran.ok) throw new Error(describeFailure("jj commit", ran))
        },
      }
    },

    fileAt: (point, file) => fileAt(yours, DEFAULT_REPO, point, file),

    isAncestor(lane, a, b) {
      const { jj, commit } = inLane(lane)
      return isAncestor(jj, commit(a), commit(b))
    },

    // Deliberately not jj's `changedPaths`: `recordTurn` computes a turn's
    // paths with it, so "A turn's paths are its diff." would compare it
    // with itself. `--name-only`
    // prints a path unquoted, so the suite's paths are plain.
    async changedPaths(lane, from, to) {
      const { jj, commit } = inLane(lane)
      const ran = await jj([
        "diff",
        "--ignore-working-copy",
        "--from",
        commit(from),
        "--to",
        commit(to),
        "--name-only",
      ])
      if (!ran.ok) throw new Error(describeFailure("jj diff", ran))
      return lines(ran.stdout).sort()
    },

    async accept({ lane }) {
      const name = `rig-lane-${lane}` as ThreadName
      await fetchLane(runnersFor(lane), yoursDir, {
        lane,
        have: [],
        bundle: path.join(dir, `${lane}-offer.bundle`),
      })
      const built = await offerTip(yoursDir, {
        lane,
        name,
        repoConfig: DEFAULT_REPO,
      })
      const [top] = built.changes
      if (top === undefined) throw new Error("no offer")
      await acceptOffer(yoursDir, { name, top, repoConfig: DEFAULT_REPO })
      return pointFromCommit(await acceptedIn(yours, DEFAULT_REPO))
    },

    close: () => rm(dir, { recursive: true, force: true }),
  }
}

historySuite({ test, expect }, makeRig)
