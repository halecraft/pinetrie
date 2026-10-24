// Connections to the spike's observer, opened as a host opens its own
// (`openObserver`: a `docker exec -i` of observer-connect.ts in the role's
// container), each subscribed as a host's client subscribes. The first
// registers the lanes whose container names follow, by their first pid
// (direct). Holds them until killed, or exits once registered with `--leave`
// (the lanes then held, unowned, with their notices).
//   node probe.ts <container> <connections> [--leave] [lane container…]
// Prints each notice count every 5 s.
import { execFileSync } from "node:child_process"
import { openChannel } from "../../../packages/channel/index.ts"

const [container = "", count = "1", ...rest] = process.argv.slice(2)
const leave = rest.includes("--leave")
const lanes = rest.filter(a => a !== "--leave")
const NODE = ["/pinetrie-runtime/node/ld.so", "--library-path", "/pinetrie-runtime/node/lib", "/pinetrie-runtime/node/node"]
const argv = ["docker", "exec", "-i", container, ...NODE, "/pinetrie/packages/lanehost/observer-connect.ts", "/run/observer/observer.sock"]
const pid = (name: string) => Number(execFileSync("docker", ["inspect", "-f", "{{.State.Pid}}", name], { encoding: "utf8" }).trim())

let notices = 0
const channels = []
for (let i = 0; i < Number(count); i++) {
  const c = openChannel<unknown, unknown, unknown, unknown>(argv, `connection ${i}`)
  channels.push(c)
  await c.ready
  c.call({ kind: "subscribe" }, undefined, () => { notices++ }).catch(() => {})
  c.call({ kind: "subscribe-output" }, undefined, () => {}).catch(() => {})
}
console.log(`open ${channels.length}`)
for (const name of lanes) {
  const lane = await channels[0].call({ kind: "register", origin: { kind: "direct", pid: pid(name) }, remote: [] })
  console.log(`registered ${name} ${lane}`)
}
if (leave) {
  for (const c of channels) c.close()
  await Promise.all(channels.map(c => c.closed))
  console.log("left")
  process.exit(0)
}
setInterval(() => console.log(`notices ${notices}`), 5000)
process.on("SIGTERM", () => process.exit(0))
