// S327: the lock protocol on this machine. A holder child prints `held`
// once it holds `file`'s flock and holds it until its stdin ends. Run:
//   node probe.mjs <backend>      backend: perl | flock | swift:<binary>
// Each case prints one line, `case: result`.
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const backend = process.argv[2] ?? "perl"
const dir = mkdtempSync(path.join(tmpdir(), "s327-"))
const file = path.join(dir, "x.lock")

const PERL =
  'open my $h, ">>", $ARGV[1] or die "$!\\n"; flock($h, $ARGV[0] eq "wait" ? LOCK_EX : LOCK_EX|LOCK_NB) or exit 1; $|=1; print "held\\n"; while (<STDIN>) {}'
const command = (mode) => {
  if (backend === "perl")
    return ["/usr/bin/perl", "-MFcntl=:flock", "-e", PERL, mode, file]
  if (backend === "flock")
    return ["flock", ...(mode === "wait" ? [] : ["-n"]), file, "sh", "-c", "echo held; exec cat"]
  const bin = backend.slice("swift:".length)
  return [bin, mode, file]
}

/** A holder started in this process: resolves with what it said first, or its exit. */
function hold(mode = "now", options = {}) {
  const [p, ...a] = command(mode)
  const child = spawn(p, a, { stdio: ["pipe", "pipe", "pipe"], ...options })
  const first = new Promise(resolve => {
    let said = ""
    child.stdout.on("data", d => {
      said += d
      if (said.includes("\n")) resolve(said.trim())
    })
    child.once("close", code => resolve(`exit ${code}`))
  })
  return { child, first }
}

/** A holder in its own Node process, which this process kills. */
function hostHolding() {
  const src = `
    const { spawn } = require("node:child_process")
    const [p, ...a] = ${JSON.stringify(command("now"))}
    const c = spawn(p, a, { stdio: ["pipe", "pipe", "inherit"], detached: process.env.DETACH === "1" })
    c.stdout.on("data", d => process.stdout.write(d))
    setInterval(() => {}, 1e6)`
  return (env = {}) =>
    spawn(process.execPath, ["-e", src], {
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, ...env },
    })
}

const saidHeld = (child) =>
  new Promise(resolve => child.stdout.on("data", d => String(d).includes("held") && resolve()))
const exited = (child) => new Promise(resolve => child.once("close", resolve))

/** Take the lock now, again and again, until it is held: an event, not a pause. */
async function takenAgain() {
  for (let tries = 1; ; tries++) {
    const t = hold()
    const r = await t.first
    if (r === "held") {
      t.child.stdin.end()
      await exited(t.child)
      return tries
    }
  }
}

const out = (name, value) => console.log(`${name}: ${value}`)

// 1. A second taker refused at once, in another process.
{
  const a = hold()
  out("first", await a.first)
  const b = hold()
  out("second while held", await b.first)
  a.child.stdin.end()
  await exited(a.child)
  const c = hold()
  out("after release", await c.first)
  c.child.stdin.end()
  await exited(c.child)
}

// 2. Its host killed with SIGKILL: the child's stdin ends, so it lets go.
for (const detach of ["0", "1"]) {
  const host = hostHolding()({ DETACH: detach })
  await saidHeld(host)
  host.kill("SIGKILL")
  await exited(host)
  out(`host SIGKILLed (detached ${detach}), tries to take it again`, await takenAgain())
}

// 3. SIGINT to the host's process group (a Ctrl-C): the child dies with it
// unless detached, and its host is still alive.
for (const detach of ["0", "1"]) {
  const host = spawn(process.execPath, ["-e", `
    const { spawn } = require("node:child_process")
    process.on("SIGINT", () => {})
    const [p, ...a] = ${JSON.stringify(command("now"))}
    const c = spawn(p, a, { stdio: ["pipe", "pipe", "inherit"], detached: ${detach === "1"} })
    c.stdout.on("data", d => process.stdout.write(d))
    c.once("close", (code, sig) => process.stdout.write("child closed " + code + " " + sig + "\\n"))
    setInterval(() => {}, 1e6)`], { stdio: ["ignore", "pipe", "inherit"], detached: true })
  await saidHeld(host)
  let heard = ""
  host.stdout.on("data", d => { heard += d })
  process.kill(-host.pid, "SIGINT")
  // The group's signal is delivered by the kernel before kill(2) returns to
  // a sleeping process; a free lock is then taken at the first try.
  const t = hold()
  const r = await t.first
  out(`group SIGINT (detached ${detach}), lock then`, r === "held" ? "free" : "still held")
  if (r === "held") { t.child.stdin.end(); await exited(t.child) }
  host.kill("SIGKILL")
  await exited(host)
  out(`group SIGINT (detached ${detach}), host heard`, JSON.stringify(heard.trim()))
}

// 4. Waiting: a waiter says `held` once the holder lets go, not before.
{
  const a = hold()
  await a.first
  const w = hold("wait")
  let early = false
  w.child.stdout.once("data", () => { early = a.child.exitCode === null })
  a.child.stdin.end()
  await exited(a.child)
  out("waiter", `${await w.first}, early ${early}`)
  w.child.stdin.end()
  await exited(w.child)
}

// 5. The lock file removed while held: a new taker locks a new file.
{
  const a = hold()
  await a.first
  spawnSync("rm", [file])
  const b = hold()
  out("file removed while held, second taker", await b.first)
  for (const c of [a, b]) { c.child.stdin.end(); await exited(c.child) }
}

// 6. A pid written into the file once held, read by another.
{
  const a = hold()
  await a.first
  writeFileSync(file, `${a.child.pid}\n`)
  const b = hold()
  out("pid written, second taker", await b.first)
  a.child.stdin.end()
  await exited(a.child)
}

// 7. The cost of one hold and release, a measurement.
{
  const n = 50
  const t0 = process.hrtime.bigint()
  for (let i = 0; i < n; i++) {
    const a = hold()
    await a.first
    a.child.stdin.end()
    await exited(a.child)
  }
  out("ms per hold and release", (Number(process.hrtime.bigint() - t0) / 1e6 / n).toFixed(1))
}
