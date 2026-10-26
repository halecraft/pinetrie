import { describe, expect, test } from "vitest"
import {
  type About,
  type Gathered,
  HELPER,
  type PackagePlan,
  planPackage,
  selfReads,
  type Target,
} from "./package.ts"

const BIN = "apps/pinetrie/bin.ts"

const ABOUT: About = {
  version: "1.2.3",
  description: "d",
  license: "MIT",
  repository: { type: "git", url: "git+https://example.com/p.git" },
  homepage: "https://example.com/p#readme",
  bugs: "https://example.com/p/issues",
  keywords: ["k"],
}

/** A workspace of `sources`, each import resolved by `targets`, every entry the build starts from present. */
function gathered(
  sources: Record<string, string>,
  targets: Record<string, Record<string, Target>>,
  more: Partial<Gathered> = {},
): Gathered {
  const all: Record<string, string> = {
    [HELPER]: "export {}\n",
    ...sources,
  }
  return {
    entries: [BIN, HELPER],
    sources: new Map(Object.entries(all)),
    others: [],
    targets: new Map(
      Object.keys(all).map(f => [f, new Map(Object.entries(targets[f] ?? {}))]),
    ),
    declared: new Map([
      ["ws", "8.22.0"],
      ["vite", "8.3.4"],
      ["@earendil-works/pi-coding-agent", "0.99.2"],
      ["@gotgenes/pi-anthropic-auth", "3.4.3"],
    ]),
    unimported: [
      "@earendil-works/pi-coding-agent",
      "@gotgenes/pi-anthropic-auth",
    ],
    about: ABOUT,
    ...more,
  }
}

const file = (path: string): Target => ({ kind: "file", path })
const pkg = (name: string): Target => ({ kind: "package", name })

const made = (plan: PackagePlan) => {
  if (plan.kind !== "package") throw new Error(plan.why.join("\n"))
  return plan
}

