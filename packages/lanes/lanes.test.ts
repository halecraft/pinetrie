import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { entryId, laneNameForThread, WORKSPACE_ROOT } from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  changedPaths,
  commitsOf,
  entryOfMessage,
  execute,
  hostRunner,
  type LaneStep,
  type Ran,
  type Runner,
  revisionMessage,
  run,
} from "./index.ts"

// What a lane runs against jj itself, in throwaway repos, with your repo in
// it, is `@pineta/repo`'s `repo.test.ts`: every such test fetches into your
// repo.

const LANE = laneNameForThread("1")

test("revisionMessage and entryOfMessage round-trip the entry trailer", () => {
  const message = revisionMessage({
    title: "fix it",
    entry: entryId("e-1"),
    lane: LANE,
  })
  expect(entryOfMessage(message)).toBe("e-1")
  expect(entryOfMessage("your commit")).toBeNull()
})

describe("execute", () => {
  const ok: Ran = { ok: true, code: 0, stdout: "", stderr: "" }
  test("runs each step where it says, in order, and stops at the first that fails", async () => {
    const seen: string[] = []
    const runner =
      (where: string, fail: string): Runner =>
      async argv => {
        seen.push(`${where}: ${argv.join(" ")}`)
        return argv[0] === fail
          ? { ok: false, code: 1, stdout: "", stderr: "no" }
          : ok
      }
    const steps: LaneStep[] = [
      { in: "lane", argv: ["sync"] },
      { in: "host", argv: ["cp"] },
      { in: "lane", argv: ["bad"] },
      { in: "host", argv: ["never"] },
    ]
    const done = await execute(steps, {
      host: runner("host", ""),
      lane: runner("lane", "bad"),
      laneBytes: async () => ({ ...ok, stdout: new Uint8Array() }),
    })
    expect(seen).toEqual(["lane: sync", "host: cp", "lane: bad"])
    expect(done).toMatchObject({ ok: false, step: steps[2] })
  })
})

test("changedPaths: a path with a space and an accent comes back as it is named (S70)", async () => {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "pineta-paths-")),
  )
  try {
    const git: Runner = args =>
      hostRunner(dir)(args.map(a => (a === WORKSPACE_ROOT ? dir : a)))
    const env = {
      ...process.env,
      JJ_USER: "Probe",
      JJ_EMAIL: "probe@example.com",
    }
    await run("jj", ["git", "init", "--colocate", dir], { env })
    const jj = (args: string[]) => run("jj", ["-R", dir, ...args], { env })
    const jjAt: Runner = args => run("jj", ["-R", dir, ...args])
    await writeFile(path.join(dir, "a.txt"), "a\n")
    await jj(["commit", "-m", "one"])
    const [from] = await commitsOf(jjAt, "@-")
    await mkdir(path.join(dir, "d"), { recursive: true })
    await writeFile(path.join(dir, "d", "c é.txt"), "c\n")
    await jj(["commit", "-m", "two"])
    const [to] = await commitsOf(jjAt, "@-")
    if (from === undefined || to === undefined) throw new Error("no commits")
    expect(await changedPaths(git, from, to)).toEqual(["d/c é.txt"])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
