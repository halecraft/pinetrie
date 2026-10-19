import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
const R = "/tmp/s253/repo"
const op = execFileSync("jj", ["-R", R, "--ignore-working-copy", "op", "log", "--no-graph", "-n1", "-T", "id"]).toString().trim()
const { plain } = JSON.parse(readFileSync("/tmp/s253/reads.json", "utf8"))
const read = plain[0]
const rev = read[read.indexOf("-r") + 1], tpl = read[read.indexOf("-T") + 1]
const list = /\(present\([0-9a-f]{40}\)(?: \| present\([0-9a-f]{40}\))+\)/.exec(rev)[0]
console.log("list", list.length, "chars,", list.split("|").length, "commits; occurrences in revset", rev.split(list).length - 1, "in template", tpl.split(list).length - 1)
const time = (name, args, n = 7) => {
  const ms = []
  let out = ""
  for (let i = 0; i < n; i++) {
    const t = performance.now()
    out = execFileSync("jj", ["-R", R, "--ignore-working-copy", "--at-op", op, ...args], { maxBuffer: 1 << 28 }).toString()
    ms.push(performance.now() - t)
  }
  ms.sort((a, b) => a - b)
  console.log(`${name}: median ${ms[n >> 1].toFixed(0)} ms, ${out.split("\n").length - 1} rows`)
  return out
}
const base = time("as the host runs it", ["log", "--no-graph", "-r", rev, "-T", tpl])
time("revset only, ids", ["log", "--no-graph", "-r", rev, "-T", 'commit_id ++ "\\n"'])
writeFileSync("/tmp/s253/a.toml", `[revset-aliases]\ns253_accepted = ${JSON.stringify(list)}\n`)
const al = (s) => s.split(list).join("s253_accepted")
const viaAlias = time("list as an alias", ["--config-file", "/tmp/s253/a.toml", "log", "--no-graph", "-r", al(rev), "-T", al(tpl)])
console.log("  same output:", viaAlias === base)
time("list alone, ids", ["log", "--no-graph", "-r", list, "-T", 'commit_id ++ "\\n"'])
time("template without the accepted flag", ["log", "--no-graph", "-r", rev, "-T", tpl.replace(/if\(self\.contained_in\("\(present[^"]*"\), "K"\)/, '""')])
const flags = [...tpl.matchAll(/if\(self\.contained_in\(("(?:[^"\\]|\\.)*")\), "(\w)"\)/g)]
for (const [, r, letter] of flags) {
  const one = JSON.parse(r)
  time(`  flag ${letter}'s revset alone (${one.length} chars)`, ["log", "--no-graph", "-r", one, "-T", '""'], 3)
}
const inline = ["--config", `revset-aliases.s253_accepted=${JSON.stringify(list)}`]
const viaConfig = time("list as a --config alias", [...inline, "log", "--no-graph", "-r", al(rev), "-T", al(tpl)])
console.log("  same output:", viaConfig === base)
const second = plain[1]
const rev2 = second[second.indexOf("-r") + 1]
console.log("second log (readStart):", rev2.length, "chars; holds the list:", rev2.includes(list))
const lists2 = [...rev2.matchAll(/\((?:present\()?[0-9a-f]{40}\)?(?: \| (?:present\()?[0-9a-f]{40}\)?)+\)/g)].map(m => m[0].length)
console.log("  commit lists in it, chars:", lists2.join(", "))
time("second log as the host runs it", second.filter(a => a !== "--ignore-working-copy"))
const list2 = [...rev2.matchAll(/\((?:present\()?[0-9a-f]{40}\)?(?: \| (?:present\()?[0-9a-f]{40}\)?)+\)/g)][0][0]
const out2 = time("second log as the host runs it", second.filter(a => a !== "--ignore-working-copy"))
const s2 = second.filter(a => a !== "--ignore-working-copy").map(a => a.split(list2).join("s253_l2"))
const out2a = time("second log, its list as an alias", ["--config", `revset-aliases.s253_l2=${JSON.stringify(list2)}`, ...s2])
console.log("  same output:", out2 === out2a)
const expr = `(::present("pinetrie-accepted") & description(regex:"(?m)^(Pinetrie-Source|Pinetrie-Thread): "))`
const viaExpr = time("lane read, the list as the expression readShared reads it by", ["--config", `revset-aliases.s253_accepted=${JSON.stringify(expr)}`, "log", "--no-graph", "-r", al(rev), "-T", al(tpl)])
console.log("  same output:", viaExpr === base)
