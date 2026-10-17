import { spawnSync } from "node:child_process"
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, expect, test } from "vitest"
import { checkTarPaths, tarStream } from "./tar-out.ts"

let dir = ""
let root = ""
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pinetrie-tar-out-"))
  root = path.join(dir, "snapshot")
  await mkdir(path.join(root, "d"), { recursive: true })
  await writeFile(path.join(root, "a.txt"), "a")
  await writeFile(path.join(root, "d/run.sh"), "#!/bin/sh\n")
  await chmod(path.join(root, "d/run.sh"), 0o755)
  await writeFile(path.join(dir, "secret"), "outside")
  await symlink(dir, path.join(root, "out"))
  await symlink("a.txt", path.join(root, "link"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test("checkTarPaths refuses a path that climbs out, one under a symlink, a symlink, and one missing", async () => {
  await expect(checkTarPaths(root, ["../secret"])).rejects.toThrow(
    "not a path inside",
  )
  await expect(checkTarPaths(root, ["out/secret"])).rejects.toThrow(
    "out is not one",
  )
  await expect(checkTarPaths(root, ["link"])).rejects.toThrow("link is not one")
  await expect(checkTarPaths(root, ["nope"])).rejects.toThrow("missing")
  await expect(checkTarPaths(root, ["a.txt", "d/run.sh"])).resolves.toBe(
    undefined,
  )
})

test("tarStream's stream extracts to the files it names, their executable bit kept", async () => {
  const chunks: Uint8Array[] = []
  for await (const c of tarStream(root, ["a.txt", "d/run.sh"])) chunks.push(c)
  const into = path.join(dir, "into")
  await mkdir(into)
  const x = spawnSync("tar", ["-xf", "-", "--no-same-owner", "-C", into], {
    input: Buffer.concat(chunks),
  })
  expect(x.status).toBe(0)
  expect(await readFile(path.join(into, "a.txt"), "utf8")).toBe("a")
  expect((await stat(path.join(into, "d/run.sh"))).mode & 0o100).toBe(0o100)
})

test("tarStream writes nothing for a refused path", async () => {
  const chunks: Uint8Array[] = []
  await expect(
    (async () => {
      for await (const c of tarStream(root, ["a.txt", "out/secret"]))
        chunks.push(c)
    })(),
  ).rejects.toThrow()
  expect(chunks).toEqual([])
})

test("tar-out.ts, run as the disks role runs it, takes its paths on stdin and refuses one outside", () => {
  const script = path.join(import.meta.dirname, "tar-out.ts")
  const ok = spawnSync("node", [script, root], { input: "a.txt\0d/run.sh\0" })
  expect(ok.status).toBe(0)
  const listed = spawnSync("tar", ["-tf", "-"], { input: ok.stdout })
  expect(String(listed.stdout).trim().split("\n").sort()).toEqual([
    "a.txt",
    "d/run.sh",
  ])
  const refused = spawnSync("node", [script, root], { input: "out/secret\0" })
  expect(refused.status).toBe(1)
  expect(refused.stdout.length).toBe(0)
})
