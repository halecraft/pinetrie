// S299's local forwarder: 127.0.0.1:<port> to <ip>:<dport> through the
// lane's userspace tailscaled SOCKS5 proxy, so a browser on this device
// reaches a mesh peer at a localhost origin.
import net from "node:net"
const [port, ip, dport] = process.argv.slice(2)
net.createServer(client => {
  const s = net.connect(1055, "127.0.0.1", () => {
    s.write(Buffer.from([5, 1, 0]))
    s.once("data", () => {
      const addr = ip.split(".").map(Number)
      const p = Number(dport)
      s.write(Buffer.from([5, 1, 0, 1, ...addr, p >> 8, p & 255]))
      s.once("data", reply => {
        if (reply[1] !== 0) return client.destroy()
        client.pipe(s).pipe(client)
      })
    })
  })
  s.on("error", () => client.destroy())
  client.on("error", () => s.destroy())
}).listen(Number(port), "127.0.0.1", () => console.log(`forwarding 127.0.0.1:${port} -> ${ip}:${dport}`))
