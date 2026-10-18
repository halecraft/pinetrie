// S252's census: every declaration `@pinetrie/core` exports, and who uses it,
// resolved by the TypeScript checker (aliases followed), not by name.
// Run from the repo root: node docs/findings/S252-record-types-census/census.ts

import path from "node:path"
// The repo's TypeScript 7 has no compiler API, so this imports TypeScript
// 5.9 from outside the repo. Install it first:
//   npm install --prefix /tmp/ts typescript@5.9
import ts from "/tmp/ts/node_modules/typescript/lib/typescript.js"

const ROOT = process.cwd()
const CORE = path.join(ROOT, "packages/core") + path.sep
// Packages that declare `@pinetrie/core` and not `@pinetrie/rules`.
const NO_RULES = new Set([
  "config",
  "docker",
  "folder",
  "jj",
  "lanehost",
  "lanes",
  "protocol",
  "schema",
  "conformance",
])

const config = ts.getParsedCommandLineOfConfigFile(
  path.join(ROOT, "tsconfig.json"),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
)
if (config === undefined) throw new Error("no tsconfig")
const program = ts.createProgram(config.fileNames, config.options)
const checker = program.getTypeChecker()

const pkgOf = (file: string): string => {
  const rel = path.relative(ROOT, file).split(path.sep)
  return rel[1] ?? rel[0] ?? file
}
const isTest = (file: string) =>
  /\.test\.tsx?$|\/e2e\/|\/fixtures\.ts$|\/fakes\.ts$|\/scripts\//.test(file)

// core's exported declarations, by symbol
const index = program.getSourceFile(path.join(CORE, "index.ts"))
if (index === undefined) throw new Error("no core index")
const indexSymbol = checker.getSymbolAtLocation(index)
if (indexSymbol === undefined) throw new Error("no core index symbol")
const exported = new Map<ts.Symbol, string>()
for (const s of checker.getExportsOfModule(indexSymbol)) {
  const target = s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s
  exported.set(target, s.getName())
}

interface Use {
  src: Set<string>
  test: Set<string>
  /** core declarations (top-level) whose own text names it */
  core: Set<string>
}
const uses = new Map<string, Use>()
for (const name of exported.values())
  uses.set(name, { src: new Set(), test: new Set(), core: new Set() })

const topName = (node: ts.Node): string | null => {
  let n: ts.Node = node
  while (n.parent !== undefined && !ts.isSourceFile(n.parent)) n = n.parent
  if (
    (ts.isInterfaceDeclaration(n) ||
      ts.isTypeAliasDeclaration(n) ||
      ts.isFunctionDeclaration(n) ||
      ts.isClassDeclaration(n)) &&
    n.name !== undefined
  )
    return n.name.text
  if (ts.isVariableStatement(n)) {
    const d = n.declarationList.declarations[0]
    if (d !== undefined && ts.isIdentifier(d.name)) return d.name.text
  }
  return null
}

for (const sf of program.getSourceFiles()) {
  const file = sf.fileName
  if (file.includes("node_modules") || !file.startsWith(ROOT)) continue
  const inCore = file.startsWith(CORE)
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      // import and export specifiers are not uses
      const p = node.parent
      if (
        p !== undefined &&
        !ts.isImportSpecifier(p) &&
        !ts.isExportSpecifier(p) &&
        !ts.isImportClause(p)
      ) {
        let s = checker.getSymbolAtLocation(node)
        if (s !== undefined && s.flags & ts.SymbolFlags.Alias)
          s = checker.getAliasedSymbol(s)
        const name = s === undefined ? undefined : exported.get(s)
        if (name !== undefined) {
          const u = uses.get(name)
          const decl = s?.declarations?.[0]
          const isOwnName =
            decl !== undefined &&
            (decl as ts.NamedDeclaration).name === node
          if (u !== undefined && !isOwnName) {
            if (inCore) {
              if (!isTest(file)) {
                const top = topName(node)
                if (top !== null && top !== name) u.core.add(top)
              }
            } else (isTest(file) ? u.test : u.src).add(pkgOf(file))
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

const kindOf = (name: string): string => {
  for (const [s, n] of exported)
    if (n === name) {
      const d = s.declarations?.[0]
      if (d === undefined) return "?"
      const file = path.relative(CORE, d.getSourceFile().fileName)
      const k =
        ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d)
          ? "type"
          : "value"
      return `${k} ${file}`
    }
  return "?"
}

// What must stay: used by a package that cannot declare rules, then every
// core declaration a staying one names, to a fixed point. A value used by
// core itself stays too: this census moves types only.
const stays = new Set<string>()
for (const [name, u] of uses)
  if ([...u.src, ...u.test].some(p => NO_RULES.has(p))) stays.add(name)
for (const [name] of uses)
  if (kindOf(name).startsWith("value")) stays.add(name)
let grew = true
while (grew) {
  grew = false
  for (const [name, u] of uses)
    if (!stays.has(name) && [...u.core].some(c => stays.has(c))) {
      stays.add(name)
      grew = true
    }
}

const out = [...uses].map(([name, u]) => ({
  name,
  where: kindOf(name),
  stays: stays.has(name),
  src: [...u.src].sort(),
  test: [...u.test].sort(),
  core: [...u.core].sort(),
}))
if (process.argv.includes("--json")) console.log(JSON.stringify(out, null, 1))
else
  for (const r of out.sort((a, b) => a.name.localeCompare(b.name)))
    console.log(
      `${r.stays ? "stay" : "MOVE"}\t${r.name}\t${r.where}\tsrc=${r.src.join(",")}\ttest=${r.test.join(",")}\tcore=${r.core.join(",")}`,
    )
