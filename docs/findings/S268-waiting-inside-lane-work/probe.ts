// S268's probe: S265's, with the wait inside lane work (wait.patch applied),
// over a jj project and then a folder project. It ran as
// apps/pinetrie/e2e/s268-probe.ts, with S265_DROP_OBSERVER=unix://<the lane
// VM's docker.sock>. Disposable.
import { ROOT } from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import {
  committedProject,
  idleNow,
  join,
  START_AGENT,
  setUpAccepted,
  waitFor,
} from "./harness.ts"
import { cleanUp, laneHosts } from "./lane-hosts.ts"

const t0 = performance.now()
const at = () => ((performance.now() - t0) / 1000).toFixed(1).padStart(6)

let project = await committedProject("pinetrie-s265-", {
  "a.txt": "a\n",
  ".gitignore": "node_modules/\n.vite/\n",
  "pinetrie.json": `${JSON.stringify({ lanes: { ssh: { personal: true } } })}\n`,
})

async function once(label: string, keep: boolean): Promise<void> {
  const logs: string[] = []
  const script = scriptedModel()
  const began = performance.now()
  console.log(`${at()} == ${label}: startHost`)
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("no return in 15 min")), 15 * 60_000).unref(),
  )
  const host = await Promise.race([
    laneHosts.startHost({
      model: { kind: "scripted", script },
      project: { dir: project, tools: true },
      log: m => {
        logs.push(m)
        if (!m.startsWith("[lanehost]")) console.log(`${at()} ${m}`)
      },
    }),
    timeout,
  ])
  const startSecs = (performance.now() - began) / 1000
  console.log(
    `${at()} == ${label}: startHost returned after ${startSecs.toFixed(1)} s; ready logged before: ${logs.includes("[host] lanes of their own are ready")}`,
  )
  const user = await join(host, "uma", "s265")
  if (label === "fresh project") await setUpAccepted(host.session, user)
  const before = logs.length
  script.use([
    { tool: "bash", args: { command: "echo hi > hi.txt && cat hi.txt" } },
    { text: "done" },
  ])
  const sent = performance.now()
  await user.send(`@agent ${label}`, ROOT, START_AGENT)
  await waitFor(() => idleNow(host), 600_000)
  await host.quiet()
  console.log(
    `${at()} == ${label}: first turn idle after ${((performance.now() - sent) / 1000).toFixed(1)} s; lines meanwhile: ${JSON.stringify(logs.slice(before).filter(l => !l.startsWith("[lanehost]")))}`,
  )
  await user.close().catch(() => {})
  await host.shutdown()
  if (!keep) await cleanUp(host.session, project)
}

await once("fresh project", true)
// Accepted work moves while no host runs: the restart's preparation remakes
// the base snapshot, through a scratch lane, which opens the observer.
const { command } = await import("./command.ts")
const jj = (...args: string[]) =>
  command("jj", ["--no-pager", ...args], { cwd: project })
await jj("new", "pinetrie-accepted", "-m", "moved while down")
const { writeFileSync } = await import("node:fs")
writeFileSync(`${project}/b.txt`, "b\n")
await jj("bookmark", "set", "pinetrie-accepted", "-r", "@")
await jj("new")
if (process.env.S265_DROP_OBSERVER !== undefined) {
  const d = (...a: string[]) => command("docker", ["-H", process.env.S265_DROP_OBSERVER ?? "", ...a])
  const ids = (await d("ps", "-aq", "--filter", "name=pinetrie-observer")).trim().split("\n").filter(Boolean)
  if (ids.length > 0) await d("rm", "-f", ...ids)
  const tags = (await d("images", "--format", "{{.Repository}}:{{.Tag}}", "pinetrie-observer")).trim().split("\n").filter(Boolean)
  if (tags.length > 0) await d("rmi", ...tags)
  console.log(`${at()} dropped observer containers ${ids.length} and images ${tags.join(" ")}`)
}
await once("restart, accepted work moved", true)
await once("restart, nothing changed", false)

// A folder project: its accepted work is the folder, so its first start's
// preparation makes the base snapshot, through lanehost.
const { mkdtempSync, chmodSync, realpathSync } = await import("node:fs")
const { tmpdir } = await import("node:os")
project = realpathSync(mkdtempSync(`${tmpdir()}/pinetrie-s268-folder-`))
chmodSync(project, 0o755)
writeFileSync(`${project}/a.txt`, "a\n")
await once("folder project, fresh", true)
await once("folder project, restart", false)
process.exit(0)
