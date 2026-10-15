import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { NO_EDITOR } from "@pinetrie/core"
import { lines, run } from "@pinetrie/lanes"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { runnerFor } from "./run.ts"
import type { RepoStep } from "./step.ts"
import {
  executeTidy,
  gatherTidy,
  isTidyRaced,
  type OpLogFacts,
  parseOpLog,
  planTidy,
  planTidyHint,
  readOpLog,
} from "./tidy.ts"

const DAY = 86_400
const NOW = 100 * DAY
/** An op log of operations begun `ages` days ago, newest first. */
const log = (...ages: number[]): OpLogFacts => ({
  ops: ages.map((age, i) => ({ id: `op${i}`, at: NOW - age * DAY })),
})
const argvs = (steps: readonly RepoStep[]) =>
  steps.map(
    s => `${s.tool === "git" ? "git" : `jj as ${s.as}`}: ${s.args.join(" ")}`,
  )

describe("planTidy: what a tidy cuts, from your op log", () => {
  const plan = (
    ops: OpLogFacts,
    over: Partial<Parameters<typeof planTidy>[0]> = {},
  ) =>
    planTidy({
      ops,
      workspaces: ["default"],
      served: false,
      days: 7,
      now: NOW,
      ...over,
    })
  test("nothing older than the window: nothing to do, and how old the oldest is", () => {
    expect(plan(log(0, 3, 6))).toEqual({
      kind: "nothing",
      oldest: NOW - 6 * DAY,
    })
    expect(plan(log())).toEqual({ kind: "nothing", oldest: null })
  })
  test("a cut at the newest operation older than the window, keeping those after it", () => {
    expect(plan(log(0, 2, 8, 9, 30))).toMatchObject({
      kind: "tidy",
      cut: "op2",
      kept: 2,
      cutCount: 3,
      expectMs: 12,
    })
  })
  test("its steps: a snapshot and the abandon as you, with your working copy; the index rebuilt; gc at jj's own expiry", () => {
    const planned = plan(log(0, 8))
    if (planned.kind !== "tidy") throw new Error("no tidy")
    expect(argvs(planned.steps)).toEqual([
      "jj as you: util snapshot",
      "jj as you: op abandon ..op1",
      "jj as you: --ignore-working-copy debug reindex",
      "jj as you: --ignore-working-copy util gc",
    ])
  })
  test("refused while a host serves the repo, and with a second workspace", () => {
    expect(plan(log(0, 8), { served: true })).toEqual({
      kind: "refused",
      why: { kind: "served" },
    })
    expect(plan(log(0, 8), { workspaces: ["default", "second"] })).toEqual({
      kind: "refused",
      why: { kind: "workspaces", names: ["default", "second"] },
    })
  })
})

test("isTidyRaced: more than the kept operations and the tidy's snapshot after it", () => {
  expect(isTidyRaced({ kept: 10, after: 11 })).toBe(false)
  expect(isTidyRaced({ kept: 10, after: 12 })).toBe(true)
})

test("planTidyHint: said once the oldest operation is more than twice the window old", () => {
  expect(planTidyHint(log(0, 14), { days: 7, now: NOW })).toBeNull()
  expect(planTidyHint(log(0, 15), { days: 7, now: NOW })).toEqual({
    days: 15,
    count: 2,
  })
})

test("parseOpLog leaves jj's root operation out", () => {
  expect(parseOpLog(`abc 200\n${"0".repeat(128)} 0\n`)).toEqual({
    ops: [{ id: "abc", at: 200 }],
  })
})

describe("a tidy, with jj", () => {
  let top = ""
  beforeAll(async () => {
    top = await realpath(await mkdtemp(path.join(tmpdir(), "pinetrie-tidy-")))
    process.env.JJ_USER = "Probe"
    process.env.JJ_EMAIL = "probe@example.com"
  })
  afterAll(async () => {
    await rm(top, { recursive: true, force: true })
  })

  /** A repo with operations from long ago, then two from now, and jj in it as you. */
  async function oldRepo(name: string) {
    const dir = path.join(top, name)
    await run("mkdir", ["-p", dir])
    await run("jj", ["git", "init", "--colocate", dir])
    const jj = (...args: string[]) =>
      run("jj", ["-R", dir, ...args], { env: NO_EDITOR })
    for (const day of ["01", "02", "03"])
      await jj(
        "--config",
        `debug.operation-timestamp=2020-01-${day}T00:00:00Z`,
        "new",
        "--no-edit",
        "-r",
        "root()",
        "-m",
        `old ${day}`,
      )
    await writeFile(path.join(dir, "a.txt"), "a\n")
    await jj("commit", "-m", "now")
    await jj("new", "--no-edit", "-r", "root()", "-m", "now too")
    const planned = planTidy({
      ...(await gatherTidy(dir)),
      served: false,
      days: 7,
      now: Math.floor(Date.now() / 1000),
    })
    if (planned.kind !== "tidy") throw new Error("nothing to tidy")
    return { dir, jj, planned }
  }

  test("it cuts the log to the window, and your working copy is not stale after", async () => {
    const { dir, jj, planned } = await oldRepo("cut")
    await executeTidy(dir, planned.steps, () => {})
    const after = await readOpLog(runnerFor(dir, "you"))
    expect(after.ops.length).toBeLessThanOrEqual(planned.kept + 1)
    expect(isTidyRaced({ kept: planned.kept, after: after.ops.length })).toBe(
      false,
    )
    const st = await jj("st")
    expect([st.ok, st.stderr]).toEqual([true, ""])
    expect(
      lines(
        (
          await jj(
            "log",
            "--no-graph",
            "-r",
            'description(exact:"old 01\n")',
            "-T",
            "commit_id",
          )
        ).stdout,
      ),
    ).toHaveLength(1)
  }, 60_000)

  test("a write that loaded the head before the abandon is kept, and the tidy reads as raced", async () => {
    const { dir, jj, planned } = await oldRepo("raced")
    const [snapshot, abandon, ...rest] = planned.steps
    if (snapshot === undefined || abandon === undefined)
      throw new Error("no steps")
    await executeTidy(dir, [snapshot], () => {})
    const head = (await jj("op", "log", "--no-graph", "-n", "1", "-T", "id"))
      .stdout
    await executeTidy(dir, [abandon], () => {})
    await jj(
      "--ignore-working-copy",
      "--at-op",
      head,
      "new",
      "--no-edit",
      "-r",
      "root()",
      "-m",
      "beside",
    )
    await executeTidy(dir, rest, () => {})
    const after = await readOpLog(runnerFor(dir, "you"))
    expect(isTidyRaced({ kept: planned.kept, after: after.ops.length })).toBe(
      true,
    )
    expect(
      lines(
        (
          await jj(
            "log",
            "--no-graph",
            "-r",
            'description(exact:"beside\n")',
            "-T",
            "commit_id",
          )
        ).stdout,
      ),
    ).toHaveLength(1)
  }, 60_000)
})
