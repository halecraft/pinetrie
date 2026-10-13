#!/usr/bin/env node
// A stand-in for the observer's loader (`observer/observe.c`), for the
// machine role's server test: it answers each command as the loader does, and
// a registered lane's run 1 exits, as a run left by the lane's last host
// would, before the answer.
import readline from "node:readline"

console.log("ready")
readline.createInterface({ input: process.stdin }).on("line", line => {
  const [word, arg = ""] = line.split("\t")
  if (word === "register") {
    const pid = Number(arg)
    if (pid <= 0) return console.log(`refused\t${arg}\tnot a process id`)
    // Before the answer, so the server holds it until the lane is its host's.
    console.log(`ev\t${pid * 10}\t1\t-\texit\t1\t0`)
    console.log(`registered\t${pid}\t${pid * 10}`)
  } else if (word === "unregister") console.log(`unregistered\t${arg}`)
  else if (word === "flush") console.log(`flushed\t${arg}`)
})
