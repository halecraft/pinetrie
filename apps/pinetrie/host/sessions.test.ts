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
import { tryLock } from "@pinetrie/lock"
import { type ChildHoldingLock, childHoldingLock } from "@pinetrie/lock/testing"
import { afterAll, afterEach, beforeEach, expect, test } from "vitest"
import {
  dropSessionDirs,
  type OpenedSession,
  openSession,
  type RegistryLocked,
  registryFiles,
  renameSession,
  sessionDirs,
  sessionLockFile,
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
  const got = await openSession({ root, env, dirs, onWaiting: () => {} })
  if ("refused" in got) throw new Error(JSON.stringify(got.refused))
  await got.releaseLock()
  return got
}

const open = (root: string, env: Record<string, string> = {}) =>
  openSession({ root, env, dirs, onWaiting: () => {} })

/** Holders in other processes: a test that fails leaves none alive. */
const holders: ChildHoldingLock[] = []
afterAll(() => {
  for (const h of holders) h.child.kill("SIGKILL")
})

/** `file`'s lock held by another process, as another host holds it. */
async function heldElsewhere(file: string): Promise<ChildHoldingLock> {
  mkdirSync(path.dirname(file), { recursive: true })
  const h = childHoldingLock(file)
  holders.push(h)
  expect(await h.said).toBe("held")
  return h
}

const registryNames = (): string[] =>
  JSON.parse(readFileSync(registryFiles(data).registry, "utf8")).entries.map(
    (e: { name: string }) => e.name,
  )

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

test("a registry lock a killed process held is taken", async () => {
  const holder = await heldElsewhere(registryFiles(data).lock)
  holder.child.kill("SIGKILL")
  await holder.exited
  expect((await opened(folder("website"))).name).toBe("website")
})

test("a host waiting for the registry's lock says once whom for, then opens", async () => {
  const holder = await heldElsewhere(registryFiles(data).lock)
  const heard: unknown[] = []
  const got = await openSession({
    root: folder("website"),
    env: {},
    dirs,
    onWaiting: pid => {
      heard.push(pid)
      holder.child.kill("SIGKILL")
    },
  })
  expect(heard).toEqual([{ saidPid: holder.child.pid }])
  if ("refused" in got) throw new Error("refused")
  await got.releaseLock()
})

test("a second host on a served session is refused, naming the first's pid", async () => {
  const site = await opened(folder("website"))
  const holder = await heldElsewhere(sessionLockFile(site.dir))
  expect(await open(folder("website"))).toEqual({
    refused: { kind: "served", name: "website", pid: holder.child.pid },
  })
})

test("an attach is refused while another host serves the session it would drop", async () => {
  const old = folder("old", "website")
  await opened(old)
  rmSync(old, { recursive: true })
  const moved = folder("new", "website")
  const own = await opened(moved)
  const holder = await heldElsewhere(sessionLockFile(own.dir))
  expect(await open(moved, { PINETRIE_SESSION: "website" })).toEqual({
    refused: { kind: "served", name: own.name, pid: holder.child.pid },
  })
  expect(existsSync(own.dir)).toBe(true)
})

test("a refused open leaves the session's lock free", async () => {
  await opened(folder("website"))
  const own = await opened(folder("other", "website"))
  // Both sessions' locks are tried; the attach is refused, the first's
  // folder being still there.
  const refused = await open(folder("other", "website"), {
    PINETRIE_SESSION: "website",
  })
  expect(refused).toMatchObject({ refused: { kind: "has-own" } })
  const again = await tryLock(sessionLockFile(own.dir), {
    platform: process.platform,
    heldWhile: "until-released",
  })
  expect(again.kind).toBe("held")
  if (again.kind === "held") await again.release()
})

test("a registry that is not one is refused, and left as it was", async () => {
  mkdirSync(data, { recursive: true })
  const file = registryFiles(data).registry
  writeFileSync(file, "{ not json")
  const got = await open(folder("website"))
  expect(got).toEqual({
    refused: { kind: "broken", file, why: "not-json" },
  })
  expect(readFileSync(file, "utf8")).toBe("{ not json")
})

test("a served session holds its lock until it is released", async () => {
  const got = await open(folder("website"))
  if ("refused" in got) throw new Error("refused")
  const options = {
    platform: process.platform,
    heldWhile: "until-released",
  } as const
  expect((await tryLock(sessionLockFile(got.dir), options)).kind).toBe(
    "held-by-another",
  )
  expect(readFileSync(sessionLockFile(got.dir), "utf8")).toBe(
    `${process.pid}\n`,
  )
  await got.releaseLock()
  const after = await tryLock(sessionLockFile(got.dir), options)
  expect(after.kind).toBe("held")
  if (after.kind === "held") await after.release()
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
  const got = await open(moved, { PINETRIE_SESSION: "website" })
  expect(got).toMatchObject({ refused: { kind: "own-holds", file: local } })
  expect(readFileSync(local, "utf8")).toBe("{}")
})

test("a session's directories that gained a file are kept, naming it", async () => {
  const own = sessionDirs(dirs, sessionNameFor("website"))
  mkdirSync(own.data, { recursive: true })
  mkdirSync(own.config, { recursive: true })
  writeFileSync(path.join(own.config, "pinetrie.json"), "{}")
  const held = await tryLock(sessionLockFile(own.data), {
    platform: process.platform,
    heldWhile: "until-released",
  })
  if (held.kind !== "held") throw new Error(held.kind)
  // As openSession holds the registry's lock, whose proof only it makes.
  const locked = {} as RegistryLocked
  expect(await dropSessionDirs(locked, held, own)).toBe(own.config)
  expect(existsSync(path.join(own.config, "pinetrie.json"))).toBe(true)
})

test("a renamed session's directories move with it", async () => {
  const site = await opened(folder("website"))
  const local = path.join(sessionDirs(dirs, site.name).config, "pinetrie.json")
  mkdirSync(path.dirname(local), { recursive: true })
  writeFileSync(local, "{}")
  expect(await renameSession(dirs, "website", "site", () => {})).toMatchObject({
    kind: "renamed",
  })
  const moved = sessionDirs(dirs, sessionNameFor("site"))
  expect(registryNames()).toEqual(["site"])
  expect(existsSync(moved.data)).toBe(true)
  expect(readFileSync(path.join(moved.config, "pinetrie.json"), "utf8")).toBe(
    "{}",
  )
  expect(existsSync(site.dir)).toBe(false)
  // Its lock moved with it, free: a host serves it under its new name.
  const again = await opened(folder("website"))
  expect(again.name).toBe("site")
})

test("a session a live host serves is not renamed", async () => {
  const site = await opened(folder("website"))
  const holder = await heldElsewhere(sessionLockFile(site.dir))
  expect(await renameSession(dirs, "website", "site", () => {})).toEqual({
    kind: "refused",
    why: { kind: "served", name: "website", pid: holder.child.pid },
  })
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
