import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { PassThrough } from "node:stream"
import { afterAll, describe, expect, test } from "vitest"
import {
  awaitLock,
  holderPid,
  holdOutcome,
  type LockOptions,
  lockCommand,
  removeLockFile,
  type SaidPid,
  tryLock,
  withLock,
} from "./lock.ts"
import { type ChildHoldingLock, childHoldingLock } from "./testing.ts"

describe("holdOutcome", () => {
  test.each([
    ["held\n", null, "held"],
    ["held\n", 0, "held"],
    ["waiting\nheld\n", null, "held"],
    ["waiting\n", null, "waiting"],
    ["hel", null, "undecided"],
    ["", null, "undecided"],
    ["", 1, "held-by-another"],
    ["", 2, "failed"],
    ["", -1, "failed"],
    ["waiting\n", 2, "failed"],
    ["oops\n", 1, "failed"],
  ] as const)("%j, exit %s, is %s", (said, exit, kind) => {
    expect(holdOutcome({ said, exit })).toBe(kind)
  })
})

test("an OS with neither backend has no lock command", () => {
  expect(lockCommand("win32", "x", "try")).toBe(null)
  expect(lockCommand("linux", "x", "try")?.[0]).toBe("sh")
  expect(lockCommand("darwin", "x", "wait")?.[0]).toBe("/usr/bin/perl")
})

test("a lock on an OS with neither backend has failed, saying so", async () => {
  const attempt = await tryLock("x", {
    platform: "win32",
    heldWhile: "until-released",
  })
  expect(attempt.kind).toBe("failed")
  if (attempt.kind === "failed") expect(attempt.detail).toContain("win32")
})

const dir = mkdtempSync(path.join(tmpdir(), "pinetrie-lock-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** Every holder started: a test that fails leaves none alive to hold the run open. */
const holders: ChildHoldingLock[] = []
afterAll(() => {
  for (const h of holders) h.child.kill("SIGKILL")
})

/** Each backend's tests: the Mac's runs only there, Linux's wherever `flock` is. */
function lockSuite(platform: NodeJS.Platform): void {
  let n = 0
  const fresh = () => path.join(dir, `${platform}-${++n}.lock`)
  const options: LockOptions = { platform, heldWhile: "until-released" }
  /** A holder in another process, on this platform's command. */
  const holding = (file: string) => {
    const command = lockCommand(platform, file, "try")
    const h = childHoldingLock(
      file,
      command === null ? {} : { command: [...command] },
    )
    holders.push(h)
    return h
  }

  test("a second taker of a held lock is held-by-another", async () => {
    const file = fresh()
    const first = await tryLock(file, options)
    expect(first.kind).toBe("held")
    expect((await tryLock(file, options)).kind).toBe("held-by-another")
    if (first.kind === "held") await first.release()
  })

  test("a lock released is taken by the next", async () => {
    const file = fresh()
    const first = await tryLock(file, options)
    if (first.kind === "held") await first.release()
    const next = await tryLock(file, options)
    expect(next.kind).toBe("held")
    if (next.kind === "held") await next.release()
  })

  test("a holder killed with SIGKILL frees the lock for the next", async () => {
    const file = fresh()
    const holder = holding(file)
    expect(await holder.said).toBe("held")
    holder.child.kill("SIGKILL")
    await holder.exited
    const next = await tryLock(file, options)
    expect(next.kind).toBe("held")
    if (next.kind === "held") await next.release()
  })

  test("a holder whose input ends exits, and frees the lock", async () => {
    const file = fresh()
    const holder = holding(file)
    expect(await holder.said).toBe("held")
    holder.child.stdin?.end()
    await holder.exited
    const next = await tryLock(file, options)
    expect(next.kind).toBe("held")
    if (next.kind === "held") await next.release()
  })

  test("a Ctrl-C to its holder's process group leaves the lock held", async () => {
    const file = fresh()
    const holder = holding(file)
    expect(await holder.said).toBe("held")
    if (holder.child.pid === undefined) throw new Error("no pid")
    process.kill(-holder.child.pid, "SIGINT")
    await holder.heardInterrupt
    expect((await tryLock(file, options)).kind).toBe("held-by-another")
  })

  test("a waiter hears once whom it waits for, and holds only once the holder lets go", async () => {
    const file = fresh()
    const first = await tryLock(file, { ...options, writePid: true })
    if (first.kind !== "held") throw new Error(first.kind)
    const heard: (SaidPid | null)[] = []
    let releaseAsked = false
    const waiting = awaitLock(file, {
      ...options,
      onWaiting: holder => {
        heard.push(holder)
        releaseAsked = true
        void first.release()
      },
    })
    const second = await waiting
    expect(second.kind).toBe("held")
    expect(releaseAsked).toBe(true)
    expect(heard).toEqual([{ saidPid: process.pid }])
    if (second.kind === "held") await second.release()
  })

  test("a holder's pid is in its file, for words", async () => {
    const file = fresh()
    const held = await tryLock(file, { ...options, writePid: true })
    expect(await holderPid(file)).toEqual({ saidPid: process.pid })
    if (held.kind === "held") await held.release()
  })

  test("withLock releases the lock when its work throws", async () => {
    const file = fresh()
    await expect(
      withLock(file, { platform, onWaiting: () => {} }, async () => {
        throw new Error("work failed")
      }),
    ).rejects.toThrow("work failed")
    const next = await tryLock(file, options)
    expect(next.kind).toBe("held")
    if (next.kind === "held") await next.release()
  })

  test("removeLockFile removes its own file, and frees the lock", async () => {
    const file = fresh()
    const other = fresh()
    const held = await tryLock(file, options)
    const kept = await tryLock(other, options)
    if (held.kind !== "held" || kept.kind !== "held")
      throw new Error("not held")
    await removeLockFile(held)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(other)).toBe(true)
    await kept.release()
  })
}

describe("a lock on darwin", { tags: ["mac-host"] }, () => lockSuite("darwin"))
describe("a lock on linux", { tags: ["flock"] }, () => lockSuite("linux"))

test("a child that ends without saying held has failed, with its words", async () => {
  const attempt = await tryLock("", {
    platform: "linux",
    heldWhile: new PassThrough(),
    command: ["sh", "-c", "echo no lock here >&2; exit 3"],
  })
  expect(attempt).toEqual({ kind: "failed", detail: "no lock here" })
})

test("a child that cannot start has failed", async () => {
  const attempt = await tryLock("", {
    platform: "linux",
    heldWhile: new PassThrough(),
    command: ["/no/such/program"],
  })
  expect(attempt.kind).toBe("failed")
})

test("a child that exits unasked after it held is the lock lost", async () => {
  const attempt = await tryLock("", {
    platform: "linux",
    heldWhile: new PassThrough(),
    command: ["sh", "-c", "echo held; exit 0"],
  })
  expect(attempt.kind).toBe("held")
  if (attempt.kind === "held") await attempt.lockLost
})