describe("planPackage", () => {
  test("each import of a file becomes its .js path, a type-only one stays as stripped, and no other position moves", () => {
    const bin = [
      "// pine·trie — the command",
      'import { a } from "./a.ts"',
      'import { core } from "@pinetrie/core/sub"',
      'import type { T } from "./t.ts"',
      "const n: number = a + core",
    ].join("\n")
    const plan = made(
      planPackage(
        gathered(
          {
            [BIN]: bin,
            "apps/pinetrie/a.ts": "export const a = 1\n",
            "packages/core/sub.ts": "export const core = 2\n",
          },
          {
            [BIN]: {
              "./a.ts": file("apps/pinetrie/a.ts"),
              "@pinetrie/core/sub": file("packages/core/sub.ts"),
            },
          },
        ),
      ),
    )
    const js = plan.written.get("apps/pinetrie/bin.js") ?? ""
    expect(js).toContain('from "./a.js"')
    expect(js).toContain('from "../../packages/core/sub.js"')
    expect(js).not.toContain("./t.ts")
    expect(js.split("\n").map(l => l.length)).toEqual(
      js.split("\n").map((l, i) => {
        const line = bin.split("\n")[i] ?? ""
        return line.includes(".ts") || line.includes("@pinetrie")
          ? l.length
          : line.length
      }),
    )
    expect([...plan.written.keys()].sort()).toEqual([
      "apps/pinetrie/a.js",
      "apps/pinetrie/bin.js",
      "packages/core/sub.js",
      "packages/pi/lane-helper.js",
    ])
  })

  test("dependencies are what shipped files import, and what no import names, at the workspace's versions", () => {
    const plan = made(
      planPackage(
        gathered(
          {
            [BIN]: 'import ws from "ws"\n',
            "apps/pinetrie/host/page-build.ts":
              'import { build } from "vite"\n',
          },
          {
            [BIN]: { ws: pkg("ws") },
            "apps/pinetrie/host/page-build.ts": { vite: pkg("vite") },
          },
        ),
      ),
    )
    expect(plan.manifest.dependencies).toEqual({
      "@earendil-works/pi-coding-agent": "0.99.2",
      "@gotgenes/pi-anthropic-auth": "3.4.3",
      ws: "8.22.0",
    })
    expect(plan.manifest).toMatchObject({
      name: "pinetrie",
      version: "1.2.3",
      bin: { pinetrie: "apps/pinetrie/bin.js" },
    })
  })

  test("the manifest says of the package what the root manifest says", () => {
    const plan = made(planPackage(gathered({ [BIN]: "export {}\n" }, {})))
    expect(plan.manifest).toMatchObject(ABOUT)
  })

  test("a package no workspace manifest declares refuses the plan", () => {
    const plan = planPackage(
      gathered(
        { [BIN]: 'import x from "left-pad"\n' },
        { [BIN]: { "left-pad": pkg("left-pad") } },
      ),
    )
    expect(plan).toEqual({
      kind: "refused",
      why: ["left-pad is imported and no workspace package declares it"],
    })
  })

  test("other files of a shipped package are copied; tests, fixtures, notes and the page's stamp are not", () => {
    const plan = made(
      planPackage(
        gathered(
          {
            [BIN]: 'import "../../packages/lanes/a.ts"\n',
            "packages/lanes/a.ts": "",
          },
          {
            [BIN]: { "../../packages/lanes/a.ts": file("packages/lanes/a.ts") },
          },
          {
            others: [
              "packages/lanes/image/Containerfile",
              "packages/lanes/TECHNICAL.md",
              "packages/lanes/package.json",
              "packages/lanes/fixtures/x.json",
              "packages/web/dist/index.html",
              "packages/web/dist/inputs.json",
              "packages/web/public/icon.png",
              "packages/vm/image/init",
            ],
          },
        ),
      ),
    )
    expect(plan.copied).toEqual([
      "packages/lanes/image/Containerfile",
      "packages/web/dist/index.html",
      "README.md",
      "LICENSE",
    ])
  })

  test("an import() of a computed name refuses the plan, outside deep.ts", () => {
    const computed = `const m = await import(\`./${"$"}{name}.ts\`)\n`
    const refused = planPackage(gathered({ [BIN]: computed }, {}))
    expect(refused).toEqual({
      kind: "refused",
      why: [`${BIN} has an import() of a computed name`],
    })
    const deep = "packages/pi/deep.ts"
    expect(
      planPackage(
        gathered(
          { [BIN]: `import "../../${deep}"\n`, [deep]: computed },
          { [BIN]: { [`../../${deep}`]: file(deep) } },
        ),
      ).kind,
    ).toBe("package")
  })

  test("a file the lane helper reaches that reads beside itself refuses the plan; one only the command reaches does not", () => {
    const reads = "const here = import.meta.dirname\n"
    expect(
      planPackage(
        gathered(
          {
            [BIN]: "",
            [HELPER]: 'import "./x.ts"\n',
            "packages/pi/x.ts": reads,
          },
          { [HELPER]: { "./x.ts": file("packages/pi/x.ts") } },
        ),
      ),
    ).toEqual({
      kind: "refused",
      why: [
        "packages/pi/x.ts uses import.meta.dirname, which the lane helper's bundle would get wrong",
      ],
    })
    expect(planPackage(gathered({ [BIN]: reads }, {})).kind).toBe("package")
  })
})

test("selfReads: import.meta's place and process.argv[1], nothing else", () => {
  expect(
    selfReads(
      "a.ts",
      [
        "const a = import.meta.dirname",
        "const b = import.meta.url",
        "const c = process.argv[1]",
        "const d = process.argv[2]",
        "const e = import.meta.resolve('x')",
      ].join("\n"),
    ),
  ).toEqual(["import.meta.dirname", "import.meta.url", "process.argv[1]"])
})
