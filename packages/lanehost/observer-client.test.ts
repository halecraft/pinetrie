// The client against a role made of plain objects: each channel it opens
// answers `register` with one namespace, `flush` at once, and keeps the
// subscription's callback, through which a test sends the lane's notices.

import type {
  FoldNotices,
  OutputEvent,
  PathTrace,
  RunEvent,
  RunNotice,
  RunTrace,
  RunTraces,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import { ClientClosed } from "./closed.ts"
import { MIN_BATCH } from "./gathered.ts"
import type { ObserverUpdate } from "./observer.ts"
import { type ObserverChannel, observerClient } from "./observer-client.ts"
import { UNCLAIMED_PER_LANE } from "./unclaimed.ts"

const LANE = "4026532001"

interface FakeRole {
  /** A notice of the lane, as the role sends it on the channel open now. */
  send(run: string, event: RunEvent): void
  /** An output event of the lane, as the role sends it on the channel open now. */
  sendOutput(run: string, output: OutputEvent): void
  /** Flushes the role has answered. */
  readonly flushes: () => number
  /** Notices the role sends on the next channel before it answers `register`. */
  holdForNext(notices: readonly RunNotice[]): void
  readonly open: () => Promise<ObserverChannel>
}

/** A role whose hello holds no attribution, as one older than attribution sends. */
const OLDER_HELLO = { version: "v0", loader: { kind: "ready" } } as const

function fakeRole(
  hello: Awaited<ObserverChannel["ready"]> = {
    version: "v1",
    loader: { kind: "ready" },
    attribution: { on: true },
  },
): FakeRole {
  let subscriber: ((n: ObserverUpdate) => void) | null = null
  let outputs: ((n: ObserverUpdate) => void) | null = null
  let held: readonly RunNotice[] = []
  let flushes = 0
  return {
    send: (run, event) => subscriber?.({ lane: LANE, run, event }),
    sendOutput: (run, output) => outputs?.({ lane: LANE, run, output }),
    flushes: () => flushes,
    holdForNext: notices => {
      held = notices
    },
    open: async () => {
      let close = () => {}
      const closed = new Promise<void>(resolve => {
        close = resolve
      })
      return {
        ready: Promise.resolve(hello),
        call: async (call, _signal, onUpdate) => {
          if (call.kind === "subscribe") {
            subscriber = onUpdate ?? null
            return closed
          }
          if (call.kind === "subscribe-output") {
            outputs = onUpdate ?? null
            return closed
          }
          if (call.kind === "flush") flushes++
          if (call.kind === "register") {
            for (const n of held) subscriber?.({ lane: LANE, ...n })
            held = []
            return LANE
          }
          return null
        },
        close,
        closed,
      }
    },
  }
}

const READ: PathTrace = {
  before: true,
  wrote: false,
  read: false,
  missed: false,
  dir: false,
  reportedWrite: false,
  reportedRead: false,
  reportedMissing: false,
}

const traceWith = (paths: ReadonlyMap<string, PathTrace>): RunTrace => ({
  id: "1",
  command: null,
  exit: null,
  ended: false,
  lost: 0,
  paths,
  dirty: new Set(),
  accesses: [],
  changed: true,
})

/**
 * A fold that keeps, per path, whether something was there at its first
 * event, as the real one decides; `batches` records each batch it is given.
 */
function firstEventFold(): {
  readonly fold: FoldNotices
  readonly batches: (readonly RunNotice[])[]
} {
  const batches: (readonly RunNotice[])[] = []
  const fold: FoldNotices = (traces, batch) => {
    batches.push(batch)
    const prior = traces.get("1")
    const paths = new Map(prior?.paths)
    for (const n of batch)
      if (n.event.kind === "call" && !paths.has(n.event.path))
        paths.set(n.event.path, {
          ...READ,
          before: n.event.before !== "missing",
        })
    return new Map(traces).set("1", traceWith(paths))
  }
  return { fold, batches }
}

const open = (path: string, before: "file" | "missing"): RunEvent => ({
  kind: "call",
  op: "open",
  at: 0,
  pid: 7,
  flags: 0,
  before,
  path,
  before2: "missing",
  path2: "",
  stamp: null,
  raced: null,
})

const keep = (traces: RunTraces) => Promise.resolve({ traces, result: traces })

test("a lane's notices are folded in batches as they arrive, never held whole", async () => {
  const role = fakeRole()
  const { fold, batches } = firstEventFold()
  const lane = await observerClient({ open: role.open }).observe({
    pid: async () => 4,
    remote: [],
    fold,
  })
  for (let i = 0; i < 100_000; i++) role.send("1", open("/w/a", "file"))
  // Read after the run: a batch emptied in place would read as empty here.
  expect(batches.length).toBe(Math.floor(100_000 / MIN_BATCH))
  for (const b of batches) expect(b.length).toBe(MIN_BATCH)
  const traces = await lane.drain(keep)
  expect([...(traces.get("1")?.paths.keys() ?? [])]).toEqual(["/w/a"])
})

test("a reclaimed lane's held notices are folded after what it already holds", async () => {
  const role = fakeRole()
  const client = observerClient({ open: role.open })
  const lane = await client.observe({
    pid: async () => 4,
    remote: [],
    fold: firstEventFold().fold,
  })
  role.send("1", open("/w/p", "missing"))
  client.reset()
  role.holdForNext([{ run: "1", event: open("/w/p", "file") }])
  const traces = await lane.drain(keep)
  expect(traces.get("1")?.paths.get("/w/p")?.before).toBe(false)
})

test("notices that arrive during a drain reach the next one", async () => {
  const role = fakeRole()
  const lane = await observerClient({ open: role.open }).observe({
    pid: async () => 4,
    remote: [],
    fold: firstEventFold().fold,
  })
  await lane.drain(async traces => {
    role.send("1", open("/w/late", "file"))
    return { traces, result: null }
  })
  const traces = await lane.drain(keep)
  expect([...(traces.get("1")?.paths.keys() ?? [])]).toEqual(["/w/late"])
})

test("drains run one after another, each given what the one before returned", async () => {
  const role = fakeRole()
  const lane = await observerClient({ open: role.open }).observe({
    pid: async () => 4,
    remote: [],
    fold: firstEventFold().fold,
  })
  const order: string[] = []
  let release = () => {}
  const first = lane.drain(async () => {
    order.push("first begins")
    await new Promise<void>(resolve => {
      release = resolve
    })
    order.push("first ends")
    return {
      traces: new Map([["marker", traceWith(new Map())]]),
      result: null,
    }
  })
  const second = lane.drain(async traces => {
    order.push("second begins")
    return { traces, result: [...traces.keys()] }
  })
  await new Promise(r => setTimeout(r, 10))
  release()
  await first
  expect(await second).toEqual(["marker"])
  expect(order).toEqual(["first begins", "first ends", "second begins"])
})

test("connect opens the channel once, and a lane observed after it registers on that channel", async () => {
  const role = fakeRole()
  let opened = 0
  const client = observerClient({
    open: () => {
      opened++
      return role.open()
    },
  })
  await client.connect()
  expect(opened).toBe(1)
  const { fold } = firstEventFold()
  const lane = await client.observe({ pid: async () => 4, remote: [], fold })
  role.send("1", open("/w/a", "file"))
  const traces = await lane.drain(keep)
  expect(opened).toBe(1)
  expect([...(traces.get("1")?.paths.keys() ?? [])]).toEqual(["/w/a"])
})

test("connect rejects with the loader's refusal", async () => {
  const role = fakeRole()
  const client = observerClient({
    open: async () => ({
      ...(await role.open()),
      ready: Promise.resolve({
        version: "v1",
        loader: { kind: "failed", why: "observe: load: Invalid" },
        attribution: { on: true },
      }),
    }),
  })
  await expect(client.connect()).rejects.toThrow("observe: load: Invalid")
})

const bytes = (n: number): OutputEvent => ({
  kind: "output",
  fd: "stdout",
  statement: null,
  bytes: n,
})

const observed = async (role: FakeRole) => {
  const client = observerClient({ open: role.open })
  const { fold } = firstEventFold()
  return client.observe({ pid: async () => 4, remote: [], fold })
}

test("a claim gets its run's earlier output first, then each as it comes", async () => {
  const role = fakeRole()
  const lane = await observed(role)
  role.sendOutput("7", bytes(1))
  role.sendOutput("8", bytes(9))
  role.sendOutput("7", bytes(2))
  const got: OutputEvent[] = []
  lane.output("7", e => got.push(e))
  role.sendOutput("7", bytes(3))
  expect(got).toEqual([bytes(1), bytes(2), bytes(3)])
})

test("output past the unclaimed bound reaches its claim as output-lost", async () => {
  const role = fakeRole()
  const lane = await observed(role)
  for (let i = 0; i < UNCLAIMED_PER_LANE; i++) role.sendOutput("1", bytes(1))
  role.sendOutput("2", bytes(1))
  role.sendOutput("2", bytes(1))
  const got: OutputEvent[] = []
  lane.output("2", e => got.push(e))
  expect(got).toEqual([{ kind: "output-lost", count: 2 }])
})

test("a released run's late output is dropped, not held", async () => {
  const role = fakeRole()
  const lane = await observed(role)
  const release = lane.output("1", () => {})
  release()
  for (let i = 0; i < UNCLAIMED_PER_LANE; i++) role.sendOutput("1", bytes(1))
  role.sendOutput("2", bytes(4))
  const got: OutputEvent[] = []
  lane.output("2", e => got.push(e))
  expect(got).toEqual([bytes(4)])
})

test("settle answers after the role's flush", async () => {
  const role = fakeRole()
  const lane = await observed(role)
  expect(role.flushes()).toBe(0)
  await lane.settle()
  expect(role.flushes()).toBe(1)
})

test("the client's attribution is off before a hello, and the hello's once connected", async () => {
  const client = observerClient({ open: fakeRole().open })
  expect(client.attribution.on).toBe(false)
  await client.connect()
  expect(client.attribution).toEqual({ on: true })
  await client.close()
})

test("a lane's attribution is the role's hello's", async () => {
  const lane = await observed(fakeRole())
  expect(lane.attribution).toEqual({ on: true })
})

test("behind a role whose hello holds no attribution, a lane's is off", async () => {
  const lane = await observed(
    fakeRole(OLDER_HELLO as unknown as Awaited<ObserverChannel["ready"]>),
  )
  expect(lane.attribution).toEqual({
    on: false,
    why: "other-version",
    version: "v0",
  })
})

test("close ends the channel, and a call after it is refused", async () => {
  const role = fakeRole()
  let opened = 0
  const client = observerClient({
    open: async () => {
      opened++
      return role.open()
    },
  })
  await client.connect()
  await client.close()
  await expect(client.connect()).rejects.toBeInstanceOf(ClientClosed)
  await expect(
    client.observe({
      pid: async () => 4,
      remote: [],
      fold: firstEventFold().fold,
    }),
  ).rejects.toBeInstanceOf(ClientClosed)
  expect(opened).toBe(1)
})
