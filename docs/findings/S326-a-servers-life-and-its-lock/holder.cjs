// S326's stand-in server: holds `flock -n <file>` through a child, its stdin a
// pipe from here, and logs what it hears.
//   node holder.cjs <file> <keep|end-child>
// keep: nothing is done when this process's stdin ends (the plan as written).
// end-child: the child's stdin is ended when this process's stdin ends.
const { spawn } = require("node:child_process")
const [file, mode = "keep"] = process.argv.slice(2)
const c = spawn("flock", ["-n", file, "sh", "-c", "echo held; exec cat"], {
  stdio: ["pipe", "pipe", "inherit"],
})
c.stdout.on("data", d => console.log(`child says ${String(d).trim()}`))
c.on("exit", (code, signal) => console.log(`child exit ${code} ${signal}`))
process.stdin.on("end", () => {
  console.log("stdin ended")
  if (mode === "end-child") c.stdin.end()
})
process.stdin.resume()
process.on("exit", () => console.log("holder exits"))
console.log(`holder pid ${process.pid}, child pid ${c.pid}`)
