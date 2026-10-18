// ssh/host — the host's socket for every lane's hop: the agent relay and
// the broker. It knows lanes only as the strings their tokens carry, and
// asks the app one question, whether a lane may sign with the person's
// identity; everything else it decides with `relayStep` and `brokerTarget`.

import { chmod, rm } from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import {
  type AgentKey,
  blobText,
  decodeAgentRequest,
  decodeIdentities,
  encodeBind,
  encodeSign,
  FAILURE,
  frame,
  LIST_REQUEST,
  listReply,
  SUCCESS,
  takeFrame,
} from "./agent.ts"
import {
  type ConnectRefusal,
  connectAnswer,
  decodeHopLine,
  HOP_LINE_LIMIT,
  type HopLine,
} from "./hop-line.ts"
import type { UsableServiceKey } from "./keys.ts"
import type { HostKeyFacts } from "./lane-files.ts"
import { type Run, runProgram } from "./programs.ts"
import {
  NEW_CONNECTION,
  type OutsideRefusal,
  relayStep,
  withBinding,
} from "./relay-step.ts"
import {
  brokerTarget,
  type CombinedConfig,
  parseResolved,
  resolveArgv,
} from "./resolve.ts"
import { readLine, socketSide, splice } from "./splice.ts"

/** The host's socket in its directory: named before it listens, for the Mac's lease. */
export const hostSocketIn = (dir: string): string =>
  path.join(dir, "relay.sock")

export interface SshHostOptions {
  /** A directory of the host's own; socket paths are limited to 104 bytes on macOS. */
  readonly dir: string
  readonly secret: Uint8Array
  /** The person's agent; null when lanes hold no personal identity. */
  readonly personalAgent: string | null
  /** The host's own `ssh-agent` (`startServiceAgent`); null without one. */
  readonly serviceAgent: string | null
  /** The service keys it holds, named by their files. */
  readonly serviceKeys: readonly UsableServiceKey[]
  readonly hostKeys: HostKeyFacts
  /** The file of `Include`s the broker resolves with; null with no broker. */
  readonly combinedConfig: CombinedConfig | null
  readonly run?: Run
  /**
   * May `lane` sign with the person's identity, for `host`? Answered at
   * once: a signature waits for nobody, since sshd ends a login at its
   * `LoginGraceTime` whatever the relay holds.
   */
  readonly mayUsePersonal: (lane: string, host: string | null) => boolean
  /** A service identity signed, or the broker connected a name, for `lane`. */
  readonly used: (lane: string, use: SshUse) => void
  /** A personal signature for `lane` refused, unasked: its host is not allowed. */
  readonly outside: (lane: string, refusal: OutsideRefusal) => void
}

export type SshUse =
  | { readonly kind: "service"; readonly name: string }
  | { readonly kind: "host"; readonly name: string }

export interface SshHost {
  readonly socket: string
  /** Closes every agent and broker connection `lane` holds, now. */
  cut(lane: string): void
  close(): Promise<void>
}

/** A connection to an agent, one request at a time, as the protocol is. */
interface AgentClient {
  request(body: Uint8Array): Promise<Uint8Array | null>
  close(): void
}

function agentClient(socketPath: string): AgentClient {
  const socket = net.createConnection(socketPath)
  const waiting: ((reply: Uint8Array | null) => void)[] = []
  let buffer: Uint8Array = Buffer.alloc(0)
  let dead = false
  const fail = () => {
    dead = true
    for (const w of waiting.splice(0)) w(null)
  }
  socket.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      const taken = takeFrame(buffer)
      if (taken === null) return
      if (taken === "too-long") {
        socket.destroy()
        return
      }
      buffer = taken.rest
      waiting.shift()?.(taken.body)
    }
  })
  socket.on("error", fail)
  socket.on("close", fail)
  return {
    request: body =>
      dead
        ? Promise.resolve(null)
        : new Promise(resolve => {
            waiting.push(resolve)
            socket.write(frame(body))
          }),
    close: () => socket.destroy(),
  }
}

const keysOf = async (
  client: AgentClient | null,
): Promise<readonly AgentKey[]> => {
  const reply = client === null ? null : await client.request(LIST_REQUEST)
  return (reply === null ? null : decodeIdentities(reply)) ?? []
}

const isSuccess = (reply: Uint8Array | null): boolean =>
  reply !== null && reply.length === 1 && reply[0] === SUCCESS[0]

/**
 * The host's socket. Each connection's first line names its lane through a
 * token the secret checks; anything else is closed. An `agent` connection
 * is relayed request by request; a `connect` is resolved with the host's
 * config and joined to a connection the host opens.
 */
