#!/usr/bin/env node
// A stand-in for the observer's loader (`observer/observe.c`), for the
// machine role's server test: it answers each command as the loader does,
// from a fixed table of processes. The machine's namespace is 1. Lane 40's
// first process is 4; inside it, lane 50's is 5, pid 7 in lane 40; lane 45,
// a sibling of 40, holds process 6, pid 7 in it too; process 3 is in the
// machine's own namespace. Lane 40's run 1, and lane 50's run 2, exit
// before the lane's first install, as a run left by its last host would.
// Every attribution hook attaches, and lane 40's run 1 wrote 5 bytes of
// statement 1's stdout, sent with the first flush after its install.
import readline from "node:readline"

const PROCESSES = [
  { pid: 3, nspid: [3], namespaces: ["1"] },
  { pid: 4, nspid: [4, 1], namespaces: ["40", "1"] },
  { pid: 5, nspid: [5, 7, 1], namespaces: ["50", "40", "1"] },
  { pid: 6, nspid: [6, 7], namespaces: ["45", "1"] },
]
const HOOKS = [
  "security_task_prctl",
  "anon_pipe_write",
  "copy_page_from_iter",
  "pipe_unlock",
  "pipe_wait_writable",
  "free_pipe_info",
]
const held = new Map()
const installed = new Set()
let wrote = false

const offer = (token, p) => {
  held.set(`${token}/${p.pid}`, p)
  console.log(
    `candidate\t${token}\t${p.pid}\t${p.nspid.join(",")}\t${p.namespaces.join(",")}`,
  )
}

for (const hook of HOOKS) console.log(`hook\t${hook}\tattached`)
console.log("ready")
readline.createInterface({ input: process.stdin }).on("line", line => {
  const [word, a = "", b = "", c = ""] = line.split("\t")
  if (word === "open") {
    for (const p of PROCESSES) if (String(p.pid) === b) offer(a, p)
    console.log(`looked\t${a}\tcomplete`)
  } else if (word === "find") {
    for (const p of PROCESSES) if (String(p.nspid[Number(b)]) === c) offer(a, p)
    console.log(`looked\t${a}\tcomplete`)
  } else if (word === "install") {
    const p = held.get(`${a}/${b}`)
    for (const k of [...held.keys()]) if (k.startsWith(`${a}/`)) held.delete(k)
    if (p === undefined) return console.log(`refused\t${a}\tno such candidate`)
    const lane = p.namespaces[0]
    // Before the answer, so the server holds it until the lane is its host's.
    const run = { 40: "1", 50: "2" }[lane]
    if (run !== undefined && !installed.has(lane))
      console.log(`ev\t${lane}\t${run}\t-\texit\t1\t0`)
    installed.add(lane)
    console.log(`registered\t${a}\t${lane}`)
  } else if (word === "drop") {
    for (const k of [...held.keys()]) if (k.startsWith(`${a}/`)) held.delete(k)
  } else if (word === "unregister") console.log(`unregistered\t${a}`)
  else if (word === "flush") {
    if (installed.has("40") && !wrote) {
      wrote = true
      console.log("out\t40\t1\toutput\t1\t1\t5")
    }
    console.log(`flushed\t${a}`)
  }
})
