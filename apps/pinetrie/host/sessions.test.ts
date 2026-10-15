import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { sessionNameFor } from "@pinetrie/config/testing"
import { afterEach, beforeEach, expect, test } from "vitest"
import {
  dropSessionDirs,
  hostPidFile,
  type OpenedSession,
  openSession,
  registryFiles,
  renameSession,
  sessionDirs,
  sessionOfFolder,
} from "./sessions.ts"

let dir = ""
let data = ""
let dirs = { data: "", config: "" }
beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pinetrie-sessions-")))
  data = path.join(dir, "data")
  dirs = { data, config: path.join(dir, "config") }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const folder = (...parts: string[]): string => {
  const at = path.join(dir, ...parts)
  mkdirSync(at, { recursive: true })
  return at
}

async function opened(
  root: string,
  env: Record<string, string> = {},
): Promise<OpenedSession> {
  const got = await openSession({ root, env, dirs })
  if ("refused" in got) throw new Error(JSON.stringify(got.refused))
  await got.release()
  return got
}

const registryNames = (): string[] =>
  JSON.parse(readFileSync(registryFiles(data).registry, "utf8")).entries.map(
    (e: { name: string }) => e.name,
  )

/** A pid that names no process: a child's, once it has exited. */
const deadPid = (): number => {
  const child = spawnSync(process.execPath, ["-e", ""])
  return child.pid ?? 0
}

test("a folder through a symlink and directly is one session", async () => {
  const site = folder("work", "website")
  symlinkSync(site, path.join(dir, "link"))
  const direct = await opened(site)
  const linked = await opened(path.join(dir, "link"))
  expect(linked.name).toBe(direct.name)
  expect(linked.plan.kind).toBe("found")
  expect(registryNames()).toEqual(["website"])
})

test("two folders named website are two sessions, each with its own directory", async () => {
  const a = await opened(folder("a", "website"))
  const b = await opened(folder("b", "website"))
  expect(a.name).toBe("website")
  expect(b.name).toMatch(/^website-[a-z]+-[a-z]+$/)
  expect(a.dir).not.toBe(b.dir)
  expect(realpathSync(b.dir)).toBe(b.dir)
})

test("two sessions opened at once both land in the registry", async () => {
  const roots = ["one", "two", "three", "four"].map(n => folder(n))
  await Promise.all(roots.map(r => opened(r)))
  expect(registryNames().sort()).toEqual(["four", "one", "three", "two"])
})

test("a lock left by a process that died is taken over", async () => {
  mkdirSync(data, { recursive: true })
  writeFileSync(registryFiles(data).lock, `${deadPid()}\n`)
  expect((await opened(folder("website"))).name).toBe("website")
})

test("a registry that is not one is refused, and left as it was", async () => {
  mkdirSync(data, { recursive: true })
  const file = registryFiles(data).registry
  writeFileSync(file, "{ not json")
  const got = await openSession({ root: folder("website"), env: {}, dirs })
  expect(got).toEqual({
    refused: { kind: "broken", file, why: "not-json" },
  })
  expect(readFileSync(file, "utf8")).toBe("{ not json")
})

test("a served session holds host.pid until it is released", async () => {
  const got = await openSession({ root: folder("website"), env: {}, dirs })
  if ("refused" in got) throw new Error("refused")
  expect(readFileSync(hostPidFile(got.dir), "utf8")).toBe(`${process.pid}\n`)
  await got.release()
  expect(() => readFileSync(hostPidFile(got.dir))).toThrow()
})

test("a moved folder is attached by PINETRIE_SESSION", async () => {
  const old = folder("old", "website")
  await opened(old)
  rmSync(old, { recursive: true })
  const moved = await opened(folder("new", "website"), {
    PINETRIE_SESSION: "website",
  })
  expect(moved.plan).toMatchObject({ kind: "attached", from: old })
  expect(registryNames()).toEqual(["website"])
})

test("a moved folder started once is attached when its own session holds nothing", async () => {
  const old = folder("old", "website")
  await opened(old)
  rmSync(old, { recursive: true })
  const moved = folder("new", "website")
  const own = await opened(moved)
  const attached = await opened(moved, { PINETRIE_SESSION: "website" })
  expect(attached.plan).toMatchObject({
    kind: "attached",
    from: old,
    dropped: own.name,
  })
  expect(registryNames()).toEqual(["website"])
  expect(existsSync(own.dir)).toBe(false)
})

test("a moved folder's own session with a local file is not replaced, and the file stays", async () => {
  const old = folder("old", "website")
  await opened(old)
  rmSync(old, { recursive: true })
  const moved = folder("new", "website")
  const own = await opened(moved)
  const local = path.join(sessionDirs(dirs, own.name).config, "pinetrie.json")
  mkdirSync(path.dirname(local), { recursive: true })
  writeFileSync(local, "{}")
  const got = await openSession({
    root: moved,
    env: { PINETRIE_SESSION: "website" },
    dirs,
  })
  expect(got).toMatchObject({ refused: { kind: "own-holds", file: local } })
  expect(readFileSync(local, "utf8")).toBe("{}")
})

test("a session's directories that gained a file are kept, naming it", async () => {
  const own = sessionDirs(dirs, sessionNameFor("website"))
  mkdirSync(own.data, { recursive: true })
  mkdirSync(own.config, { recursive: true })
  writeFileSync(path.join(own.config, "pinetrie.json"), "{}")
  expect(await dropSessionDirs(own)).toBe(own.config)
  expect(existsSync(path.join(own.config, "pinetrie.json"))).toBe(true)
})

test("a renamed session's directories move with it", async () => {
  const site = await opened(folder("website"))
  const local = path.join(sessionDirs(dirs, site.name).config, "pinetrie.json")
  mkdirSync(path.dirname(local), { recursive: true })
  writeFileSync(local, "{}")
  expect(await renameSession(dirs, "website", "site")).toMatchObject({
    kind: "renamed",
  })
  const moved = sessionDirs(dirs, sessionNameFor("site"))
  expect(registryNames()).toEqual(["site"])
  expect(existsSync(moved.data)).toBe(true)
  expect(readFileSync(path.join(moved.config, "pinetrie.json"), "utf8")).toBe(
    "{}",
  )
  expect(existsSync(site.dir)).toBe(false)
})

test("a session a live host serves is not renamed", async () => {
  const site = await openSession({ root: folder("website"), env: {}, dirs })
  if ("refused" in site) throw new Error("refused")
  expect(await renameSession(dirs, "website", "site")).toEqual({
    kind: "refused",
    why: { kind: "served", name: "website", pid: process.pid },
  })
  await site.release()
  expect(registryNames()).toEqual(["website"])
})

test.skipIf(process.platform !== "darwin")(
  "a folder opened in another case is the same session (the Mac's disks ignore case)",
  async () => {
    const site = folder("Website")
    const first = await opened(site)
    const again = await opened(path.join(dir, "website"))
    expect(again.path).toBe(site)
    expect(again.name).toBe(first.name)
  },
)

test("sessionOfFolder finds a registered folder, and writes nothing for one never served", async () => {
  const served = await opened(folder("served"))
  expect(await sessionOfFolder(dirs, folder("served"))).toEqual({
    name: served.name,
    dir: served.dir,
  })
  const before = readFileSync(registryFiles(data).registry, "utf8")
  expect(await sessionOfFolder(dirs, folder("never"))).toBeNull()
  expect(readFileSync(registryFiles(data).registry, "utf8")).toBe(before)
})
