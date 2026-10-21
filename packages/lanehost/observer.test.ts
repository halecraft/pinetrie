import { mkdtempSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { serve } from "@pinetrie/channel"
import { encodeRunEvent, type RunEvent, stamp } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { standInRole } from "./fixtures.ts"
import {
  ATTRIBUTION_HOOKS,
  decodeLoaderLine,
  encodeLoaderCommand,
  HELD_PER_LANE,
  heldNotices,
  IDLE_MS,
  isRaced,
  isStrictDescendant,
  type LaneNamespace,
  loaderRefusal,
  type ObserverCall,
  type ObserverHello,
  type ObserverNotice,
  type ObserverUpdate,
  observerNotice,
  observerVersion,
  planAttribution,
  planHeld,
  planIdle,
  planLookup,
  planObserver,
  planOwnership,
  planRegister,
  planUnregister,
  type Registration,
  type RegistrationOrigin,
  relayedCall,
  routeEvent,
  translatedCandidate,
} from "./observer.ts"
import { connectObserver } from "./observer-client.ts"

/** `observer-connect.ts` on this Node, as the host builds it from its install. */
const CONNECT = [
  process.execPath,
  path.join(import.meta.dirname, "observer-connect.ts"),
]

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
    expect(decodeLoaderLine("registered\t4\t21")).toEqual({
      kind: "registered",
      token: "4",
      lane: "21",
    })
    expect(decodeLoaderLine("refused\t3\tno such\\tcandidate")).toEqual({
      kind: "refused",
      token: "3",
      why: "no such\tcandidate",
    })
    expect(decodeLoaderLine("flushed\t7")).toEqual({
      kind: "flushed",
      token: "7",
    })
    expect(decodeLoaderLine("looked\t7\tcut")).toEqual({
      kind: "looked",
      token: "7",
      cut: true,
    })
    expect(decodeLoaderLine("ev\t21\tx\t-\tend\t1")).toBeNull()
    expect(decodeLoaderLine("looked\t7\tsome")).toBeNull()
    expect(decodeLoaderLine("hello")).toBeNull()
  })
  test("an output line is its lane, its run and core's output event", () => {
    expect(decodeLoaderLine("out\t21\t3\toutput\t2\t4\t100")).toEqual({
      kind: "output",
      lane: "21",
      run: "3",
      output: { kind: "output", fd: "stderr", statement: 4, bytes: 100 },
    })
    expect(decodeLoaderLine("out\t21\t3\tend\t1")).toBeNull()
  })
  test("a hook line says whether it attached", () => {
    expect(decodeLoaderLine("hook\tpipe_unlock\tmissing")).toEqual({
      kind: "hook",
      name: "pipe_unlock",
      attached: false,
    })
    expect(decodeLoaderLine("hook\tpipe_unlock\tmaybe")).toBeNull()
  })
  test("a candidate is its pid, its NSpid and its namespaces, its own first", () => {
    expect(decodeLoaderLine("candidate\t2\t900\t900,12,1\t30,20,10")).toEqual({
      kind: "candidate",
      token: "2",
      pid: 900,
      nspid: [900, 12, 1],
      namespaces: ["30", "20", "10"],
    })
    expect(decodeLoaderLine("candidate\t2\t900\t900,x\t30")).toBeNull()
  })
  test("an install names its candidate and each remote directory, escaped", () => {
    expect(
      encodeLoaderCommand({
        kind: "install",
        token: "3",
        pid: 12,
        remote: ["/workspace/.plans", "/a\tb"],
      }),
    ).toBe("install\t3\t12\t/workspace/.plans\t/a\\tb")
    expect(
      encodeLoaderCommand({ kind: "find", token: "3", level: 1, pid: 7 }),
    ).toBe("find\t3\t1\t7")
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
      observerNotice({
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
  const owners = new Map([["21", { owner: 1 }]])
  test("a notice goes to the subscribed connection that registered its lane", () => {
    expect(
      routeEvent(owners, new Set([1]), notice("21", { kind: "end", at: 1 })),
    ).toEqual({ kind: "send", to: 1 })
  })
  test("a notice of a lane no subscribed connection holds is held", () => {
    const end = notice("21", { kind: "end", at: 1 })
    expect(routeEvent(owners, new Set(), end)).toEqual({ kind: "hold" })
    expect(routeEvent(new Map(), new Set([1]), end)).toEqual({ kind: "hold" })
    expect(
      routeEvent(new Map([["21", { owner: null }]]), new Set([1]), end),
    ).toEqual({ kind: "hold" })
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

// The machine's namespace is 10. Lane 20 (first process 200, pid 1 in it)
// is registered directly; inside it, lane 30's first process is 300 here
// and 7 in lane 20. Lane 25 is lane 20's sibling, whose process 250 is 7
// in it too.
const lane20: Registration = {
  namespaces: ["20", "10"],
  origin: { kind: "direct" },
  owner: 1,
}
const candidate = (
  pid: number,
  nspid: number[],
  namespaces: LaneNamespace[],
) => ({ pid, nspid, namespaces })
const first20 = candidate(200, [200, 1], ["20", "10"])
const first30 = candidate(300, [300, 7, 1], ["30", "20", "10"])
const sibling = candidate(250, [250, 7], ["25", "10"])
const forwarded = (
  pid: number,
  forwarding = "20",
  within = "20",
): RegistrationOrigin => ({ kind: "forwarded", pid, forwarding, within })
const registered = (
  entries: Record<string, Registration>,
): ReadonlyMap<LaneNamespace, Registration> => new Map(Object.entries(entries))

describe("namespace registration", () => {
  test("a direct registration looks up its pid; a forwarded one its pid at its forwarding lane's level", () => {
    const r = registered({ "20": lane20 })
    expect(planLookup({ kind: "direct", pid: 200 }, r, "1")).toEqual({
      kind: "open",
      token: "1",
      pid: 200,
    })
    expect(planLookup(forwarded(7), r, "2")).toEqual({
      kind: "find",
      token: "2",
      level: 1,
      pid: 7,
    })
    expect(planLookup({ kind: "direct", pid: 0 }, r, "3").kind).toBe("refuse")
  })
  test("a forwarded lookup needs its lanes registered, the forwarding one within the relaying one", () => {
    const lane30: Registration = {
      namespaces: ["30", "20", "10"],
      origin: { kind: "forwarded", forwarding: "20" },
      owner: 2,
    }
    const lane25: Registration = { ...lane20, namespaces: ["25", "10"] }
    const r = registered({ "20": lane20, "30": lane30, "25": lane25 })
    expect(planLookup(forwarded(7, "20", "40"), r, "1").kind).toBe("refuse")
    expect(planLookup(forwarded(7, "40", "20"), r, "1").kind).toBe("refuse")
    expect(planLookup(forwarded(3, "30", "20"), r, "1")).toEqual({
      kind: "find",
      token: "1",
      level: 2,
      pid: 3,
    })
    expect(planLookup(forwarded(3, "25", "20"), r, "1").kind).toBe("refuse")
    expect(planLookup(forwarded(3, "20", "30"), r, "1").kind).toBe("refuse")
  })
  test("translation takes the one process with the pid in the forwarding lane's namespace", () => {
    const at20 = { namespace: "20", level: 1 }
    expect(translatedCandidate([first30, sibling], at20, 7)).toEqual(first30)
    expect(translatedCandidate([sibling], at20, 7)).toBeNull()
    expect(translatedCandidate([first30], at20, 8)).toBeNull()
    expect(
      translatedCandidate([first30, { ...first30, pid: 301 }], at20, 7),
    ).toBeNull()
    expect(
      translatedCandidate([{ ...first30, nspid: [300, 7] }], at20, 7),
    ).toBeNull()
  })
  test("ancestry is strict and reaches the forwarding namespace", () => {
    expect(isStrictDescendant(["30", "20", "10"], "20")).toBe(true)
    expect(isStrictDescendant(["20", "10"], "20")).toBe(false)
    expect(isStrictDescendant(["25", "10"], "20")).toBe(false)
  })
  test("a live owner refreshes, a closed one's is reclaimed, another live one's is refused", () => {
    const direct = { kind: "direct" } as const
    expect(planOwnership(undefined, 2, direct)).toBe("install")
    expect(planOwnership(lane20, 1, direct)).toBe("refresh")
    expect(planOwnership({ ...lane20, owner: null }, 2, direct)).toBe("reclaim")
    expect(planOwnership(lane20, 2, direct)).toMatchObject({ kind: "refuse" })
    expect(
      planOwnership(lane20, 2, { kind: "forwarded", forwarding: "20" }),
    ).toMatchObject({ kind: "refuse" })
    expect(
      planOwnership(lane20, 1, { kind: "forwarded", forwarding: "20" }),
    ).toMatchObject({ kind: "refuse" })
  })
  test("a direct registration is its own process, in a namespace below the observer's", () => {
    const plan = (pid: number, candidates = [first20]) =>
      planRegister({
        origin: { kind: "direct", pid },
        candidates,
        cut: false,
        registrations: new Map(),
        connection: 1,
      })
    expect(plan(200)).toEqual({
      kind: "install",
      pid: 200,
      lane: "20",
      registration: lane20,
      ownership: "install",
    })
    expect(plan(201).kind).toBe("refuse")
    expect(plan(5, [candidate(5, [5], ["10"])]).kind).toBe("refuse")
  })
  test("a forwarded registration is strictly below its forwarding lane, never it, a sibling or another", () => {
    const plan = (
      candidates: readonly ReturnType<typeof candidate>[],
      pid = 7,
      cut = false,
    ) =>
      planRegister({
        origin: forwarded(pid),
        candidates,
        cut,
        registrations: registered({ "20": lane20 }),
        connection: 2,
      })
    expect(plan([first30, sibling])).toMatchObject({
      kind: "install",
      pid: 300,
      lane: "30",
      registration: {
        origin: { kind: "forwarded", forwarding: "20" },
        owner: 2,
      },
    })
    expect(plan([sibling]).kind).toBe("refuse")
    // Lane 20 itself, though no live host holds it.
    expect(
      planRegister({
        origin: forwarded(1),
        candidates: [first20, sibling],
        cut: false,
        registrations: registered({ "20": { ...lane20, owner: null } }),
        connection: 2,
      }).kind,
    ).toBe("refuse")
    expect(plan([first30], 7, true).kind).toBe("refuse")
  })
  test("a forwarded registration of a namespace another live host holds is refused", () => {
    expect(
      planRegister({
        origin: forwarded(7),
        candidates: [first30],
        cut: false,
        registrations: registered({
          "20": lane20,
          "30": { ...lane20, namespaces: ["30", "20", "10"] },
        }),
        connection: 2,
      }).kind,
    ).toBe("refuse")
  })
  test("only a lane's owner unregisters it", () => {
    expect(planUnregister(lane20, 1)).toBe("unregister")
    expect(planUnregister(lane20, 2)).toMatchObject({ kind: "refuse" })
    expect(planUnregister({ ...lane20, owner: null }, 2)).toMatchObject({
      kind: "refuse",
    })
    expect(planUnregister(undefined, 2)).toBe("gone")
  })
  test("a relayed registration is forwarded within the relaying lane, whatever it claimed", () => {
    expect(
      relayedCall(
        { kind: "register", origin: { kind: "direct", pid: 7 }, remote: [] },
        "20",
      ),
    ).toEqual({ kind: "register", origin: forwarded(7), remote: [] })
    expect(
      relayedCall(
        {
          kind: "register",
          origin: forwarded(3, "30", "99"),
          remote: [],
        },
        "20",
      ),
    ).toEqual({ kind: "register", origin: forwarded(3, "30"), remote: [] })
    expect(relayedCall({ kind: "flush", extra: 1 }, "20")).toEqual({
      kind: "flush",
    })
    expect(relayedCall({ kind: "subscribe-output" }, "20")).toEqual({
      kind: "subscribe-output",
    })
    expect(() => relayedCall({ kind: "grant" }, "20")).toThrow()
    expect(() =>
      relayedCall(
        { kind: "register", origin: { kind: "direct", pid: 7 }, remote: [] },
        null,
      ),
    ).toThrow()
  })
})

describe("attribution", () => {
  const all = ATTRIBUTION_HOOKS.map(name => ({ name, attached: true }))
  test("it is on when every hook attached", () => {
    expect(planAttribution(all)).toEqual({ on: true })
  })
  test("it is off, naming the hook, when any one is missing", () => {
    for (const hook of ATTRIBUTION_HOOKS) {
      const missing = all.map(h =>
        h.name === hook ? { name: hook, attached: false } : h,
      )
      expect(planAttribution(missing)).toEqual({
        on: false,
        why: "missing-hook",
        hook,
      })
      expect(planAttribution(all.filter(h => h.name !== hook))).toEqual({
        on: false,
        why: "missing-hook",
        hook,
      })
    }
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
      attribution: { on: true },
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
  const direct = (pid: number): ObserverCall => ({
    kind: "register",
    origin: { kind: "direct", pid },
    remote: [],
  })

  test("a host's lane's notices reach it, and a flush answers after them", async () => {
    const role = await standInRole()
    try {
      const channel = connectObserver(CONNECT, role.socket)
      expect(await channel.ready).toEqual({
        version: "v1",
        loader: { kind: "ready" },
        attribution: { on: true },
      })
      const got: ObserverUpdate[] = []
      const output: ObserverUpdate[] = []
      // Each answers only when the connection ends.
      channel
        .call({ kind: "subscribe" }, undefined, n => got.push(n))
        .catch(() => {})
      channel
        .call({ kind: "subscribe-output" }, undefined, n => output.push(n))
        .catch(() => {})
      expect(await channel.call(direct(4))).toBe("40")
      await channel.call({ kind: "flush" })
      expect(got).toEqual([
        { lane: "40", run: "1", event: { kind: "exit", at: 1, status: 0 } },
      ])
      expect(output).toEqual([
        {
          lane: "40",
          run: "1",
          output: { kind: "output", fd: "stdout", statement: 1, bytes: 5 },
        },
      ])
      await expect(channel.call(direct(0))).rejects.toThrow("not a process id")
      await expect(channel.call(direct(3))).rejects.toThrow(
        "observer's own PID namespace",
      )
      channel.close()
      await channel.closed
    } finally {
      role.close()
    }
  })

  test("a forwarded host registers only below its lane, and no host takes another live one's lane", async () => {
    const role = await standInRole()
    try {
      const outer = connectObserver(CONNECT, role.socket)
      const inner = connectObserver(CONNECT, role.socket)
      expect(await outer.call(direct(4))).toBe("40")
      expect(
        await inner.call({
          kind: "register",
          origin: { kind: "forwarded", pid: 7, forwarding: "40", within: "40" },
          remote: [],
        }),
      ).toBe("50")
      await expect(
        inner.call({
          kind: "register",
          origin: { kind: "forwarded", pid: 1, forwarding: "40", within: "40" },
          remote: [],
        }),
      ).rejects.toThrow("forwarding lane's own namespace")
      await expect(inner.call(direct(4))).rejects.toThrow("another live host")
      await expect(
        inner.call({ kind: "unregister", lane: "40" }),
      ).rejects.toThrow("only the host that registered")
      // The same host's again is a refresh.
      expect(await outer.call(direct(4))).toBe("40")
      outer.close()
      await outer.closed
      const again = connectObserver(CONNECT, role.socket)
      expect(await again.call(direct(4))).toBe("40")
      expect(await inner.call({ kind: "unregister", lane: "50" })).toBeNull()
      again.close()
      inner.close()
      await Promise.all([again.closed, inner.closed])
    } finally {
      role.close()
    }
  })
})

test("a connection waits for a socket made after it starts", async () => {
  const socket = path.join(
    mkdtempSync(path.join(tmpdir(), "observer-")),
    "late.sock",
  )
  const channel = connectObserver(CONNECT, socket)
  await new Promise(r => setTimeout(r, 500))
  const server = net
    .createServer(s =>
      serve({ late: true }, async () => null, { input: s, output: s }),
    )
    .listen(socket)
  try {
    expect(await channel.ready).toEqual({ late: true })
    channel.close()
    await channel.closed
  } finally {
    server.close()
  }
})
