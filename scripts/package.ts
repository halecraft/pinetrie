// scripts/package — `pnpm run package`: the npm package `pinetrie`, written
// to `dist/pinetrie/` in the repo's own layout, each file's types stripped
// in place by Node's own stripper and each import of a `.ts` file rewritten
// to its `.js`. The lane helper alone is one bundled file, its packages
// inside it, since a lane runs it from the mount where npm may not have put
// them. Gather (reads), plan (`planPackage`, pure), execute (writes).

import {
  cpSync,
  globSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire, isBuiltin, stripTypeScriptTypes } from "node:module"
import path from "node:path"
import { parseSync } from "oxc-parser"
import { SCRIPT_ENTRIES } from "../packages/install/index.ts"
import { DEEP_PACKAGES } from "../packages/pi/deep-packages.ts"
import { loadedImports, reachable } from "./imports.ts"
import { isNode, type Node, readSources, walk } from "./sources.ts"

/** Where an import leads: a file of the repo, a third-party package by name, or Node's own. */
export type Target =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "package"; readonly name: string }
  | { readonly kind: "builtin" }
  | { readonly kind: "unresolved"; readonly why: string }

/** Everything the plan decides from, read from the repo. */
export interface Gathered {
  /** Each source file, repo-relative, tests left out. */
  readonly sources: ReadonlyMap<string, string>
  /** Every other file a shipped package could hold, repo-relative. */
  readonly others: readonly string[]
  /** Each source's literal imports, by specifier, resolved as Node resolves them from it. */
  readonly targets: ReadonlyMap<string, ReadonlyMap<string, Target>>
  /** Each third-party package the workspace declares, at its version. */
  readonly declared: ReadonlyMap<string, string>
  /** The packages `packages/pi/deep.ts` loads by file, which no import names. */
  readonly deepPackages: readonly string[]
  /** The root manifest's version and description. */
  readonly version: string
  readonly description: string
}

/** The package, as files to write and files to copy, or why it cannot be made. */
export type PackagePlan =
  | {
      readonly kind: "package"
      /** Each shipped source's JavaScript, by its path in the package. */
      readonly written: ReadonlyMap<string, string>
      /** Repo-relative files copied to the same path. */
      readonly copied: readonly string[]
      readonly manifest: Readonly<Record<string, unknown>>
    }
  | { readonly kind: "refused"; readonly why: readonly string[] }

/** What the package starts from: the command, and every script pine·trie runs by path. */
export const ENTRIES: readonly string[] = [
  "apps/pinetrie/bin.ts",
  ...SCRIPT_ENTRIES.map(e => `${e}.ts`),
]

/** The script built as one file, its packages inside it. */
export const HELPER = "packages/pi/lane-helper.ts"

/** The one module allowed an `import()` no reader can follow: it declares what it reaches (`DEEP_PACKAGES`). */
const DEEP = "packages/pi/deep.ts"

/** What makes a module wrong inside a bundle: it reads beside itself, or asks whether it is the program. */
const SELF_READS = ["dirname", "filename", "url"]

/** Each place `text` reads where it is, or whether it is the program, by what it reads. */
export function selfReads(file: string, text: string): readonly string[] {
  const found: string[] = []
  const program = parseSync(file, text).program as unknown as Node
  walk(program, n => {
    if (n.type !== "MemberExpression" || !isNode(n.object)) return
    const property = isNode(n.property) ? n.property : null
    if (
      n.object.type === "MetaProperty" &&
      property !== null &&
      typeof property.name === "string" &&
      SELF_READS.includes(property.name)
    )
      found.push(`import.meta.${property.name}`)
    if (
      n.object.type === "MemberExpression" &&
      isNode(n.object.object) &&
      n.object.object.type === "Identifier" &&
      n.object.object.name === "process" &&
      isNode(n.object.property) &&
      n.object.property.name === "argv" &&
      property !== null &&
      property.type === "Literal" &&
      property.value === 1
    )
      found.push("process.argv[1]")
  })
  return found
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file)

/** The directory of the workspace package a repo-relative file is in. */
const packageDir = (file: string): string =>
  file.split("/").slice(0, 2).join("/")

