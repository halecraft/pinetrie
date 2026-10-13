// lanehost/observer-server — the machine role: its container's one long
// process, holding the observer's loader (`observer/observe.c`) for every
// host on the machine. Each host's channel is one connection to its socket
// (`observer-connect.ts`, through the runtime's `exec -i`), served with
// `@pinetrie/channel`:
//   <runtime loader> … node observer-server.ts <socket> <loader> <version>
// What it decides is `observer.ts`'s; this executes it. It exits once no
// connection has been open for `IDLE_MS`, and with the loader.

import { spawn } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import net from "node:net"
import path from "node:path"
import readline from "node:readline"
import { serve } from "@pinetrie/channel"
import {
  type ConnectionId,
  decodeLoaderLine,
  encodeLoaderCommand,
  HELD_PER_LANE,
  heldNotices,
  type LaneCgroup,
  type LoaderCommand,
  noticeOf,
  type ObserverCall,
  type ObserverHello,
  type ObserverNotice,
  planHeld,
  planIdle,
  routeEvent,
} from "./observer.ts"

const [socketPath = "", loaderPath = "", version = ""] = process.argv.slice(2)

const loader = spawn(loaderPath, [], { stdio: ["pipe", "pipe", "pipe"] })
let loaderErr = ""
loader.stderr.setEncoding("utf8")
loader.stderr.on("data", (chunk: string) => {
  loaderErr = (loaderErr + chunk).slice(-4000)
})
let state: ObserverHello["loader"] | null = null
let readyHook: () => void = () => {}
const started = new Promise<ObserverHello["loader"]>(resolve => {
  loader.on("error", error => {
    state ??= { kind: "failed", why: `${loaderPath}: ${error.message}` }
    resolve(state)
  })
  loader.on("exit", code => {
    const why = loaderErr.trim() || `the loader exited ${code}`
    state ??= { kind: "failed", why }
    resolve(state)
    // A loader that dies after it was ready leaves every lane unobserved.
    if (state.kind === "ready") {
      console.error(`observer: the loader exited: ${why}`)
      process.exit(1)
    }
  })
  readyHook = () => {
    state = { kind: "ready" }
    resolve(state)
  }
})

const send = (c: LoaderCommand) =>
  loader.stdin.write(`${encodeLoaderCommand(c)}\n`)

interface Connection {
  update: ((n: ObserverNotice) => void) | null
  readonly lanes: Set<LaneCgroup>
}
const connections = new Map<ConnectionId, Connection>()
const owners = new Map<LaneCgroup, ConnectionId>()
const held = new Map<
  LaneCgroup,
  { notices: ObserverNotice[]; lost: Map<string, number> }
>()
const registering = new Map<
  number,
  ((answer: { lane: LaneCgroup } | { why: string }) => void)[]
>()
const unregistering = new Map<LaneCgroup, (() => void)[]>()
const flushing = new Map<string, () => void>()
let nextFlush = 0
let quietSince = Date.now()

const subscribed = () =>
  new Set([...connections].flatMap(([id, c]) => (c.update ? [id] : [])))
const monotonicUs = () => Number(process.hrtime.bigint() / 1000n)

function route(notice: ObserverNotice) {
  const r = routeEvent(owners, subscribed(), notice)
  if (r.kind === "send") {
    connections.get(r.to)?.update?.(notice)
    return
  }
  const h = held.get(notice.lane) ?? {
    notices: [] as ObserverNotice[],
    lost: new Map<string, number>(),
  }
  held.set(notice.lane, h)
  if (planHeld(h.notices.length, HELD_PER_LANE, notice) === "keep")
    h.notices.push(notice)
  else h.lost.set(notice.run, (h.lost.get(notice.run) ?? 0) + 1)
}

