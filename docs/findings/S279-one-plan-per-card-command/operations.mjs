// S279's probe: per host operation (the named function or method a call sits
// in), the package values it uses, sorted into gather / plan / helper by name.
// Run from the repo root: node docs/findings/S279-one-plan-per-card-command/operations.mjs [--json out.json]
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
const require = createRequire(path.join(process.cwd(), "package.json"))
const oxc = require(fs.readdirSync(path.join(process.cwd(), "node_modules/.pnpm")).filter(d => d.startsWith("oxc-parser@")).map(d => path.join(process.cwd(), "node_modules/.pnpm", d, "node_modules/oxc-parser"))[0])

const ROOT = process.cwd()
const HOST = path.join(ROOT, "apps/pinetrie/host")
const PKGS = ["@pinetrie/rules", "@pinetrie/core", "@pinetrie/reads", "@pinetrie/lanes", "@pinetrie/jj", "@pinetrie/schema", "@pinetrie/folder", "@pinetrie/config"]

const files = []
;(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) && e.name !== "fakes.ts") files.push(p)
  }
})(HOST)

const kindOf = (name, pkg) => {
  if (pkg === "@pinetrie/reads" || /^read[A-Z]/.test(name)) return "gather"
  if (/^plan[A-Z]/.test(name)) return "plan"
  if (/^[A-Z][A-Z0-9_]+$/.test(name)) return "constant"
  if (/^[A-Z]/.test(name)) return "class"
  if (/(Id|IdFor)$/.test(name) || /^(is|as)[A-Z]/.test(name) && /Id$/.test(name)) return "vocab"
  return "helper"
}

const ops = []
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  const { program } = oxc.parseSync(f, src)
  const imported = new Map() // local -> {name, pkg}
  for (const st of program.body) {
    if (st.type !== "ImportDeclaration" || st.importKind === "type") continue
    const pkg = st.source.value
    if (!PKGS.includes(pkg)) continue
    for (const el of st.specifiers) {
      if (el.type !== "ImportSpecifier" || el.importKind === "type") continue
      imported.set(el.local.name, { name: el.imported.name, pkg })
    }
  }
  if (imported.size === 0) continue
  const rel = path.relative(HOST, f)
  const byOp = new Map()
  const fnName = (n, parent) => {
    if ((n.type === "FunctionDeclaration") && n.id) return n.id.name
    if (n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") {
      if (parent?.type === "VariableDeclarator" && parent.id.type === "Identifier") return parent.id.name
      if ((parent?.type === "Property" || parent?.type === "MethodDefinition") && parent.key?.type === "Identifier") return parent.key.name
    }
    return null
  }
  const visit = (n, stack) => {
    if (!n || typeof n.type !== "string") return
    if (n.type === "ImportDeclaration" || n.type.startsWith("TS")) return
    const parent = stack[stack.length - 1]
    if (n.type === "Identifier" && imported.has(n.name)) {
      const isKey = (parent?.type === "MemberExpression" && parent.property === n && !parent.computed) || (parent?.type === "Property" && parent.key === n && !parent.shorthand)
      if (!isKey) {
        let op = "(module)"
        for (let i = stack.length - 1; i >= 0; i--) { const nm = fnName(stack[i], stack[i - 1]); if (nm) { op = nm; break } }
        const { name, pkg } = imported.get(n.name)
        const k = `${rel}#${op}`
        if (!byOp.has(k)) byOp.set(k, new Map())
        byOp.get(k).set(name, { pkg, kind: kindOf(name, pkg) })
      }
    }
    stack.push(n)
    for (const key of Object.keys(n)) {
      if (key === "type" || key === "start" || key === "end") continue
      const v = n[key]
      if (Array.isArray(v)) for (const c of v) visit(c, stack)
      else if (v && typeof v === "object") visit(v, stack)
    }
    stack.pop()
  }
  visit(program, [])
  for (const [k, m] of byOp) ops.push({ op: k, names: [...m].map(([name, v]) => ({ name, ...v })) })
}

const summary = ops.map((o) => {
  const c = { gather: 0, plan: 0, helper: 0, constant: 0, class: 0, vocab: 0 }
  for (const n of o.names) c[n.kind]++
  return { op: o.op, ...c, helpers: o.names.filter((n) => n.kind === "helper").map((n) => n.name), plans: o.names.filter((n) => n.kind === "plan").map((n) => n.name) }
})
if (process.argv[2] === "--json") fs.writeFileSync(process.argv[3], JSON.stringify({ ops, summary }, null, 1))

const combining = summary.filter((s) => s.plan >= 2 || (s.plan >= 1 && s.helper >= 2) || s.helper >= 4)
console.log(`operations using package values: ${summary.length}; combining in the shell (>=2 plans, or a plan and >=2 helpers, or >=4 helpers): ${combining.length}`)
console.log("\nplans helpers  operation  [plans | helpers]")
for (const s of combining.sort((a, b) => b.helper + 2 * b.plan - (a.helper + 2 * a.plan)))
  console.log(String(s.plan).padStart(5), String(s.helper).padStart(7), " ", s.op, " [", s.plans.join(" "), "|", s.helpers.join(" "), "]")

// per file totals
const perFile = {}
for (const s of summary) {
  const f = s.op.split("#")[0]
  perFile[f] ??= { ops: 0, plan: new Set(), helper: new Set() }
  perFile[f].ops++
  s.plans.forEach((p) => perFile[f].plan.add(p))
  s.helpers.forEach((p) => perFile[f].helper.add(p))
}
console.log("\n== per file: distinct plans, distinct helpers")
for (const [f, v] of Object.entries(perFile).sort((a, b) => b[1].helper.size - a[1].helper.size).slice(0, 30))
  console.log(String(v.plan.size).padStart(4), String(v.helper.size).padStart(4), f)
