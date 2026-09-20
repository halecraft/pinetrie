// check-boundaries — enforce the module dependency rules by scanning imports.
//
// These rules are the architecture. Without a check they are folklore, and the
// first deadline erodes them. Run by `npm run check`.

import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const MODULES = ["core", "schema", "protocol", "storage", "host", "client", "e2e", "test", "scripts"]

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
const RULES = {
  core: { packages: "none", pi: false, local: ["core"], why: "pure; property-testable in isolation" },
  schema: { packages: "kyneta", pi: false, local: ["schema"], why: "doc shape must be testable without a harness" },
  protocol: { packages: "kyneta", pi: false, local: ["protocol"], why: "the contract; both sides agree on it" },
  storage: { packages: "any", pi: true, local: ["storage", "schema", "core"], why: "THE pi boundary" },
  host: { packages: "kyneta", pi: false, local: ["host", "core", "schema", "protocol", "storage"], why: "shell; pi only via storage/" },
  client: { packages: "kyneta", pi: false, local: ["client", "core", "schema", "protocol"], why: "browser; never pi" },
  e2e: { packages: "kyneta", pi: false, local: ["e2e", "core", "schema", "protocol", "client", "host"], why: "drives the same contract a browser does" },
  test: { packages: "kyneta", pi: false, local: ["test", "core", "schema", "protocol"], why: "unit tests of the pure parts" },
  conformance: { packages: "any", pi: true, local: ["conformance", "storage"], why: "runs pi's own Storage suite against our adapter; pi by definition" },
  scripts: { packages: "any", pi: false, local: ["scripts", "core"], why: "build/sanity tooling" },
}

// `protocol/messages.mjs` is the contract itself: it must import NOTHING, so
// that the shape both sides agree on cannot drift with anyone's dependencies.
const ZERO_IMPORT_FILES = new Set(["protocol/messages.mjs", "core/index.mjs"])

const IMPORT_RE = /(?:^|[\s(=])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g

async function* walk(dir) {
  let entries
  try { entries = await readdir(path.join(ROOT, dir), { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const rel = path.join(dir, entry.name)
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    if (entry.isDirectory()) yield* walk(rel)
    else if (/\.(mjs|js)$/.test(entry.name) && !entry.name.endsWith(".bundle.js")) yield rel
  }
}

const isPi = (spec) => PI_PACKAGES.some((p) => spec.startsWith(p))
const isKyneta = (spec) => KYNETA_PACKAGES.some((p) => spec === p || spec.startsWith(p))
const isBuiltin = (spec) => spec.startsWith("node:")
const isRelative = (spec) => spec.startsWith(".")

const violations = []
const summary = []

for (const moduleName of MODULES) {
  const rule = RULES[moduleName]
  const seen = new Set()

  for await (const file of walk(moduleName)) {
    const source = await readFile(path.join(ROOT, file), "utf8")
    const specs = []
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2] ?? match[3]
      if (spec !== undefined) specs.push(spec)
    }

    if (ZERO_IMPORT_FILES.has(file) && specs.length > 0) {
      violations.push(`${file}: must import NOTHING, found ${specs.map((s) => `"${s}"`).join(", ")}`)
    }

    for (const spec of specs) {
      if (isRelative(spec)) {
        // Resolve which module the target belongs to.
        const target = path.normalize(path.join(path.dirname(file), spec))
        const targetModule = target.split(path.sep)[0]
        if (!rule.local.includes(targetModule)) {
          violations.push(`${file}: imports "${spec}" -> module "${targetModule}", not allowed (${moduleName} may use: ${rule.local.join(", ")})`)
        } else if (targetModule !== moduleName) {
          seen.add(targetModule + "/")
        }
        continue
      }

      if (isPi(spec)) {
        if (!rule.pi) violations.push(`${file}: imports pi ("${spec}") — only storage/ may (${rule.why})`)
        else seen.add("pi")
        continue
      }
      if (isBuiltin(spec)) { seen.add("node:*"); continue }
      if (isKyneta(spec)) {
        if (rule.packages === "none") violations.push(`${file}: imports "${spec}" but ${moduleName}/ must import nothing`)
        else seen.add("kyneta")
        continue
      }
      // any other external package
      if (rule.packages !== "any") {
        if (moduleName === "host" && spec === "ws") { seen.add("ws"); continue }
        violations.push(`${file}: imports external package "${spec}", not allowed in ${moduleName}/`)
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

// The load-bearing assertion, stated separately so it cannot be lost in noise.
const piImporters = summary.filter(([, deps]) => deps.includes("pi")).map(([n]) => n)
console.log(`\n  modules importing pi: ${piImporters.length === 0 ? "(none)" : piImporters.join(", ")}`)
if (piImporters.length !== 1 || piImporters[0] !== "storage") {
  violations.push(`exactly one module (storage) must import pi; found: ${piImporters.join(", ") || "none"}`)
}

if (violations.length > 0) {
  console.error(`\nBOUNDARY VIOLATIONS (${violations.length}):`)
  for (const v of violations) console.error(`  ✗ ${v}`)
  process.exit(1)
}
console.log("\ncheck: ok — all boundary rules hold")
