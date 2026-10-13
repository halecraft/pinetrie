import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { openChannel } from "@pinetrie/channel"
import { encodeRunEvent, type RunEvent, stamp } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  decodeLoaderLine,
  encodeLoaderCommand,
  HELD_PER_LANE,
  heldNotices,
  IDLE_MS,
  isRaced,
  isStrictDescendant,
  loaderRefusal,
  noticeOf,
  type ObserverCall,
  type ObserverHello,
  type ObserverNotice,
  observerVersion,
  planHeld,
  planIdle,
  planObserver,
  planRegistration,
  routeEvent,
  translatedPid,
} from "./observer.ts"

const release = (s: string, raced: string | null): RunEvent => ({
  kind: "call",
  op: "release",
  at: 5,
  pid: 7,
  flags: 1,
  before: "file",
  path: "/workspace/.plans/a.md",
  before2: "missing",
  path2: "",
  stamp: stamp(s),
  raced: raced === null ? null : stamp(raced),
})

const notice = (lane: string, event: RunEvent): ObserverNotice => ({
  lane,
  run: "3",
  event,
})

describe("the loader's lines", () => {
  test("an event line is its lane, its run and core's event", () => {
    const e = release("4:20", "4:10")
    expect(decodeLoaderLine(`ev\t21\t3\t9/9\t${encodeRunEvent(e)}`)).toEqual({
      kind: "event",
      lane: "21",
      run: "3",
      inodes: { kernel: 9, lstat: 9 },
      event: e,
    })
  })
  test("each answer is read, and any other line is none", () => {
    expect(decodeLoaderLine("registered\t369\t21")).toEqual({
      kind: "registered",
      pid: 369,
      lane: "21",
    })
    expect(
      decodeLoaderLine("refused\t3\tno process 3: No such\\tfile"),
    ).toEqual({ kind: "refused", pid: 3, why: "no process 3: No such\tfile" })
    expect(decodeLoaderLine("flushed\t7")).toEqual({
      kind: "flushed",
      token: "7",
    })
    expect(decodeLoaderLine("ev\t21\tx\t-\tend\t1")).toBeNull()
    expect(decodeLoaderLine("hello")).toBeNull()
  })
  test("a register names the first process and each remote directory, escaped", () => {
    expect(
      encodeLoaderCommand({
        kind: "register",
        pid: 12,
        remote: ["/workspace/.plans", "/a\tb"],
      }),
    ).toBe("register\t12\t/workspace/.plans\t/a\\tb")
  })
})

describe("a remote release", () => {
  test("is raced when the size or the inode differs, never by ctime alone", () => {
    expect(isRaced({ stamp: "4:1", ino: 9 }, { stamp: "4:2", ino: 9 })).toBe(
      false,
    )
    expect(isRaced({ stamp: "4:1", ino: 9 }, { stamp: "5:1", ino: 9 })).toBe(
      true,
    )
    expect(isRaced({ stamp: "4:1", ino: 9 }, { stamp: "4:1", ino: 8 })).toBe(
      true,
    )
  })
  test("keeps the kernel's stamp only when raced", () => {
    const line = (inodes: { kernel: number; lstat: number }) =>
      noticeOf({
        kind: "event",
        lane: "21",
        run: "3",
        inodes,
        event: release("4:20", "4:10"),
      }).event
    expect(line({ kernel: 9, lstat: 9 })).toMatchObject({ raced: null })
    expect(line({ kernel: 9, lstat: 8 })).toMatchObject({ raced: "4:10" })
  })
})

describe("routing", () => {
  const owners = new Map([["21", 1]])
  test("a notice goes to the subscribed connection that registered its lane", () => {
    expect(
      routeEvent(owners, new Set([1]), notice("21", { kind: "end", at: 1 })),
    ).toEqual({ kind: "send", to: 1 })
  })
  test("a notice of a lane no subscribed connection holds is held", () => {
    const end = notice("21", { kind: "end", at: 1 })
    expect(routeEvent(owners, new Set(), end)).toEqual({ kind: "hold" })
    expect(routeEvent(new Map(), new Set([1]), end)).toEqual({ kind: "hold" })
  })
  test("a lane holds up to its bound, then counts each loss; an end is always kept", () => {
    const open = notice("21", release("1:1", null))
    expect(planHeld(HELD_PER_LANE - 1, HELD_PER_LANE, open)).toBe("keep")
    expect(planHeld(HELD_PER_LANE, HELD_PER_LANE, open)).toBe("lose")
    expect(
      planHeld(
        HELD_PER_LANE,
        HELD_PER_LANE,
        notice("21", { kind: "end", at: 1 }),
      ),
    ).toBe("keep")
  })
  test("a lane's new host gets what was held, then each run's losses, then the ends", () => {
    const end = notice("21", { kind: "end", at: 2 })
    const open = notice("21", release("1:1", null))
    expect(
      heldNotices({
        lane: "21",
        held: [end, open],
        lost: new Map([["3", 4]]),
        at: 9,
      }),
    ).toEqual([
      open,
      { lane: "21", run: "3", event: { kind: "lost", at: 9, count: 4 } },
      end,
    ])
  })
})

