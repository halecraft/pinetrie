// ssh/hop — run in a lane on the lane runtime's Node: `serve` is the lane's
// SSH_AUTH_SOCK, and `connect <name> <port>` its ProxyCommand. Each opens a
// connection to the host's socket and names the lane with its token first.
// It imports only this package and Node's own modules: it runs from
// pine·trie's install, in any image.

import { mkdirSync, rmSync } from "node:fs"
import net from "node:net"
import path from "node:path"
import {
  agentLine,
  connectLine,
  decodeConnectAnswer,
  HOP_LINE_LIMIT,
} from "./hop-line.ts"
import { parseSshName, parseSshPort } from "./names.ts"
import { readLine, socketSide, splice } from "./splice.ts"

/** Where a lane's ssh finds its agent: the hop's `serve`. */
export const HOP_AGENT_SOCKET = "/run/pinetrie-ssh/agent.sock"
/** The variables a lane is given the token and the host's socket in. */
export const TOKEN_ENV = "PINETRIE_SSH_TOKEN"
export const SOCKET_ENV = "PINETRIE_SSH_SOCKET"

const toHost = (socket: string): net.Socket =>
  net.createConnection({ path: socket, allowHalfOpen: true })

/**
 * The lane's agent socket: each connection to it is one to the host's,
 * named by the token. A socket left at `listen` is removed first: a
 * container's `/run` outlives its stop.
 */
export function serve(listen: string, host: string, token: string): net.Server {
  mkdirSync(path.dirname(listen), { recursive: true, mode: 0o700 })
  rmSync(listen, { force: true })
  const server = net.createServer({ allowHalfOpen: true }, lane => {
    const up = toHost(host)
    up.write(agentLine(token))
    splice(socketSide(lane), socketSide(up))
  })
  return server.listen(listen)
}

/**
 * A ProxyCommand: one connection through the host to `name`, joined to stdin
 * and stdout. The host answers before any of its bytes; a refusal is said on
 * stderr, as ssh shows a ProxyCommand's, and the exit is 255, as ssh's own.
 */
export async function connect(
  host: string,
  token: string,
  nameText: string,
  portText: string,
): Promise<number> {
  const name = parseSshName(nameText)
  const port = parseSshPort(portText)
  if (name === null || port === null) {
    process.stderr.write(`pinetrie: cannot connect ${nameText} ${portText}\n`)
    return 255
  }
  const up = toHost(host)
  up.on("error", () => {})
  up.write(connectLine(token, name, port))
  const first = await readLine(up, HOP_LINE_LIMIT)
  const answer = first === null ? null : decodeConnectAnswer(first.line)
  if (first === null || answer === null || answer.kind === "refused") {
    process.stderr.write(
      `pinetrie: the host did not connect ${name}: ${answer?.kind === "refused" ? answer.why : "no answer"}\n`,
    )
    up.destroy()
    return 255
  }
  if (first.rest.length > 0) process.stdout.write(first.rest)
  return new Promise(resolve => {
    // The host's end is the connection's end: once the host has said all it
    // will, by the remote's close or a revoke's cut, the hop is done, whatever
    // is left of its input. ssh never half-closes a session.
    const done = () => process.stdout.write("", () => resolve(0))
    up.once("end", done)
    up.once("close", done)
    splice(
      {
        readable: process.stdin,
        writable: process.stdout,
        destroy: () => process.stdin.destroy(),
      },
      socketSide(up),
    )
  })
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2)
  const token = process.env[TOKEN_ENV] ?? ""
  const host = process.env[SOCKET_ENV] ?? ""
  if (command === "serve") serve(HOP_AGENT_SOCKET, host, token)
  else if (command === "connect" && args.length === 2)
    // Exits once the host's side closes, whatever is left of stdin.
    process.exit(await connect(host, token, args[0] ?? "", args[1] ?? ""))
  else {
    process.stderr.write("usage: hop.ts serve | hop.ts connect <name> <port>\n")
    process.exitCode = 2
  }
}
