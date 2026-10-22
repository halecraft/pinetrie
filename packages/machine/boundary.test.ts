// `@pinetrie/machine` decides and does no I/O: it reaches the machine only
// through the ports the host hands it. Its manifest keeps the lane packages
// out by resolution (`workspace.test.ts`); a Node builtin resolves whatever a
// manifest says, so this reads each file's imports, types among them.

import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { parseSync } from "oxc-parser"
import { expect, test } from "vitest"

const DIR = import.meta.dirname

/** Each source file of the package, tests aside. */
const sources = (): string[] =>
  readdirSync(DIR, { encoding: "utf8" })
    .filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort()

/** Every module a file imports or re-exports from, `import type` included. */
function specifiers(file: string, text: string): readonly string[] {
  const { module } = parseSync(file, text)
  return [
    ...module.staticImports.map(i => i.moduleRequest.value),
    ...module.staticExports.flatMap(e =>
      e.entries.flatMap(x =>
        x.moduleRequest === null ? [] : [x.moduleRequest.value],
      ),
    ),
    ...module.dynamicImports.map(i =>
      text.slice(i.moduleRequest.start, i.moduleRequest.end),
    ),
  ]
}

const REFUSED = [
  "@pinetrie/lanes",
  "@pinetrie/docker",
  "@pinetrie/vm",
  "@pinetrie/lanehost",
  "@pinetrie/pi",
  "@earendil-works/",
  "node:fs",
  "node:child_process",
  "node:net",
]

const isRefused = (specifier: string): boolean =>
  REFUSED.some(r =>
    r.endsWith("/")
      ? specifier.startsWith(r)
      : specifier === r || specifier.startsWith(`${r}/`),
  )

test("no module of @pinetrie/machine imports a lane package, pi, or Node's I/O", () => {
  const files = sources()
  const imports = files.map(f => ({
    file: f,
    specifiers: specifiers(f, readFileSync(path.join(DIR, f), "utf8")),
  }))
  // The scan reads imports: the package's modules make some.
  expect(imports.some(i => i.specifiers.includes("@pinetrie/core"))).toBe(true)
  expect(
    imports.flatMap(i =>
      i.specifiers.filter(isRefused).map(s => `${i.file}: ${s}`),
    ),
  ).toEqual([])
})
