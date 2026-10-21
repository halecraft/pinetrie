# Applied to packages/lanes/run.ts for one run, then reverted: with STACKLOG
# set, each process's command and the source frames that started it go to
# that file as one JSON line. attribute.py reads it.
p = "packages/lanes/run.ts"; s = open(p).read()
s = s.replace('import { execFile } from "node:child_process"\n',
  'import { execFile } from "node:child_process"\nimport { appendFileSync } from "node:fs"\nError.stackTraceLimit = 80\n', 1)
i = s.index("    execFile(\n      program,")
s = s[:i] + '''    if (process.env.STACKLOG !== undefined) {
      const frames = (new Error().stack ?? "").split("\\n").slice(2).flatMap(l => {
        const m = /at (?:async )?(?:(\\S+) \\()?.*?\\/((?:packages|apps)\\/[^:]+):(\\d+)/.exec(l)
        return m === null ? [] : [`${m[1] ?? "?"}@${m[2]}:${m[3]}`]
      })
      appendFileSync(process.env.STACKLOG, `${JSON.stringify({ cmd: [program, ...args.slice(0, 12)].join(" ").slice(0, 300), frames })}\\n`)
    }
''' + s[i:]
open(p, "w").write(s)
