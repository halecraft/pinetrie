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
  type Candidate,
  type ConnectionId,
  decodeLoaderLine,
  encodeLoaderCommand,
  HELD_PER_LANE,
  heldNotices,
  type LaneNamespace,
  type LoaderCommand,
  type ObserverCall,
  type ObserverHello,
  type ObserverNotice,
  type ObserverOutput,
  type ObserverUpdate,
  observerNotice,
  planAttribution,
  planHeld,
  planIdle,
  planLookup,
  planRegister,
  planUnregister,
  type Registration,
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
/** The loader's attribution hooks, as it reported them before `ready`. */
const hooks: { readonly name: string; readonly attached: boolean }[] = []
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
  /** Its output subscription's. */
  output: ((n: ObserverOutput) => void) | null
}
const connections = new Map<ConnectionId, Connection>()
/** Every lane the loader holds registered, pinned, owned or not. */
const registrations = new Map<LaneNamespace, Registration>()
const held = new Map<
  LaneNamespace,
  { notices: ObserverNotice[]; lost: Map<string, number> }
>()
interface Lookup {
  readonly candidates: Candidate[]
  readonly done: (cut: boolean) => void
}
const lookups = new Map<string, Lookup>()
const installing = new Map<
  string,
  (answer: { lane: LaneNamespace } | { why: string }) => void
>()
const unregistering = new Map<LaneNamespace, (() => void)[]>()
const flushing = new Map<string, () => void>()
let nextToken = 0
let quietSince = Date.now()

const subscribed = () =>
  new Set([...connections].flatMap(([id, c]) => (c.update ? [id] : [])))
const subscribedOutput = () =>
  new Set([...connections].flatMap(([id, c]) => (c.output ? [id] : [])))
const monotonicUs = () => Number(process.hrtime.bigint() / 1000n)

function route(notice: ObserverNotice) {
  const r = routeEvent(registrations, subscribed(), notice)
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

/**
 * Output goes only to its lane's owner, as it subscribed: none is held for
 * a host gone, whose calls in flight went with it.
 */
function routeOutput(output: ObserverOutput) {
  const r = routeEvent(registrations, subscribedOutput(), output)
  if (r.kind === "send") connections.get(r.to)?.output?.(output)
}

/** A lane's held notices, to the connection that now owns it, once it has subscribed. */
function release(lane: LaneNamespace) {
  const h = held.get(lane)
  const to = registrations.get(lane)?.owner
  const update = to == null ? null : connections.get(to)?.update
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
    case "hook":
      hooks.push({ name: line.name, attached: line.attached })
      return
    case "ready":
      readyHook()
      return
    case "event":
      route(observerNotice(line))
      return
    case "output":
      routeOutput({ lane: line.lane, run: line.run, output: line.output })
      return
    case "refusals":
    case "stats-done":
      return
    case "candidate": {
      const { kind: _, token, ...candidate } = line
      lookups.get(token)?.candidates.push(candidate)
      return
    }
    case "looked":
      lookups.get(line.token)?.done(line.cut)
      lookups.delete(line.token)
      return
    case "registered":
      installing.get(line.token)?.({ lane: line.lane })
      installing.delete(line.token)
      return
    case "refused":
      installing.get(line.token)?.({ why: line.why })
      installing.delete(line.token)
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

/**
 * One registration at a time: each is planned against the registrations
 * as the one before left them, so two cannot both install one namespace.
 */
let registering: Promise<unknown> = Promise.resolve()

async function register(
  id: ConnectionId,
  call: Extract<ObserverCall, { kind: "register" }>,
): Promise<LaneNamespace> {
  const token = String(nextToken++)
  const lookup = planLookup(call.origin, registrations, token)
  if (lookup.kind === "refuse") throw new Error(lookup.why)
  const candidates: Candidate[] = []
  const cut = await new Promise<boolean>(done => {
    lookups.set(token, { candidates, done })
    send(lookup)
  })
  const plan = planRegister({
    origin: call.origin,
    candidates,
    cut,
    registrations,
    connection: id,
  })
  if (plan.kind === "refuse") {
    send({ kind: "drop", token })
    throw new Error(plan.why)
  }
  const got = await new Promise<{ lane: LaneNamespace } | { why: string }>(
    resolve => {
      installing.set(token, resolve)
      send({ kind: "install", token, pid: plan.pid, remote: call.remote })
    },
  )
  if ("why" in got) throw new Error(got.why)
  // The connection closed while the loader installed it: pinned, unowned.
  const owner = connections.has(id) ? id : null
  registrations.set(got.lane, { ...plan.registration, owner })
  release(got.lane)
  return got.lane
}

async function answer(
  id: ConnectionId,
  call: ObserverCall,
  update: ((n: ObserverUpdate) => void) | undefined,
  signal: AbortSignal,
): Promise<unknown> {
  const loaded = await started
  if (loaded.kind === "failed") throw new Error(loaded.why)
  const conn = connections.get(id)
  if (conn === undefined) throw new Error("the connection has closed")
  switch (call.kind) {
    case "register": {
      const next = registering.then(() => register(id, call))
      registering = next.catch(() => {})
      return next
    }
    case "unregister": {
      const plan = planUnregister(registrations.get(call.lane), id)
      if (typeof plan !== "string") throw new Error(plan.why)
      if (plan === "gone") return null
      await new Promise<void>(resolve => {
        queued(unregistering, call.lane, resolve)
        send(call)
      })
      // Its owner gets its notices until the loader has let it go.
      registrations.delete(call.lane)
      held.delete(call.lane)
      return null
    }
    case "subscribe": {
      if (update === undefined) throw new Error("subscribe asks for updates")
      conn.update = update
      for (const [lane, r] of registrations) if (r.owner === id) release(lane)
      await new Promise<void>(resolve =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      )
      conn.update = null
      return null
    }
    case "subscribe-output": {
      if (update === undefined)
        throw new Error("subscribe-output asks for updates")
      conn.output = update
      await new Promise<void>(resolve =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      )
      conn.output = null
      return null
    }
    case "flush": {
      const token = String(nextToken++)
      await new Promise<void>(resolve => {
        flushing.set(token, resolve)
        send({ kind: "flush", token })
      })
      return null
    }
  }
}

/**
 * A connection gone: its lanes stay registered and pinned, their notices
 * held, until a connection reclaims them (a host restarting), one
 * unregisters them, or the role exits.
 */
function disconnect(id: ConnectionId) {
  if (!connections.delete(id)) return
  for (const [lane, r] of registrations)
    if (r.owner === id) registrations.set(lane, { ...r, owner: null })
  if (connections.size === 0) quietSince = Date.now()
}

mkdirSync(path.dirname(socketPath), { recursive: true })
rmSync(socketPath, { force: true })
let nextConnection = 0
net
  .createServer(socket => {
    const id = nextConnection++
    connections.set(id, { update: null, output: null })
    // At the end of its input, before the host sees its side close: a host
    // that opens a new connection once the old one closed reclaims its lanes.
    socket.on("end", () => disconnect(id))
    socket.on("close", () => disconnect(id))
    socket.on("error", () => {})
    void started.then(loaded =>
      serve<ObserverHello, ObserverCall, ObserverUpdate, unknown>(
        { version, loader: loaded, attribution: planAttribution(hooks) },
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
