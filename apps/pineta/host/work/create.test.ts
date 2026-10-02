import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { commitId, ERR } from "@pineta/core"
import { expect, test } from "vitest"
import { deferred } from "../fakes.ts"
import { checkDirectory, forkFacts } from "./create.ts"

test("forkFacts reads nothing before every pending turn record is written", async () => {
  const pending = deferred<void>()
  const read: string[] = []
  const facts = forkFacts({
    pendingRecords: () => pending.promise,
    nearest: () => {
      read.push("nearest")
      return { lane: null, commit: null, snapshot: null }
    },
    begin: async () => {
      read.push("begin")
      return { kind: "line", onto: "pineta-onto", commit: commitId("aaaa0000") }
    },
  })
  await new Promise(r => setTimeout(r, 10))
  expect(read).toEqual([])
  pending.resolve()
  await facts
  expect(read).toEqual(["nearest", "begin"])
})

test("checkDirectory refuses a file and a missing path, and takes a directory", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pineta-dir-"))
  const file = path.join(dir, "a.txt")
  await writeFile(file, "a")
  const direct = (d: string) => ({ kind: "direct", dir: d }) as const
  expect(await checkDirectory(direct(dir))).toBeNull()
  expect(await checkDirectory(direct(file))).toBe(ERR.BAD_DIRECTORY)
  expect(await checkDirectory(direct(path.join(dir, "none")))).toBe(
    ERR.BAD_DIRECTORY,
  )
  expect(await checkDirectory(null)).toBeNull()
})
