// lanehost/observer-connect — one host's channel to the machine role: the
// runtime's `exec -i` runs this in the role's container (or a host inside a
// lane runs it against its helper's socket), and it joins its stdin and
// stdout to a connection of the socket. Ending stdin ends the connection,
// as the channel's close does.
//   <runtime loader> … node observer-connect.ts <socket>

import net from "node:net"

/**
 * How long a socket not there yet is waited for: a role's container just
 * made makes its socket once Node has started, some hundreds of ms after
 * `docker run` returns.
 */
const WAIT_MS = 15_000

const socketPath = process.argv[2] ?? ""
const since = Date.now()

function connect() {
  const socket = net.connect(socketPath)
  let connected = false
  socket.once("connect", () => {
    connected = true
    process.stdin.pipe(socket)
    socket.pipe(process.stdout)
    socket.on("close", () => process.exit(0))
  })
  socket.on("error", (error: NodeJS.ErrnoException) => {
    const missing = error.code === "ENOENT" || error.code === "ECONNREFUSED"
    if (!connected && missing && Date.now() - since < WAIT_MS) {
      setTimeout(connect, 100)
      return
    }
    console.error(`observer: ${error.message}`)
    process.exit(1)
  })
}

connect()
