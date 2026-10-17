import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, test } from "vitest"
import { fileStream } from "./file-out.ts"

let dir = ""
let root = ""
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pinetrie-file-out-"))
  root = path.join(dir, "snapshot")
  await mkdir(path.join(root, "img"), { recursive: true })
  await writeFile(path.join(root, "img/a.png"), Buffer.from([0x89, 0, 1, 2]))
  await writeFile(path.join(dir, "secret"), "outside")
  await symlink(dir, path.join(root, "out"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const read = async (p: string) => {
  const chunks: Uint8Array[] = []
  for await (const c of fileStream(root, p)) chunks.push(c)
  return Buffer.concat(chunks)
}

test("fileStream answers a file's bytes, and nothing for a path that climbs out or runs under a symlink", async () => {
  expect([...(await read("img/a.png"))]).toEqual([0x89, 0, 1, 2])
  await expect(read("../secret")).rejects.toThrow("not a path inside")
  await expect(read("out/secret")).rejects.toThrow("out is not one")
})

test("file-out.ts, run as the disks role runs it, takes its path on stdin and refuses one outside", () => {
  const script = path.join(import.meta.dirname, "file-out.ts")
  const ok = spawnSync("node", [script, root], { input: "img/a.png" })
  expect([ok.status, [...ok.stdout]]).toEqual([0, [0x89, 0, 1, 2]])
  const refused = spawnSync("node", [script, root], { input: "out/secret" })
  expect([refused.status, refused.stdout.length]).toEqual([1, 0])
})