/** Folders and files no package ships. */
const NOT_SHIPPED = [
  /(^|\/)(node_modules|fixtures|testing|testdata|e2e|public|\.vite[^/]*)\//,
  /(^|\/)(TECHNICAL\.md|tsconfig\.json|package\.json)$/,
  /\.test\.tsx?$/,
  /\.tsx?$/,
]

/** The page ships only its build, without the stamp that names the builder's paths. */
const PAGE = "packages/web"
const isShippedPageFile = (file: string) =>
  file.startsWith(`${PAGE}/dist/`) && !file.endsWith("/inputs.json")

/** A third-party specifier's package name. */
export const packageName = (specifier: string): string =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/")

/** The `.js` path a `.ts` source is shipped as. */
const shippedPath = (file: string) => file.replace(/\.ts$/, ".js")

/** `to`'s path from `from`'s directory, as an import names it. */
const relativeImport = (from: string, to: string): string => {
  const rel = path.posix.relative(path.posix.dirname(from), to)
  return rel.startsWith(".") ? rel : `./${rel}`
}

/** The package `gathered` makes: pure. */
export function planPackage(g: Gathered): PackagePlan {
  const why: string[] = []
  const graph = new Map(
    [...g.targets].map(([file, targets]) => [
      file,
      [...targets.values()].flatMap(t => (t.kind === "file" ? [t.path] : [])),
    ]),
  )
  const shipped = [...reachable(graph, ENTRIES)].toSorted()

  for (const file of reachable(graph, [HELPER]))
    for (const read of selfReads(file, g.sources.get(file) ?? ""))
      why.push(
        `${file} uses ${read}, which the lane helper's bundle would get wrong`,
      )

  const written = new Map<string, string>()
  const thirdParty = new Set<string>(g.deepPackages)
  for (const file of shipped) {
    const text = g.sources.get(file)
    if (text === undefined || !file.endsWith(".ts")) {
      why.push(`${file} is shipped and is no TypeScript source`)
      continue
    }
    const targets = g.targets.get(file) ?? new Map<string, Target>()
    const edits: { start: number; end: number; text: string }[] = []
    for (const i of loadedImports(file, text)) {
      if (i.kind === "computed") {
        if (file !== DEEP)
          why.push(`${file} has an import() of a computed name`)
        continue
      }
      const target = targets.get(i.specifier)
      if (target === undefined || target.kind === "unresolved")
        why.push(
          `${file}: ${i.specifier} does not resolve${target === undefined ? "" : `: ${target.why}`}`,
        )
      else if (target.kind === "package") thirdParty.add(target.name)
      else if (target.kind === "file")
        edits.push({
          start: i.start,
          end: i.end,
          text: JSON.stringify(relativeImport(file, shippedPath(target.path))),
        })
    }
    // Stripping blanks types with spaces, so every position is the source's.
    let js = stripTypeScriptTypes(text, { mode: "strip" })
    for (const e of edits.toSorted((a, b) => b.start - a.start))
      js = js.slice(0, e.start) + e.text + js.slice(e.end)
    written.set(shippedPath(file), js)
  }

  const dependencies: Record<string, string> = {}
  for (const name of [...thirdParty].toSorted()) {
    const version = g.declared.get(name)
    if (version === undefined)
      why.push(`${name} is imported and no workspace package declares it`)
    else dependencies[name] = version
  }

  const dirs = new Set(shipped.map(packageDir))
  const copied = g.others.filter(f =>
    f.startsWith(`${PAGE}/`)
      ? isShippedPageFile(f)
      : dirs.has(packageDir(f)) && !NOT_SHIPPED.some(r => r.test(f)),
  )

  if (why.length > 0) return { kind: "refused", why }
  return {
    kind: "package",
    written,
    copied: [...copied, "README.md", "LICENSE"],
    manifest: {
      name: "pinetrie",
      version: g.version,
      description: g.description,
      license: "MIT",
      type: "module",
      bin: { pinetrie: "apps/pinetrie/bin.js" },
      engines: { node: ">=24" },
      os: ["darwin", "linux"],
      cpu: ["arm64", "x64"],
      dependencies,
    },
  }
}

// --- gather ---------------------------------------------------------------

