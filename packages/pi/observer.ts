// pi/observer — the observer's side of a lane's helper: how a tool call is
// launched so that the machine's observer sees it begin as a run, and the
// relay that serves the observer to a host inside the lane. A run's events
// reach the host from the observer itself (`@pinetrie/lanehost`'s machine
// role), never through the helper: only the inner host's own calls and
// notices cross it, and the outer host decides what they may do.

import { mkdirSync, rmSync } from "node:fs"
import net from "node:net"
import path from "node:path"
import { serve } from "@pinetrie/channel"
import type { ObserverRelay } from "@pinetrie/core"
import type { LaneChannel } from "./lane-env.ts"
import type { RelayReply, RelayRequest } from "./lane-protocol.ts"

/**
 * The variable a run's first process execs with: its number, in decimal.
 * An untagged process in a registered lane's PID namespace that execs with
 * it begins the run, and everything it starts is the run's.
 */
export const RUN_ENV = "PINETRIE_RUN"

/**
 * pi `exec`'s options for run `run`: pi spawns the command's shell with
 * `{ ...process.env, ...shellEnv, ...options.env }`, so the variable is
 * the run's whatever the caller gave. pi's `exec` serves `grep`, `find`
 * and the file tools; a `bash` call's `shell` sets the variable itself.
 */
export const launchOptions = (
  run: string,
  options: object | undefined,
): object => {
  const given = options as { readonly env?: Record<string, string> } | undefined
  return { ...options, env: { ...given?.env, [RUN_ENV]: run } }
}

interface Waiting {
  readonly update: ((update: unknown) => void) | undefined
  readonly resolve: (result: unknown) => void
  readonly reject: (error: Error) => void
}

/**
 * The helper's half of the relay: `socket` served, each connection's
 * hello and calls asked of the host (`request`), until `signal` aborts.
 * The socket exists only while a host relays, so a host inside the lane
 * finds it only when it can be observed. Its result takes the host's
 * answers.
 */
export function serveRelay(input: {
  readonly socket: string
  readonly request: (request: RelayRequest) => void
  readonly signal: AbortSignal
}): (reply: RelayReply) => void {
  const { request } = input
  const connections = new Map<
    number,
    {
      readonly hello: (hello: unknown) => void
      readonly calls: Map<number, Waiting>
    }
  >()
  const sockets = new Set<net.Socket>()
  let nextConnection = 0
  let nextCall = 0
  mkdirSync(path.dirname(input.socket), { recursive: true })
  rmSync(input.socket, { force: true })
  const server = net.createServer(socket => {
    const connection = nextConnection++
    const calls = new Map<number, Waiting>()
    sockets.add(socket)
    socket.on("error", () => {})
    socket.on("close", () => {
      sockets.delete(socket)
      connections.delete(connection)
      for (const c of calls.values())
        c.reject(new Error("the connection has closed"))
      request({ connection, closed: true })
    })
    const helloed = new Promise<unknown>(hello =>
      connections.set(connection, { hello, calls }),
    )
    request({ connection, open: true })
    void helloed.then(hello =>
      serve<unknown, unknown, unknown, unknown>(
        hello,
        (body, context) =>
          new Promise((resolve, reject) => {
            const call = nextCall++
            calls.set(call, { update: context.update, resolve, reject })
            request({ connection, call, body })
            context.signal.addEventListener(
              "abort",
              () => {
                if (calls.has(call)) request({ connection, abort: call })
              },
              { once: true },
            )
          }),
        { input: socket, output: socket },
      ),
    )
  })
  server.listen(input.socket)
  input.signal.addEventListener(
    "abort",
    () => {
      server.close()
      for (const s of sockets) s.destroy()
    },
    { once: true },
  )
  return reply => {
    const c = connections.get(reply.connection)
    if (c === undefined) return
    if ("hello" in reply) return c.hello(reply.hello)
    const waiting = c.calls.get(reply.call)
    if (waiting === undefined) return
    if ("update" in reply) return waiting.update?.(reply.update)
    c.calls.delete(reply.call)
    if ("result" in reply) waiting.resolve(reply.result)
    else waiting.reject(new Error(reply.thrown))
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * The host's half of the relay, over a lane's channel: each connection the
 * helper asks for is a relay of the lane's observation, which says what
 * its calls may do. Stopped by the result, or when the channel closes.
 */
export function relayObserver(
  channel: Pick<LaneChannel, "observerRelay" | "observerReply">,
  relay: () => Promise<ObserverRelay>,
): () => void {
  const control = new AbortController()
  const relays = new Map<number, Promise<ObserverRelay>>()
  const calls = new Map<string, AbortController>()
  const reply = (r: RelayReply) => void channel.observerReply(r).catch(() => {})
  const closeRelay = (connection: number) => {
    void relays
      .get(connection)
      ?.then(r => r.close())
      .catch(() => {})
    relays.delete(connection)
    for (const [key, c] of calls)
      if (key.startsWith(`${connection}/`)) c.abort()
  }
  function handle(r: RelayRequest) {
    const { connection } = r
    if ("open" in r) {
      const opening = relay()
      relays.set(connection, opening)
      opening.then(
        o => reply({ connection, hello: o.hello }),
        () => closeRelay(connection),
      )
      return
    }
    if ("closed" in r) return closeRelay(connection)
    if ("abort" in r) return calls.get(`${connection}/${r.abort}`)?.abort()
    const { call } = r
    const key = `${connection}/${call}`
    const abort = new AbortController()
    calls.set(key, abort)
    const opened = relays.get(connection)
    if (opened === undefined)
      return reply({ connection, call, thrown: "the connection has closed" })
    opened
      .then(o =>
        o.call(r.body, abort.signal, update =>
          reply({ connection, call, update }),
        ),
      )
      .then(
        result => reply({ connection, call, result }),
        error => reply({ connection, call, thrown: messageOf(error) }),
      )
      .finally(() => calls.delete(key))
  }
  const stop = () => {
    control.abort()
    for (const connection of [...relays.keys()]) closeRelay(connection)
  }
  channel.observerRelay(control.signal, handle).then(stop, stop)
  return stop
}
