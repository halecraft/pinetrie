// A stand-in for the supervisor (`packages/lanes/image/supervise.c`), for
// tests that need its socket and not its seccomp: as `supervise … <socket>
// <run-id> -- <program> [arg]…`, it says hello on the helper's socket, runs
// the program, and reports its exit. It also leaves a detached process
// holding a connection of its own for 3 s, as a daemon the command started
// keeps its supervisor's.
import { spawn, spawnSync } from "node:child_process"
import net from "node:net"

const args = process.argv.slice(2)
const at = args.indexOf("--")
const [socket, id] = args.slice(at - 2, at)
const [program, ...rest] = args.slice(at + 1)

// The daemon says "held" on its stdout once connected: the command runs
// only then, so the connection is there before the call returns, as the
// supervisor's listener's is.
const daemon = `
  const s = require("node:net").connect(${JSON.stringify(socket)}, () => {
    s.write(${JSON.stringify(`hello\t${id}-daemon\n`)})
    process.stdout.write("held\\n")
  })
  setTimeout(() => {}, 3000)
`
const held = spawn(process.execPath, ["-e", daemon], {
  detached: true,
  stdio: ["ignore", "pipe", "ignore"],
})
held.stdout.once("data", () => {
  held.stdout.destroy()
  held.unref()
  const s = net.connect(socket, () => {
    s.write(`hello\t${id}\n`)
    const ran = spawnSync(program, rest, { stdio: "inherit" })
    const code = ran.status ?? 1
    s.end(`exit\t1\t${code}\n`, () => process.exit(code))
  })
})
