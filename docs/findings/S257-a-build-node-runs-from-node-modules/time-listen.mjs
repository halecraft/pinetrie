// Spawn a host, time until it prints its "listening" line, then kill it.
import { spawn } from "node:child_process"
const [cwd, entry, folder, runs = "5"] = process.argv.slice(2)
const out = []
for (let i = 0; i < Number(runs); i++) {
  const t0 = performance.now()
  const ms = await new Promise((resolve, reject) => {
    const c = spawn("node", [entry, folder], { cwd, env: { ...process.env, NODE_ENV: "production", PINETRIE_PORT: "0" } })
    let buf = ""
    const on = d => {
      buf += d
      if (/listening/.test(buf)) { const t = performance.now() - t0; c.kill("SIGKILL"); resolve(t) }
    }
    c.stdout.on("data", on); c.stderr.on("data", on)
    c.on("exit", () => reject(new Error(buf.slice(-800))))
  }).catch(e => { console.error(e.message); return NaN })
  out.push(Math.round(ms))
  await new Promise(r => setTimeout(r, 500))
}
console.log(entry, JSON.stringify(out))
