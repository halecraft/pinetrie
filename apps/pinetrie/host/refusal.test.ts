import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { configPlaces } from "@pinetrie/config"
import { sessionFiles } from "@pinetrie/lanes"
import { bindAgentDir, scriptedModel } from "@pinetrie/pi"
import { afterAll, expect, test } from "vitest"
import { HostRefused } from "./host-refused.ts"
import { startHost } from "./index.ts"

const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pinetrie-plain-")))
// No config of the person's: every place is in the throwaway folder.
const places = configPlaces({}, path.join(dir, "home"), null)
const binding = bindAgentDir(places.dirs.config)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test("a host with tools on a folder lanes cannot serve does not start, and says why", async () => {
  const notADirectory = path.join(dir, "a-file")
  writeFileSync(notADirectory, "")
  const started = startHost({
    model: { kind: "scripted", script: scriptedModel() },
    project: {
      dir: notADirectory,
      tools: true,
      files: sessionFiles(path.join(places.dirs.data, "sessions", "plain"))
        .lanes,
    },
    places,
    binding,
    env: {},
    log: () => {},
  })
  await expect(started).rejects.toBeInstanceOf(HostRefused)
  await expect(started).rejects.toThrow(`${notADirectory} is not a directory`)
})

test("a host without tools starts on a folder with no repo", async () => {
  const host = await startHost({
    model: { kind: "scripted", script: scriptedModel() },
    project: { dir, tools: false },
    places,
    binding,
    env: {},
    log: () => {},
  })
  await host.shutdown()
})

// It starts a host process, which under the unit suite's load can take
// longer than Vitest's default 5 s to start and exit.
test("a PINETRIE_SESSION naming another session than the folder's own exits 2 before the store opens", () => {
  const site = path.join(dir, "website")
  const blog = path.join(dir, "blog")
  const data = path.join(dir, "data")
  for (const d of [site, blog, path.join(data, "pinetrie")])
    mkdirSync(d, { recursive: true })
  const entries = [
    { path: site, name: "website", servedAt: 1 },
    { path: blog, name: "blog", servedAt: 1 },
  ]
  writeFileSync(
    path.join(data, "pinetrie", "sessions.json"),
    JSON.stringify({ version: 1, entries }),
  )
  const run = spawnSync(
    process.execPath,
    [path.join(import.meta.dirname, "serve.ts"), site],
    {
      env: {
        PATH: process.env.PATH,
        PINETRIE_SESSION: "blog",
        XDG_DATA_HOME: data,
        XDG_CONFIG_HOME: path.join(dir, "config"),
      },
      encoding: "utf8",
      timeout: 60_000,
    },
  )
  expect(run.status).toBe(2)
  expect(run.stderr).toContain("this folder is session website")
  for (const name of ["website", "blog"])
    expect(
      existsSync(path.join(data, "pinetrie", "sessions", name, "pinetrie.db")),
    ).toBe(false)
}, 30_000)
