import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { laneNameForThread, NO_EDITOR } from "@pineta/core"
import { DEFAULT_LINE, run } from "@pineta/lanes"
import type { Agent } from "@pineta/pi"
import type { RepoOwner } from "@pineta/repo"
import { afterAll, expect, test } from "vitest"
import { basics, record } from "../fakes.ts"
import { createOfferState } from "./state.ts"

const dirs: string[] = []
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

test("placeOf reads where a lane's offer sits and starts, and writes nothing", async () => {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "pineta-place-")),
  )
  dirs.push(dir)
  const env = { ...NO_EDITOR, JJ_USER: "Probe", JJ_EMAIL: "probe@example.com" }
  const jj = (...args: string[]) => run("jj", ["-R", dir, ...args], { env })
  await run("jj", ["git", "init", "--colocate", dir], { env })
  await writeFile(path.join(dir, "a.txt"), "a\n")
  await jj("commit", "-m", "base")
  await jj("bookmark", "create", DEFAULT_LINE.onto, "-r", "@-")
  await writeFile(path.join(dir, "b.txt"), "b\n")
  await jj("commit", "-m", "the lane's work")
  const tip = (await jj("log", "--no-graph", "-r", "@-", "-T", "commit_id"))
    .stdout
  const lane = laneNameForThread("1")
  await run("git", ["update-ref", `refs/remotes/pineta-${lane}/tip`, tip], {
    cwd: dir,
  })
  await jj("git", "import")
  // An agent with no `writeValues`: a write would throw.
  const agent = record<Agent>({})
  const state = createOfferState({
    owner: record<RepoOwner>({}).port,
    line: DEFAULT_LINE,
    lineCommands: true,
    basics: basics(),
    agent: () => agent.port,
    running: () => false,
    taken: () => {},
  })
  const place = await state.placeOf(
    { jj: args => run("jj", ["-R", dir, "--ignore-working-copy", ...args]) },
    lane,
  )
  expect(place).toMatchObject({
    tip,
    base: { base: { kind: "line" } },
    state: "ok",
  })
  expect(agent.calls).toEqual([])
})
