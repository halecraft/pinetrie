// check-boundaries — enforce the module dependency rules by scanning imports.
//
// These rules are the architecture. Without a check they are folklore, and the
// first deadline erodes them. Run by `npm run check`.

import type { Dirent } from "node:fs"
import { existsSync, readFileSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
/** Directory per module. `packages/*` are real workspace packages. */
const MODULE_DIRS: Record<string, string> = {
  core: "packages/core",
  schema: "packages/schema",
  pi: "packages/pi",
  conformance: "packages/conformance",
  protocol: "protocol",
  host: "host",
  client: "client",
  e2e: "e2e",
  test: "test",
  scripts: "scripts",
}
const MODULES = Object.keys(MODULE_DIRS)

/** `@pineta/x` is module `x` reached by package specifier rather than path. */
const WORKSPACE_SCOPE = "@pineta/"

const PI_PACKAGES = ["@earendil-works/"]
const KYNETA_PACKAGES = ["@kyneta/", "loro-crdt"]

/**
 * allow.packages — external specifiers this module may import.
 *   "none"    : no external imports at all
 *   "kyneta"  : Kyneta public API + node builtins
 *   "any"     : anything
 * allow.pi    — may this module import pi?
 * allow.local — which sibling modules it may import from.
 */
interface ModuleRule {
  /** External specifiers this module may import. */
  readonly packages: "none" | "kyneta" | "any"
  /** Exact external packages permitted on top of `packages`. */
  readonly allow?: readonly string[]
  /** May this module import pi? */
  readonly pi: boolean
  /** Sibling modules it may import from. */
  readonly local: readonly string[]
  readonly why: string
}

const RULES: Record<string, ModuleRule> = {
  core: {
    packages: "none",
    pi: false,
    local: ["core"],
    why: "pure; property-testable in isolation",
  },
  schema: {
    packages: "kyneta",
    pi: false,
    local: ["schema"],
    why: "doc shape must be testable without a harness",
  },
  protocol: {
    packages: "kyneta",
    pi: false,
    local: ["protocol", "core"],
    why: "the contract; both sides agree on it. May use core because the contract's types (ErrCode, Position, EntryId) live there, and core imports nothing, so the edge adds no weight and cannot form a cycle",
  },
  pi: {
    packages: "any",
    pi: true,
    local: ["pi", "schema", "core"],
    why: "THE pi boundary",
  },
  host: {
    packages: "kyneta",
    allow: ["ws", "vite"],
    pi: false,
    local: ["host", "core", "schema", "protocol", "pi"],
    why: "shell; pi only via pi/; vite serves the client in middleware mode",
  },
  client: {
    packages: "kyneta",
    pi: false,
    allow: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
    local: ["client", "core", "schema", "protocol"],
    why: "browser; never pi; React renders the tree",
  },
  // `allow` names the exact external packages a module may import. It is an
  // explicit, reviewable exception list — not a widening of `packages`.
  e2e: {
    packages: "kyneta",
    allow: ["@playwright/test"],
    pi: false,
    local: ["e2e", "core", "schema", "protocol", "client", "host"],
    why: "drives the same contract a browser does; @playwright/test for the real-browser run",
  },
  test: {
    packages: "kyneta",
    allow: ["vitest"],
    pi: false,
    local: ["test", "core", "schema", "protocol"],
    why: "unit tests of the pure parts",
  },
  conformance: {
    packages: "any",
    pi: true,
    local: ["conformance", "pi"],
    why: "runs pi's own Storage suite against our adapter; pi by definition",
  },
  scripts: {
    packages: "any",
    pi: false,
    local: ["scripts", "core"],
    why: "build/sanity tooling",
  },
}

// `protocol/messages.ts` is the contract itself: it must import NOTHING, so
// that the shape both sides agree on cannot drift with anyone's dependencies.
const ZERO_IMPORT_FILES = new Set([
  "protocol/messages.ts",
  "packages/core/index.ts",
])

// Every import form, in ORDER — the order is load-bearing.
//
// The bare side-effect import `import "s"` comes FIRST. It has no `from`
// clause, so it matched nothing here until now; and when it was appended last,
// the `from` alternative's `[^;]*?` happily spanned newlines, swallowed the
// bare import, and matched the `from` on the NEXT line instead. Alternation is
// ordered, so putting it first fixes that without shortening `[^;]*?` — which
// must keep matching newlines, or multiline `import {\n  a,\n} from "s"`
// silently stops being checked.
//
//   1. `import "s"`            bare, side-effect only
//   2. `import x from "s"`     and `export … from "s"`, incl. multiline + type
//   3. `import("s")`           dynamic
//   4. `require("s")`
//
// Non-literal specifiers remain unmatched by design: they cannot be resolved
// by reading syntax. The pi rule does not rely on this scanner for that — see
// the manifest assertions above.
const IMPORT_RE =
  /(?:^|[\s;}])import\s+["']([^"']+)["']|(?:^|[\s(=])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/gm

/**
 * Remove comments before scanning.
 *
 * The `from` form of IMPORT_RE is bounded by `[^;]*?`, but this codebase omits
 * semicolons (Biome `asNeeded`), so a match can run across whole functions
 * until it meets ANY `from "..."`, including one in a comment. It did: a doc
 * comment reading 'tell "no lane" from "a lane at the root"' was reported as
 * an import of a package called "a lane at the root".
 *
 * Deliberately simple. The line-comment pattern skips `://` so URLs in
 * strings survive; a `//` inside some other string would lose the rest of its
 * line, which can only hide an import written on that same line.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: Dirent[]
  try {
    entries = await readdir(path.join(ROOT, dir), { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const rel = path.join(dir, entry.name)
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    if (entry.isDirectory()) yield* walk(rel)
    else if (
      // The extension list is load-bearing, and it has now failed TWICE the
      // same way: a checker that only saw `.mjs` stopped enforcing anything as
      // files became `.ts`, and one that only saw `.ts` stopped seeing the
      // client the moment it became `.tsx`. Both times the scanner still
      // reported "all boundary rules hold" — the worst possible failure.
      // If you add a source extension anywhere, add it here and prove the
      // checker can still fail on a file with that extension.
      /\.(mts|ts|tsx|mjs|js|jsx)$/.test(entry.name) &&
      !entry.name.endsWith(".bundle.js") &&
      !entry.name.endsWith(".d.ts")
    )
      yield rel
  }
}

const isPi = (spec: string): boolean =>
  PI_PACKAGES.some(p => spec.startsWith(p))
const isKyneta = (spec: string): boolean =>
  KYNETA_PACKAGES.some(p => spec === p || spec.startsWith(p))
const isBuiltin = (spec: string): boolean => spec.startsWith("node:")
const isRelative = (spec: string): boolean => spec.startsWith(".")

const violations: string[] = []

// A path that no longer exists silently stops asserting anything — which is
// exactly what the packages/ move did to `core/index.ts`. Fail loudly instead.
for (const f of ZERO_IMPORT_FILES) {
  if (!existsSync(path.join(ROOT, f))) {
    violations.push(
      `ZERO_IMPORT_FILES names "${f}", which does not exist — the assertion is dead`,
    )
  }
}

const summary: Array<[string, string[]]> = []

for (const moduleName of MODULES) {
  const rule = RULES[moduleName]
  if (rule === undefined) throw new Error(`no rule for module ${moduleName}`)
  const seen = new Set<string>()

  for await (const file of walk(MODULE_DIRS[moduleName] ?? moduleName)) {
    const source = await readFile(path.join(ROOT, file), "utf8")
    const specs: string[] = []
    for (const match of stripComments(source).matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2] ?? match[3] ?? match[4]
      if (spec !== undefined) specs.push(spec)
    }

    if (ZERO_IMPORT_FILES.has(file) && specs.length > 0) {
      violations.push(
        `${file}: must import NOTHING, found ${specs.map(s => `"${s}"`).join(", ")}`,
      )
    }

    for (const spec of specs) {
      if (isRelative(spec)) {
        // Resolve which module the target belongs to.
        const target = path.normalize(path.join(path.dirname(file), spec))
        // Map the resolved path back to a module. Longest dir first, so
        // `packages/core` wins over a hypothetical `packages`.
        const targetModule =
          Object.entries(MODULE_DIRS)
            .sort((a, b) => b[1].length - a[1].length)
            .find(
              ([, dir]) =>
                target === dir || target.startsWith(`${dir}${path.sep}`),
            )?.[0] ??
          target.split(path.sep)[0] ??
          ""

        // A relative path INTO node_modules is still a package import; it is
        // just spelled the long way. pi/deep.ts does this on purpose,
        // because pi's export map refuses the subpaths it needs (for types as
        // well as values). Classify by the package it lands on, so the
        // "only pi/ may import pi" rule still applies rather than being
        // sidestepped by the spelling.
        if (targetModule === "node_modules") {
          const pkg = target.split(path.sep).slice(1).join("/")
          if (isPi(pkg)) {
            if (!rule.pi)
              violations.push(
                `${file}: reaches pi via a relative path ("${spec}") — only pi/ may (${rule.why})`,
              )
            else seen.add("pi")
          } else {
            violations.push(
              `${file}: relative import into node_modules ("${spec}") is not a recognised package`,
            )
          }
          continue
        }
        if (!rule.local.includes(targetModule)) {
          violations.push(
            `${file}: imports "${spec}" -> module "${targetModule}", not allowed (${moduleName} may use: ${rule.local.join(", ")})`,
          )
        } else if (targetModule !== moduleName) {
          seen.add(`${targetModule}/`)
        }
        continue
      }

      if (spec.startsWith(WORKSPACE_SCOPE)) {
        const targetModule = spec.slice(WORKSPACE_SCOPE.length)
        if (!rule.local.includes(targetModule)) {
          violations.push(
            `${file}: imports "${spec}" -> module "${targetModule}", not allowed (${moduleName} may use: ${rule.local.join(", ")})`,
          )
        } else if (targetModule !== moduleName) {
          seen.add(`${targetModule}/`)
        }
        continue
      }

      if (isPi(spec)) {
        if (!rule.pi)
          violations.push(
            `${file}: imports pi ("${spec}") — only pi/ may (${rule.why})`,
          )
        else seen.add("pi")
        continue
      }
      if (isBuiltin(spec)) {
        seen.add("node:*")
        continue
      }
      if (isKyneta(spec)) {
        if (rule.packages === "none")
          violations.push(
            `${file}: imports "${spec}" but ${moduleName}/ must import nothing`,
          )
        else seen.add("kyneta")
        continue
      }
      // any other external package
      if (rule.packages !== "any") {
        if (rule.allow?.includes(spec)) {
          seen.add(spec)
          continue
        }
        violations.push(
          `${file}: imports external package "${spec}", not allowed in ${moduleName}/`,
        )
      } else seen.add(spec)
    }
  }
  summary.push([moduleName, [...seen].sort()])
}

console.log("module dependency map (as built)\n")
for (const [name, deps] of summary) {
  const shown = deps.length === 0 ? "— nothing —" : deps.join(", ")
  console.log(`  ${name.padEnd(9)} -> ${shown}`)
}

// --- manifest assertions ---------------------------------------------------
//
// The load-bearing rule — "the app cannot reach pi" — is NOT enforced by this
// scanner any more, and deliberately so. A scan reads syntax, and a specifier
// can be spelled unboundedly many ways: `createRequire(...)`, a template
// literal, a concatenated string. All three evaded this file.
//
// It is now enforced by MODULE RESOLUTION. pi is declared only by
// `packages/pi` and `packages/conformance`, and pnpm's node_modules is strict,
// so from the app every spelling fails with ERR_MODULE_NOT_FOUND. What is left
// for us is to assert the *manifest* property that makes that true.
const manifest = (rel: string): { dependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(path.join(ROOT, rel, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>
  }

const rootDeps = Object.keys(manifest(".").dependencies ?? {})
const rootPi = rootDeps.filter(d => isPi(d))
if (rootPi.length > 0) {
  violations.push(
    `the root app declares pi (${rootPi.join(", ")}) — it must reach pi only through @pineta/pi, so that resolution makes every other path impossible`,
  )
}

const coreDeps = Object.keys(manifest("packages/core").dependencies ?? {})
if (coreDeps.length > 0) {
  violations.push(
    `@pineta/core must declare NO dependencies; found ${coreDeps.join(", ")}`,
  )
}

// A residual syntax check: still useful inside packages/, where pi IS
// resolvable and only the declaring packages may import it.
const piImporters = summary
  .filter(([, deps]) => deps.includes("pi"))
  .map(([n]) => n)
console.log(
  `\n  modules importing pi: ${piImporters.length === 0 ? "(none)" : piImporters.join(", ")}`,
)
if (piImporters.length !== 1 || piImporters[0] !== "pi") {
  violations.push(
    `exactly one module (pi/) must import pi; found: ${piImporters.join(", ") || "none"}`,
  )
}

if (violations.length > 0) {
  console.error(`\nBOUNDARY VIOLATIONS (${violations.length}):`)
  for (const v of violations) console.error(`  ✗ ${v}`)
  process.exit(1)
}
console.log("\ncheck: ok — all boundary rules hold")