/** A lane's held notices, to the connection that now owns it, once it has subscribed. */
function release(lane: LaneCgroup) {
  const h = held.get(lane)
  const to = owners.get(lane)
  const update = to === undefined ? null : connections.get(to)?.update
  if (h === undefined || update == null) return
  held.delete(lane)
  for (const n of heldNotices({
    lane,
    held: h.notices,
    lost: h.lost,
    at: monotonicUs(),
  }))
    update(n)
}

const take = <K, V>(m: Map<K, V[]>, k: K): V | undefined => {
  const list = m.get(k)
  const first = list?.shift()
  if (list?.length === 0) m.delete(k)
  return first
}

readline.createInterface({ input: loader.stdout }).on("line", text => {
  const line = decodeLoaderLine(text)
  if (line === null) return
  switch (line.kind) {
    case "ready":
      readyHook()
      return
    case "event":
      route(noticeOf(line))
      return
    case "registered":
      take(registering, line.pid)?.({ lane: line.lane })
      return
    case "refused":
      take(registering, line.pid)?.({ why: line.why })
      return
    case "unregistered":
      take(unregistering, line.lane)?.()
      return
    case "flushed":
      flushing.get(line.token)?.()
      flushing.delete(line.token)
      return
  }
})

const queued = <K, V>(m: Map<K, V[]>, k: K, v: V) =>
  m.set(k, [...(m.get(k) ?? []), v])

async function answer(
  id: ConnectionId,
  call: ObserverCall,
  update: ((n: ObserverNotice) => void) | undefined,
  signal: AbortSignal,
): Promise<unknown> {
  const loaded = await started
  if (loaded.kind === "failed") throw new Error(loaded.why)
  const conn = connections.get(id)
  if (conn === undefined) throw new Error("the connection has closed")
  switch (call.kind) {
    case "register": {
      const got = await new Promise<{ lane: LaneCgroup } | { why: string }>(
        resolve => {
          queued(registering, call.pid, resolve)
          send(call)
        },
      )
      if ("why" in got) throw new Error(got.why)
      owners.set(got.lane, id)
      conn.lanes.add(got.lane)
      release(got.lane)
      return got.lane
    }
    case "unregister": {
      await new Promise<void>(resolve => {
        queued(unregistering, call.lane, resolve)
        send(call)
      })
      if (owners.get(call.lane) === id) owners.delete(call.lane)
      conn.lanes.delete(call.lane)
      return null
    }
    case "subscribe": {
      if (update === undefined) throw new Error("subscribe asks for updates")
      conn.update = update
      for (const lane of conn.lanes) release(lane)
      await new Promise<void>(resolve =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      )
      conn.update = null
      return null
    }
    case "flush": {
      const token = String(nextFlush++)
      await new Promise<void>(resolve => {
        flushing.set(token, resolve)
        send({ kind: "flush", token })
      })
      return null
    }
  }
}

mkdirSync(path.dirname(socketPath), { recursive: true })
rmSync(socketPath, { force: true })
let nextConnection = 0
net
  .createServer(socket => {
    const id = nextConnection++
    connections.set(id, { update: null, lanes: new Set() })
    // A host gone keeps its lanes' runs: their notices are held for the
    // host that registers them again, as one does after it restarts.
    socket.on("close", () => {
      const conn = connections.get(id)
      connections.delete(id)
      for (const lane of conn?.lanes ?? [])
        if (owners.get(lane) === id) owners.delete(lane)
      if (connections.size === 0) quietSince = Date.now()
    })
    socket.on("error", () => {})
    void started.then(loaded =>
      serve<ObserverHello, ObserverCall, ObserverNotice, unknown>(
        { version, loader: loaded },
        (call, context) => answer(id, call, context.update, context.signal),
        { input: socket, output: socket },
      ),
    )
  })
  .listen(socketPath)

setInterval(() => {
  if (
    planIdle({
      connections: connections.size,
      quietSince,
      now: Date.now(),
    }) === "exit"
  ) {
    loader.stdin.end()
    process.exit(0)
  }
}, 5_000).unref()
