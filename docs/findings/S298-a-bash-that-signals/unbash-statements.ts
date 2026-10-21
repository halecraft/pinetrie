// S298, Q2: the top-level statements unbash finds in a command, each with the
// lines it spans, to set beside the patched bash's signals.
//   node docs/findings/S298-a-bash-that-signals/unbash-statements.ts <cmd> <console>
// Run from packages/shell, which declares unbash.
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(path.join(process.cwd(), "package.json"))
const { parse } = await import(require.resolve("unbash"))
const [cmdPath, consolePath] = process.argv.slice(2)
const source = readFileSync(cmdPath, "utf8")
const lineAt = (pos: number) => source.slice(0, pos).split("\n").length
const statements = parse(source).commands.map((s: { pos: number; end: number }, i: number) => ({
  n: i + 1,
  from: lineAt(s.pos),
  to: lineAt(s.end),
  text: source.slice(s.pos, s.end),
}))
const console_ = readFileSync(consolePath, "utf8").replace(/\r/g, "")
const run = console_.split("=== run signal main\n")[1]?.split("=== ")[0] ?? ""
const signals = run
  .split("\n")
  .filter(l => l.startsWith("ev ") && l.endsWith(" 5"))
  .map(l => l.split(" ").map(Number))
  .map(([, n, line]) => ({ n, line }))
const outside = signals.filter(({ n, line }) => {
  const s = statements[n - 1]
  return s === undefined || line < s.from || line > s.to
})
console.log(`unbash: ${statements.length} top-level statements; bash signalled ${signals.length}`)
console.log(`signals whose line is outside unbash's statement of that ordinal: ${JSON.stringify(outside)}`)
