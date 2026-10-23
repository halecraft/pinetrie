import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { sessionFiles } from "@pinetrie/lanes"
import { afterEach, beforeEach, expect, test } from "vitest"
import { openSession } from "./sessions.ts"
import { openStore } from "./store.ts"
import { takeTidyLock, tidyWords } from "./tidy.ts"

let dir = ""
let dirs = { data: "", config: "" }
beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pinetrie-tidy-lock-")))
  dirs = { data: path.join(dir, "data"), config: path.join(dir, "config") }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

/** A folder registered as a session, as a host's start leaves it, with its store file. */
async function served(name: string) {
  const root = path.join(dir, name)
  mkdirSync(root, { recursive: true })
  const opened = await openSession({ root, env: {}, dirs, onWaiting: () => {} })
  if ("refused" in opened) throw new Error("not opened")
  await opened.releaseLock()
  return { root, store: sessionFiles(opened.dir).store }
}

test("a host holding the folder's store: the tidy reads it as served", async () => {
  const { root, store } = await served("held")
  const host = openStore(store)
  try {
    expect(await takeTidyLock({ dirs, folder: root, env: {} })).toEqual({
      kind: "served",
      file: store,
    })
  } finally {
    await host.store.close()
  }
})

test("the tidy holds the store: a host opening it is refused until it lets go", async () => {
  const { root, store } = await served("tidying")
  openStore(store).store.close()
  const lock = await takeTidyLock({ dirs, folder: root, env: {} })
  if ("refused" in lock || lock.kind !== "held") throw new Error("not held")
  expect(() => openStore(store, { busyTimeoutMs: 50 })).toThrow(/pinetrie tidy/)
  lock.release()
  await openStore(store, { busyTimeoutMs: 50 }).store.close()
})

test("a folder no host has served: nothing to hold, and no store is made", async () => {
  const root = path.join(dir, "never")
  mkdirSync(root)
  expect(await takeTidyLock({ dirs, folder: root, env: {} })).toEqual({
    kind: "free",
  })
  const { store } = await served("no-store")
  expect(
    await takeTidyLock({ dirs, folder: path.join(dir, "no-store"), env: {} }),
  ).toEqual({ kind: "free" })
  expect(existsSync(store)).toBe(false)
})

test("the startup line names how far back the log goes, and what a tidy keeps", () => {
  expect(tidyWords({ kind: "hint", days: 26, count: 63162, keep: 7 })).toBe(
    "your repo's op log goes back 26 days (63,162 operations); `pinetrie tidy` would keep the last 7",
  )
})
