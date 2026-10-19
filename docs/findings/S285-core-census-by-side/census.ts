// S285's and S286's census: every declaration a package exports, who names it
// outside the package (resolved by the TypeScript checker, aliases followed),
// and the package's own import graph between its modules. S252's census,
// generalized to any package and to its sub-exports.
//
// Run from the repo root, after `pnpm install --frozen-lockfile`:
//   node docs/findings/S285-core-census-by-side/census.ts core  > /tmp/core.json
//   node docs/findings/S285-core-census-by-side/census.ts rules > /tmp/rules.json
//
// The repo's TypeScript 7 has no compiler API, so this imports TypeScript
// 5.9 from outside the repo. Install it first:
//   npm install --prefix /tmp/ts typescript@5.9

import fs from "node:fs"
import path from "node:path"
import ts from "/tmp/ts/node_modules/typescript/lib/typescript.js"

const ROOT = process.cwd()
const target = process.argv[2]
if (target === undefined) throw new Error("name a package: core, rules")
const PKG = path.join(ROOT, "packages", target) + path.sep
const manifest = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"))
const entries: Record<string, string> =
  typeof manifest.exports === "object" ? manifest.exports : { ".": "./index.ts" }

const config = ts.getParsedCommandLineOfConfigFile(
  path.join(ROOT, "tsconfig.json"),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
)
if (config === undefined) throw new Error("no tsconfig")
const program = ts.createProgram(config.fileNames, config.options)
const checker = program.getTypeChecker()

/** The unit a file belongs to: a package's directory name, `app`, `conformance`, `scripts` or `root`. */
const unitOf = (file: string): string => {
  const rel = path.relative(ROOT, file).split(path.sep)
  if (rel[0] === "packages") return rel[1] ?? "?"
  if (rel[0] === "apps") return rel[1] === "pinetrie" ? "app" : (rel[1] ?? "?")
  if (rel[0] === "scripts") return "scripts"
  return "root"
}
const isTest = (file: string) =>
  /\.test\.tsx?$|\/e2e\/|\/fixtures\.ts$|\/fakes\.ts$|\/testing\.ts$|\/scripts\/|workspace\.test\.ts$/.test(
    file,
  )

// Every exported declaration, by symbol, and the entries that export it.
interface Export {
  name: string
  module: string
  kind: "type" | "value"
  entries: string[]
  lines: number
}
const exported = new Map<ts.Symbol, Export>()
for (const [sub, rel] of Object.entries(entries)) {
  if (!rel.endsWith(".ts")) continue
  const sf = program.getSourceFile(path.join(PKG, rel))
  if (sf === undefined) throw new Error(`no ${rel}`)
  const sym = checker.getSymbolAtLocation(sf)
  if (sym === undefined) continue
  for (const s of checker.getExportsOfModule(sym)) {
    const t = s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s
    const d = t.declarations?.[0]
    if (d === undefined) continue
    const prev = exported.get(t)
    if (prev !== undefined) {
      prev.entries.push(sub)
      continue
    }
    const sfd = d.getSourceFile()
    const start = sfd.getLineAndCharacterOfPosition(d.getStart()).line
    const end = sfd.getLineAndCharacterOfPosition(d.getEnd()).line
    exported.set(t, {
      name: s.getName(),
      module: path.relative(PKG, sfd.fileName),
      kind:
        ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d) ? "type" : "value",
      entries: [sub],
      lines: end - start + 1,
    })
  }
}

interface Use {
  src: Set<string>
  test: Set<string>
  /** Files outside the package that name it, source only. */
  srcFiles: Set<string>
  /** The package's own modules (source only) that name it, other than its declaring module. */
  inPkg: Set<string>
}
const uses = new Map<ts.Symbol, Use>()
for (const s of exported.keys())
  uses.set(s, { src: new Set(), test: new Set(), srcFiles: new Set(), inPkg: new Set() })

for (const sf of program.getSourceFiles()) {
  const file = sf.fileName
  if (file.includes("node_modules") || !file.startsWith(ROOT)) continue
  const inPkg = file.startsWith(PKG)
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const p = node.parent
      if (
        p !== undefined &&
        !ts.isImportSpecifier(p) &&
        !ts.isExportSpecifier(p) &&
        !ts.isImportClause(p)
      ) {
        let s = checker.getSymbolAtLocation(node)
        if (s !== undefined && s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s)
        const u = s === undefined ? undefined : uses.get(s)
        const e = s === undefined ? undefined : exported.get(s)
        if (u !== undefined && e !== undefined) {
          const decl = s?.declarations?.[0]
          const isOwnName = decl !== undefined && (decl as ts.NamedDeclaration).name === node
          if (!isOwnName) {
            if (inPkg) {
              const mod = path.relative(PKG, file)
              if (!isTest(file) && mod !== e.module) u.inPkg.add(mod)
            } else if (isTest(file)) u.test.add(unitOf(file))
            else {
              u.src.add(unitOf(file))
              u.srcFiles.add(path.relative(ROOT, file))
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

// The package's own module graph: each source module's relative imports,
// split into what loads at run time and what only names types.
interface ModuleInfo {
  lines: number
  values: string[]
  types: string[]
}
const modules: Record<string, ModuleInfo> = {}
for (const sf of program.getSourceFiles()) {
  const file = sf.fileName
  if (!file.startsWith(PKG) || isTest(file) || file.includes("node_modules")) continue
  const mod = path.relative(PKG, file)
  const info: ModuleInfo = { lines: sf.getLineStarts().length, values: [], types: [] }
  for (const st of sf.statements) {
    if (!(ts.isImportDeclaration(st) || ts.isExportDeclaration(st))) continue
    const spec = st.moduleSpecifier
    if (spec === undefined || !ts.isStringLiteral(spec) || !spec.text.startsWith(".")) continue
    const to = path.relative(PKG, path.resolve(path.dirname(file), spec.text))
    let typeOnly = false
    if (ts.isImportDeclaration(st)) {
      const c = st.importClause
      typeOnly =
        c !== undefined &&
        (c.isTypeOnly ||
          (c.name === undefined &&
            c.namedBindings !== undefined &&
            ts.isNamedImports(c.namedBindings) &&
            c.namedBindings.elements.length > 0 &&
            c.namedBindings.elements.every(el => el.isTypeOnly)))
    } else typeOnly = st.isTypeOnly
    ;(typeOnly ? info.types : info.values).push(to)
  }
  modules[mod] = info
}

const out = {
  package: target,
  exports: [...exported].map(([s, e]) => {
    const u = uses.get(s)
    return {
      ...e,
      src: [...(u?.src ?? [])].sort(),
      test: [...(u?.test ?? [])].sort(),
      srcFiles: [...(u?.srcFiles ?? [])].sort(),
      inPkg: [...(u?.inPkg ?? [])].sort(),
    }
  }),
  modules,
}
console.log(JSON.stringify(out, null, 1))
