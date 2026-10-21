// scripts/indexes — each indexed package's `index.ts`, written from what is
// imported through it: one `export { … } from "./m.ts"` per module that
// declares a name some file imports by the package's name, or through
// `./index.ts`, and nothing else. The index's leading comment is kept as it
// is written. It also finds each export of a module that no other file
// imports, by the index, by another entry of the package, or by path.
// `node scripts/indexes.ts` (`pnpm run indexes`) writes the plan and lists
// those; `scripts/indexes.test.ts` fails while it would write anything,
// refuses, or finds one.
// Gather, plan, execute: everything above `gatherIndexes` is pure.

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { parseSync } from "oxc-parser"
import { exportedNames, takenNames } from "./imports.ts"
import { readSources, type Source } from "./sources.ts"

/** The packages whose index is written: their directories under `packages/`. */
export const INDEXED: readonly string[] = [
  "core",
  "threads",
  "rules",
  "interface",
  "web-core",
]

/** An indexed package: its name, as imported, its directory, and its other entries. */
export interface IndexedPackage {
  readonly name: string
  readonly dir: string
  /** Each entry but the index, by the specifier that imports it: `@pinetrie/rules/ignores` -> `packages/rules/ignores.ts`. */
  readonly entries: ReadonlyMap<string, string>
}

export interface IndexInput {
  readonly packages: readonly IndexedPackage[]
  /** Every TypeScript source, tests among them. */
  readonly sources: readonly Source[]
}

/** Why an index cannot be written. */
export type IndexRefusal =
  /** A file imports a name through the index that no module of the package exports. */
  | {
      readonly kind: "not-exported"
      readonly package: string
      readonly name: string
      readonly file: string
    }
  /** Two modules export the name, so the index cannot say which it means. */
  | {
      readonly kind: "two-modules"
      readonly package: string
      readonly name: string
      readonly modules: readonly string[]
    }
  /** A file takes the whole index (`import * as`, a default import, `export * from`), so which names it needs cannot be read. */
  | {
      readonly kind: "whole-import"
      readonly package: string
      readonly file: string
    }
  /** A module re-exports another whole, so the names it exports cannot be read. */
  | {
      readonly kind: "export-all"
      readonly package: string
      readonly module: string
    }

/** A name a module exports that no other file imports: its `export` can go. */
export interface UnusedExport {
  readonly module: string
  readonly name: string
}

export interface IndexPlan {
  /** Each index whose text is not what it should be, with what it should be. */
  readonly writes: readonly { readonly file: string; readonly text: string }[]
  readonly refusals: readonly IndexRefusal[]
  readonly unusedExports: readonly UnusedExport[]
}

const LINE_WIDTH = 80

/**
 * Names in the order Biome sorts them: letter by letter, regardless of case,
 * a capital before its lower case at the first letter where they differ only
 * so; a name before any it begins.
 */
const byName = (a: string, b: string): number => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const [x, y] = [a.charAt(i), b.charAt(i)]
    if (x === y) continue
    const [lx, ly] = [x.toLowerCase(), y.toLowerCase()]
    if (lx !== ly) return lx < ly ? -1 : 1
    return x < y ? -1 : 1
  }
  return a.length - b.length
}

/** One statement of the index, laid out as Biome lays it out. */
export function exportStatement(
  names: readonly { readonly name: string; readonly typeOnly: boolean }[],
  module: string,
): string {
  const sorted = names.toSorted((a, b) => byName(a.name, b.name))
  const allTypes = sorted.every(n => n.typeOnly)
  const keyword = allTypes ? "export type" : "export"
  const parts = sorted.map(n =>
    n.typeOnly && !allTypes ? `type ${n.name}` : n.name,
  )
  const tail = `} from "${module}"`
  const one = `${keyword} { ${parts.join(", ")} ${tail}`
  return one.length <= LINE_WIDTH
    ? one
    : `${keyword} {\n${parts.map(p => `  ${p},`).join("\n")}\n${tail}`
}

/** `text`'s leading comment: everything before its first statement. */
function leadingComment(file: string, text: string): string {
  const first = parseSync(file, text).program.body[0]
  return (first === undefined ? text : text.slice(0, first.start)).trimEnd()
}

/** The index of the package `pkg` is, given which file names it through which specifier. */
const isIndexSpecifier = (
  pkg: IndexedPackage,
  file: string,
  specifier: string,
): boolean =>
  specifier === pkg.name ||
  (specifier.startsWith(".") &&
    path.posix.normalize(
      path.posix.join(path.posix.dirname(file), specifier),
    ) === `${pkg.dir}/index.ts`)

const isModuleOf = (pkg: IndexedPackage, file: string): boolean =>
  path.posix.dirname(file) === pkg.dir &&
  !file.endsWith("/index.ts") &&
  !file.endsWith("/fixtures.ts") &&
  !/\.test\.tsx?$/.test(file)