export async function startSshHost(options: SshHostOptions): Promise<SshHost> {
  const run = options.run ?? runProgram
  const socketPath = hostSocketIn(options.dir)
  await rm(socketPath, { force: true })
  const held = new Map<string, Set<net.Socket>>()
  const newest = new Map<string, string>()
  const serviceNames = new Map(options.serviceKeys.map(k => [k.blob, k.name]))

  const hold = (lane: string, socket: net.Socket) => {
    const sockets = held.get(lane) ?? new Set()
    held.set(lane, sockets.add(socket))
    socket.once("close", () => sockets.delete(socket))
  }

  const serveAgent = (socket: net.Socket, lane: string, rest: Uint8Array) => {
    const personal =
      options.personalAgent === null ? null : agentClient(options.personalAgent)
    const service =
      options.serviceAgent === null ? null : agentClient(options.serviceAgent)
    socket.once("close", () => {
      personal?.close()
      service?.close()
    })
    let state = NEW_CONNECTION
    const handle = async (body: Uint8Array): Promise<Uint8Array> => {
      const request = decodeAgentRequest(body)
      const lists = request.kind === "list" || request.kind === "sign"
      const [serviceKeys, personalKeys] = lists
        ? await Promise.all([keysOf(service), keysOf(personal)])
        : [[], []]
      const step = relayStep(state, request, {
        service: new Set(serviceKeys.map(k => blobText(k.blob))),
        personal:
          personal === null
            ? null
            : new Set(personalKeys.map(k => blobText(k.blob))),
        hostKeys: options.hostKeys,
        newestName: newest.get(lane) ?? null,
      })
      switch (step.kind) {
        case "refuse":
          return FAILURE
        case "outside":
          options.outside(lane, step.refusal)
          return FAILURE
        case "list": {
          const seen = new Set<string>()
          return listReply(
            [...serviceKeys, ...personalKeys].filter(k => {
              const text = blobText(k.blob)
              return !seen.has(text) && seen.add(text)
            }),
          )
        }
        case "sign": {
          const agent = step.with === "service" ? service : personal
          const reply = (await agent?.request(encodeSign(step.request))) ?? null
          const name = serviceNames.get(blobText(step.request.key))
          if (step.with === "service" && reply !== null && name !== undefined)
            options.used(lane, { kind: "service", name })
          return reply ?? FAILURE
        }
        case "ask": {
          const may = options.mayUsePersonal(lane, step.host)
          return may
            ? ((await personal?.request(encodeSign(step.request))) ?? FAILURE)
            : FAILURE
        }
        case "verify": {
          // Remembered only once an OpenSSH agent has checked that the host
          // key signed the session id: a lane cannot claim a host it did not
          // reach.
          const checked = await service?.request(encodeBind(step.request))
          if (!isSuccess(checked ?? null)) return FAILURE
          state = withBinding(state, step.request)
          // The person's agent applies its own destination constraints.
          await personal?.request(encodeBind(step.request))
          return SUCCESS
        }
        default: {
          const exhaustive: never = step
          return exhaustive
        }
      }
    }
    let buffer: Uint8Array = Buffer.from(rest)
    let chain: Promise<void> = Promise.resolve()
    const take = () => {
      for (;;) {
        const taken = takeFrame(buffer)
        if (taken === null) return
        if (taken === "too-long") {
          socket.destroy()
          return
        }
        buffer = taken.rest
        const body = taken.body
        chain = chain.then(async () => {
          const reply = await handle(body).catch(() => FAILURE)
          if (!socket.destroyed) socket.write(frame(reply))
        })
      }
    }
    socket.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk])
      take()
    })
    // The socket allows half-open, so its side is ended here, once the
    // replies to what the lane sent before its end have gone.
    socket.once("end", () => {
      chain = chain.then(() => {
        socket.end()
      })
    })
    socket.resume()
    take()
  }

  const serveConnect = async (
    socket: net.Socket,
    line: Extract<HopLine, { kind: "connect" }>,
    rest: Uint8Array,
  ) => {
    const refuse = (why: ConnectRefusal) => socket.end(connectAnswer(why))
    if (options.combinedConfig === null) return refuse("no-broker")
    const ran = await run(
      resolveArgv(options.combinedConfig, line.name, line.port),
    )
    const target = brokerTarget(
      ran.code === 0 ? parseResolved(ran.stdout) : null,
    )
    if (target.kind === "refused") return refuse(target.why)
    const remote = net.createConnection({
      host: target.host,
      port: target.port,
      allowHalfOpen: true,
    })
    remote.once("error", () => {
      if (!socket.destroyed) refuse("unreachable")
    })
    remote.once("connect", () => {
      remote.removeAllListeners("error")
      hold(line.lane, remote)
      newest.set(line.lane, line.name)
      options.used(line.lane, { kind: "host", name: line.name })
      socket.write(connectAnswer(null))
      splice(socketSide(socket), socketSide(remote), rest)
    })
  }

  const server = net.createServer({ allowHalfOpen: true }, async socket => {
    socket.on("error", () => socket.destroy())
    const first = await readLine(socket, HOP_LINE_LIMIT)
    const line =
      first === null ? null : decodeHopLine(first.line, options.secret)
    if (first === null || line === null) {
      socket.destroy()
      return
    }
    hold(line.lane, socket)
    if (line.kind === "agent") serveAgent(socket, line.lane, first.rest)
    else await serveConnect(socket, line, first.rest)
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(socketPath, () => resolve())
  })
  // The token admits a connection, not the mode: a nested lane's rootless
  // Docker mounts this socket as another user.
  await chmod(socketPath, 0o777)

  return {
    socket: socketPath,
    cut(lane) {
      for (const socket of held.get(lane) ?? []) socket.destroy()
      held.delete(lane)
    },
    async close() {
      for (const sockets of held.values()) for (const s of sockets) s.destroy()
      held.clear()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
