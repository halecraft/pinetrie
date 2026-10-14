import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { readConfigFile } from "./read.ts"

test("readConfigFile: a file's text, a missing one, and one that cannot be read", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-config-"))
  try {
    const at = (name: string) => path.join(dir, name)
    await writeFile(at("good.json"), '{ "digests": { "enabled": false } }')
    await mkdir(at("folder.json"))
    expect(await readConfigFile(at("good.json"))).toEqual({
      kind: "text",
      text: '{ "digests": { "enabled": false } }',
    })
    expect(await readConfigFile(at("none.json"))).toEqual({ kind: "missing" })
    expect(await readConfigFile(at("folder.json"))).toEqual({
      kind: "unreadable",
      reason: expect.stringContaining("EISDIR"),
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