describe("namespace registration", () => {
  test("translation requires one outer process for the inner pid", () => {
    const candidates = [
      { pid: 41, nspid: [41, 7] },
      { pid: 42, nspid: [42, 8] },
    ]
    expect(translatedPid(candidates, 7)).toEqual(candidates[0])
    expect(translatedPid(candidates, 9)).toBeNull()
    expect(
      translatedPid([...candidates, { pid: 43, nspid: [43, 7] }], 7),
    ).toBeNull()
  })
  test("ancestry is strict and reaches the forwarding namespace", () => {
    expect(isStrictDescendant("30", ["20", "10"], "20")).toBe(true)
    expect(isStrictDescendant("20", ["10"], "20")).toBe(false)
    expect(isStrictDescendant("30", ["10"], "20")).toBe(false)
  })
  test("only an unowned namespace or its live owner may register it", () => {
    expect(planRegistration({ kind: "unowned" }, 2)).toEqual({
      kind: "install",
    })
    expect(planRegistration({ kind: "owned", connection: 2 }, 2)).toEqual({
      kind: "refresh",
    })
    expect(planRegistration({ kind: "owned", connection: 1 }, 2).kind).toBe(
      "refuse",
    )
  })
})

describe("the role's life", () => {
  test("it exits once no connection has been open for a minute", () => {
    expect(planIdle({ connections: 0, quietSince: 0, now: IDLE_MS })).toBe(
      "exit",
    )
    expect(planIdle({ connections: 0, quietSince: 0, now: IDLE_MS - 1 })).toBe(
      "stay",
    )
    expect(planIdle({ connections: 1, quietSince: 0, now: IDLE_MS * 9 })).toBe(
      "stay",
    )
  })
  test("rootless Docker is forwarded inside a lane and refused outside one", () => {
    expect(planObserver({ rootless: false, forwarded: false })).toEqual({
      kind: "container",
    })
    expect(planObserver({ rootless: true, forwarded: true })).toEqual({
      kind: "forwarded",
    })
    expect(planObserver({ rootless: true, forwarded: false }).kind).toBe(
      "refused",
    )
  })
  test("a loader that failed refuses lanes with its own words", () => {
    const hello = (loader: ObserverHello["loader"]): ObserverHello => ({
      version: "v",
      loader,
    })
    expect(loaderRefusal(hello({ kind: "ready" }))).toBeNull()
    expect(
      loaderRefusal(hello({ kind: "failed", why: "observe: load: Invalid" })),
    ).toContain("observe: load: Invalid")
  })
  test("its version changes with any source, whatever their order", () => {
    const a = { path: "a", content: "1" }
    const b = { path: "b", content: "2" }
    expect(observerVersion([a, b])).toBe(observerVersion([b, a]))
    expect(observerVersion([a, b])).not.toBe(
      observerVersion([a, { ...b, content: "3" }]),
    )
  })
})

describe("the machine role's server, with a stand-in loader", () => {
  const server = path.join(import.meta.dirname, "observer-server.ts")
  const connect = path.join(import.meta.dirname, "observer-connect.ts")
  const loader = path.join(import.meta.dirname, "fixtures/stand-in-observe.mjs")

  test("a host's lane's notices reach it, and a flush answers after them", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "observer-"))
    const socket = path.join(dir, "observer.sock")
    const role = spawn("node", [server, socket, loader, "v1"], {
      stdio: "inherit",
    })
    try {
      const open = () =>
        openChannel<ObserverHello, ObserverCall, ObserverNotice, unknown>(
          ["node", connect, socket],
          "the machine role",
        )
      let channel = open()
      for (let i = 0; i < 50; i++) {
        const ready = await channel.ready.then(
          () => true,
          () => false,
        )
        if (ready) break
        await new Promise(r => setTimeout(r, 100))
        channel = open()
      }
      expect(await channel.ready).toEqual({
        version: "v1",
        loader: { kind: "ready" },
      })
      const got: ObserverNotice[] = []
      // It answers only when the connection ends.
      channel
        .call({ kind: "subscribe" }, undefined, n => got.push(n))
        .catch(() => {})
      expect(await channel.call({ kind: "register", pid: 4, remote: [] })).toBe(
        "40",
      )
      await channel.call({ kind: "flush" })
      expect(got.map(n => [n.lane, n.run, n.event.kind])).toEqual([
        ["40", "1", "exit"],
      ])
      await expect(
        channel.call({ kind: "register", pid: 0, remote: [] }),
      ).rejects.toThrow("not a process id")
      channel.close()
      await channel.closed
    } finally {
      role.kill()
    }
  })
})