/** The package's inputs, read from the repo at `root`. */
export function gatherPackage(root: string): Gathered {
  const sources = new Map(
    readSources(root, { tests: false })
      .filter(s => !isTest(s.file))
      .map(s => [s.file, s.text] as const),
  )
  const targets = new Map(
    [...sources].map(([file, text]) => {
      const fromFile = createRequire(path.join(root, file))
      const resolved = new Map<string, Target>()
      for (const i of loadedImports(file, text)) {
        if (i.kind !== "literal") continue
        const s = i.specifier
        resolved.set(
          s,
          isBuiltin(s)
            ? { kind: "builtin" }
            : s.startsWith(".")
              ? {
                  kind: "file",
                  path: path.posix.join(path.posix.dirname(file), s),
                }
              : s.startsWith("@pinetrie/")
                ? workspaceTarget(root, fromFile, s)
                : { kind: "package", name: packageName(s) },
        )
      }
      return [file, resolved] as const
    }),
  )
  const manifests = globSync(["packages/*/package.json", "apps/*/package.json"], {
    cwd: root,
  }).map(
    f =>
      JSON.parse(readFileSync(path.join(root, f), "utf8")) as {
        readonly dependencies?: Record<string, string>
      },
  )
  const declared = new Map(
    manifests.flatMap(m =>
      Object.entries(m.dependencies ?? {}).filter(
        ([, v]) => !v.startsWith("workspace:"),
      ),
    ),
  )
  const rootManifest = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { readonly version: string; readonly description: string }
  return {
    sources,
    others: globSync(["packages/**/*", "apps/pinetrie/**/*"], {
      cwd: root,
      exclude: ["**/node_modules/**"],
      withFileTypes: true,
    })
      .filter(d => d.isFile() && !/\.tsx?$/.test(d.name))
      .map(d => path.relative(root, path.join(d.parentPath, d.name)))
      .toSorted(),
    targets,
    declared,
    deepPackages: DEEP_PACKAGES,
    version: rootManifest.version,
    description: rootManifest.description,
  }
}

/** A workspace import, resolved through the package's `exports` as Node does. */
function workspaceTarget(
  root: string,
  fromFile: NodeJS.Require,
  specifier: string,
): Target {
  try {
    return {
      kind: "file",
      path: path.relative(root, fromFile.resolve(specifier)),
    }
  } catch (error) {
    return { kind: "unresolved", why: String(error) }
  }
}

// --- execute --------------------------------------------------------------

/** Write the package `plan` names into `out`, the helper bundled over its stripped file. */
async function writePackage(
  root: string,
  out: string,
  plan: Extract<PackagePlan, { kind: "package" }>,
): Promise<void> {
  rmSync(out, { recursive: true, force: true })
  for (const [file, text] of plan.written) {
    mkdirSync(path.dirname(path.join(out, file)), { recursive: true })
    writeFileSync(path.join(out, file), text)
  }
  for (const file of plan.copied)
    cpSync(path.join(root, file), path.join(out, file))
  writeFileSync(
    path.join(out, "package.json"),
    `${JSON.stringify(plan.manifest, null, 2)}\n`,
  )
  const { build } = await import("esbuild")
  await build({
    entryPoints: [path.join(root, HELPER)],
    outfile: path.join(out, shippedPath(HELPER)),
    allowOverwrite: true,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    logLevel: "warning",
    // Some of its packages are CommonJS, which call `require`.
    banner: {
      js: 'import { createRequire as __pinetrieRequire } from "node:module"; const require = __pinetrieRequire(import.meta.url);',
    },
  })
}

if (import.meta.filename === process.argv[1]) {
  const major = Number(process.versions.node.split(".")[0])
  if (major !== 24) {
    console.error(
      `the package is built on Node 24, whose stripTypeScriptTypes it was measured with; this is ${process.versions.node}`,
    )
    process.exit(1)
  }
  const root = path.resolve(import.meta.dirname, "..")
  const { buildPage } = await import("../apps/pinetrie/host/page-build.ts")
  await buildPage()
  const plan = planPackage(gatherPackage(root))
  if (plan.kind === "refused") {
    for (const line of plan.why) console.error(line)
    process.exit(1)
  }
  const out = path.join(root, "dist", "pinetrie")
  await writePackage(root, out, plan)
  console.log(
    `[package] ${plan.written.size} files built, ${plan.copied.length} copied, into ${path.relative(root, out)}`,
  )
}
