import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { scriptedModel } from "@pinetrie/pi"
import { afterAll, expect, test } from "vitest"
import { HostRefused, startHost } from "./index.ts"

const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pinetrie-plain-")))
const userConfig = path.join(dir, "no-config.json")
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test("a host with tools on a folder with no jj repo does not start, and says how to make one", async () => {
  const started = startHost({
    model: { kind: "scripted", script: scriptedModel() },
    project: { dir, tools: true },
    userConfig,
    log: () => {},
  })
  await expect(started).rejects.toBeInstanceOf(HostRefused)
  await expect(started).rejects.toThrow(
    `${dir} has no jj repo: \`jj git init --colocate\` makes one`,
  )
})

test("a host without tools starts on a folder with no repo", async () => {
  const host = await startHost({
    model: { kind: "scripted", script: scriptedModel() },
    project: { dir, tools: false },
    userConfig,
    log: () => {},
  })
  await host.shutdown()
})