/** Each indexed package's index, as what is imported through it says it should be. */
export function planIndexes(input: IndexInput): IndexPlan {
  const writes: { file: string; text: string }[] = []
  const refusals: IndexRefusal[] = []
  const unusedExports: UnusedExport[] = []
  // Each file read once, whichever packages it imports.
  const takenBy = input.sources.map(s => ({
    file: s.file,
    taken: takenNames(s.file, s.text),
  }))
  for (const pkg of input.packages) {
    const indexFile = `${pkg.dir}/index.ts`
    const index = input.sources.find(s => s.file === indexFile)
    if (index === undefined) continue
    // Which module exports each name.
    const exporters = new Map<string, string[]>()
    const exportsOf = new Map<string, readonly string[]>()
    for (const s of input.sources) {
      if (!isModuleOf(pkg, s.file)) continue
      const module = `./${path.posix.basename(s.file)}`
      const { names, whole } = exportedNames(s.file, s.text)
      exportsOf.set(
        s.file,
        names.map(n => n.name),
      )
      if (whole.length > 0)
        refusals.push({ kind: "export-all", package: pkg.name, module: s.file })
      // An overloaded function is declared once per signature: one module still.
      for (const n of names)
        if (!(exporters.get(n.name) ?? []).includes(module))
          exporters.set(n.name, [...(exporters.get(n.name) ?? []), module])
    }
    // Each name taken through the index, and whether every taking is a type's.
    const taken = new Map<string, boolean>()
    for (const s of takenBy) {
      if (s.file === indexFile) continue
      for (const t of s.taken) {
        if (!isIndexSpecifier(pkg, s.file, t.specifier)) continue
        if (t.kind === "whole") {
          refusals.push({
            kind: "whole-import",
            package: pkg.name,
            file: s.file,
          })
          continue
        }
        for (const n of t.names) {
          if (!exporters.has(n.name)) {
            refusals.push({
              kind: "not-exported",
              package: pkg.name,
              name: n.name,
              file: s.file,
            })
            continue
          }
          taken.set(n.name, (taken.get(n.name) ?? true) && n.typeOnly)
        }
      }
    }
    // Which names each module gives some other file: through the index, an
    // entry of its own, or a path.
    const given = new Map<string, Set<string>>()
    const give = (file: string, name: string) =>
      given.set(file, (given.get(file) ?? new Set()).add(name))
    for (const s of takenBy) {
      if (s.file === indexFile) continue
      for (const t of s.taken) {
        if (t.kind !== "names") continue
        const viaIndex = isIndexSpecifier(pkg, s.file, t.specifier)
        const entry = pkg.entries.get(t.specifier)
        const byPath = t.specifier.startsWith(".")
          ? path.posix.normalize(
              path.posix.join(path.posix.dirname(s.file), t.specifier),
            )
          : null
        for (const n of t.names) {
          const module = viaIndex
            ? (exporters.get(n.name) ?? [])
                .slice(0, 1)
                .map(m => path.posix.join(pkg.dir, m))[0]
            : (entry ?? byPath)
          if (module !== undefined && module !== null) give(module, n.name)
        }
      }
    }
    for (const [module, names] of exportsOf)
      for (const name of new Set(names))
        if (!given.get(module)?.has(name)) unusedExports.push({ module, name })
    const byModule = new Map<string, { name: string; typeOnly: boolean }[]>()
    for (const [name, typeOnly] of taken) {
      const modules = exporters.get(name) ?? []
      if (modules.length > 1) {
        refusals.push({ kind: "two-modules", package: pkg.name, name, modules })
        continue
      }
      const module = modules[0]
      if (module !== undefined)
        byModule.set(module, [
          ...(byModule.get(module) ?? []),
          { name, typeOnly },
        ])
    }
    const statements = [...byModule]
      // By the module's name, its extension left off: Biome puts `./focus.ts` before `./focus-claim.ts`.
      .toSorted(([a], [b]) =>
        byName(a.replace(/\.tsx?$/, ""), b.replace(/\.tsx?$/, "")),
      )
      .map(([module, names]) => exportStatement(names, module))
    const head = leadingComment(indexFile, index.text)
    const text = `${head}${head === "" ? "" : "\n\n"}${statements.join("\n")}\n`
    if (text !== index.text) writes.push({ file: indexFile, text })
  }
  return { writes, refusals, unusedExports }
}

/** The packages in `INDEXED` with their names, and every source, tests among them. */
export function gatherIndexes(root: string): IndexInput {
  return {
    packages: INDEXED.map(dir => {
      const manifest = JSON.parse(
        readFileSync(path.join(root, "packages", dir, "package.json"), "utf8"),
      ) as {
        readonly name: string
        readonly exports?: Readonly<Record<string, string>>
      }
      const entries = new Map(
        Object.entries(manifest.exports ?? {})
          .filter(([sub, file]) => sub !== "." && file.endsWith(".ts"))
          .map(([sub, file]) => [
            `${manifest.name}${sub.slice(1)}`,
            path.posix.join("packages", dir, file),
          ]),
      )
      return { name: manifest.name, dir: `packages/${dir}`, entries }
    }),
    sources: [
      ...readSources(root, { tests: true }),
      {
        file: "workspace.test.ts",
        text: readFileSync(path.join(root, "workspace.test.ts"), "utf8"),
      },
    ],
  }
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dirname, "..")
  const plan = planIndexes(gatherIndexes(root))
  for (const r of plan.refusals) console.log(JSON.stringify(r))
  if (plan.refusals.length > 0) {
    console.log("indexes: nothing written while any is refused")
    process.exit(1)
  }
  for (const w of plan.writes) writeFileSync(path.join(root, w.file), w.text)
  console.log(`indexes: ${plan.writes.length} written`)
  for (const u of plan.unusedExports)
    console.log(
      `${u.module}: ${u.name} is exported, and no other file imports it`,
    )
  if (plan.unusedExports.length > 0) process.exitCode = 1
}
