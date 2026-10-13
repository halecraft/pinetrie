// lanehost/observer-connect — one host's channel to the machine role: the
// runtime's `exec -i` runs this in the role's container, and it joins its
// stdin and stdout to a connection of the role's socket. Ending stdin ends
// the connection, as the channel's close does.
//   <runtime loader> … node observer-connect.ts <socket>

import net from "node:net"

const socket = net.connect(process.argv[2] ?? "")
process.stdin.pipe(socket)
socket.pipe(process.stdout)
socket.on("error", error => {
  console.error(`observer: ${error.message}`)
  process.exit(1)
})
socket.on("close", () => process.exit(0))
