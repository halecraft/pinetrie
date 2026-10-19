import {
  type DiskPath,
  EMPTY_REGISTRY,
  isCache,
  NO_SHARED,
  type Registry,
  type RunRecord,
  stamp,
} from "@pinetrie/core"
import { collectionSteps } from "@pinetrie/core/fixtures"
import { describe, expect, test } from "vitest"
import {
  decodeRegistry,
  ignoreQuery,
  nextRegistry,
  planStaleOutputs,
  registryAfter,
  staleCause,
  topmost,
  turnDisk,
  unattributed,
  writesToClass,
} from "./disk.ts"

const run = (over: Partial<RunRecord>): RunRecord => ({
  id: "r1",
  command: "pnpm install",
  exit: 0,
  alive: false,
  observed: { kind: "complete" },
  reads: [],
  writes: [],
  deletions: [],
  missing: [],
  shared: [],
  ...over,
})

const made = (path: string, dir = false) => ({ path, created: true, dir })
const rewritten = (path: string) => ({ path, created: false, dir: false })

const IGNORED = new Set([
  "node_modules",
  "node_modules/a",
  "node_modules/a/index.js",
  "node_modules/.modules.yaml",
  ".env",
  ".pnpm-store",
  ".pnpm-store/x",
  ".pnpm-store/y",
  ".pinetrie-lane",
  ".pinetrie-lane/home",
  ".pinetrie-lane/home/.npmrc",
  ".pinetrie-lane/home/.cache",
  ".pinetrie-lane/home/.cache/z",
])

const classify = (
  runs: readonly RunRecord[],
  over: Partial<Parameters<typeof writesToClass>[0]> & {
    readonly ignored?: ReadonlySet<string>
  } = {},
) => {
  const { ignored = IGNORED, ...rest } = over
  return writesToClass({
    runs,
    toolWrites: [],
    registry: EMPTY_REGISTRY,
    shared: [".plans"],
    changed: [],
    ...rest,
  }).classify(ignored)
}

/** Each of `paths` hashed as `given` says, else null: as the helper answers. */
const answered = (
  paths: readonly string[],
  given: Readonly<Record<string, string | null>> = {},
) => Object.fromEntries(paths.map(p => [p, given[p] ?? null]))

const out = (...paths: string[]): DiskPath[] => paths as DiskPath[]

const install = run({
  reads: ["package.json", "pnpm-lock.yaml", ".pinetrie-lane/home/.npmrc"],
  missing: [".npmrc"],
  writes: [
    made("node_modules", true),
    made("node_modules/a", true),
    made("node_modules/a/index.js"),
  ],
})

describe("classifyWrites: each written path's class", () => {
  test("an ignored file a run made after reading source is derived, under the topmost directory it made", () => {
    const writes = classify([install])
    expect(writes.classes.get("node_modules/a/index.js")).toBe("derived")
    expect(writes.made.map(m => m.outputs)).toEqual([["node_modules"]])
  })

  test("a file added to an ignored directory that was there is under its topmost ignored directory", () => {
    const writes = classify([
      run({
        reads: ["pnpm-lock.yaml"],
        writes: [made(".pnpm-store/y"), made(".pinetrie-lane/home/.cache/z")],
      }),
    ])
    expect(writes.made.map(m => m.outputs)).toEqual([
      [".pinetrie-lane/home/.cache", ".pnpm-store"],
    ])
  })

  test("a run that lost events derives nothing: its ignored writes are private, and no recipe", () => {
    const writes = classify([
      { ...install, observed: { kind: "lost", events: 2 } },
    ])
    expect(writes.classes.get("node_modules/a/index.js")).toBe("private")
    expect(writes.made).toEqual([])
  })

  test("a file nothing ignores is source", () => {
    const writes = classify([
      run({ reads: ["a.ts"], writes: [rewritten("b.ts")] }),
    ])
    expect(writes.classes.get("b.ts")).toBe("source")
  })

  test("an ignored file a run made without reading source is private", () => {
    const writes = classify([
      run({ command: "echo k > .env", writes: [made(".env")] }),
    ])
    expect(writes.classes.get(".env")).toBe("private")
    expect(writes.made).toEqual([])
  })

  test("an ignored file a run edited in place, read before written, is private", () => {
    const writes = classify([
      run({ reads: ["a.ts", ".env"], writes: [rewritten(".env")] }),
    ])
    expect(writes.classes.get(".env")).toBe("private")
  })

  test("a write tool's ignored write is private, inside a derived root too", () => {
    const writes = classify([install], {
      toolWrites: ["node_modules/a/index.js"],
    })
    expect(writes.classes.get("node_modules/a/index.js")).toBe("private")
  })

  test("a known root rewritten by a run that read no source stays derived", () => {
    const registry: Registry = {
      recipes: [],
      roots: { node_modules: { evidence: "none", tagged: false } },
    }
    const writes = classify(
      [
        run({
          command: "touch node_modules/a/index.js",
          writes: [rewritten("node_modules/a/index.js")],
        }),
      ],
      { registry },
    )
    expect(writes.classes.get("node_modules/a/index.js")).toBe("derived")
  })

  test("shared directories and pine·trie's own paths are no class; the lane's home is", () => {
    const writes = classify([
      run({
        reads: ["a.ts"],
        writes: [
          made(".plans/p.md"),
          made(".jj/x"),
          made(".pinetrie-lane/home/.cache/z"),
        ],
      }),
    ])
    expect([...writes.classes.keys()]).toEqual([".pinetrie-lane/home/.cache/z"])
  })

  test("a directory a run made from source that nothing ignores is named, once, at its top", () => {
    const writes = classify([
      run({
        reads: ["a.ts"],
        writes: [
          made("dist", true),
          made("dist/js", true),
          made("dist/js/a.js"),
        ],
      }),
    ])
    expect(writes.unignored).toEqual(["dist"])
  })

  test("a source file the turn wrote and its commit left out is jj's leftover", () => {
    const writes = classify(
      [run({ reads: ["a.ts"], writes: [made("big.bin"), made("small.txt")] })],
      { toolWrites: ["notes.md"], changed: ["small.txt", "notes.md"] },
    )
    expect(writes.leftovers).toEqual(["big.bin"])
  })
})

describe("classifyWrites: a recipe's key", () => {
  test("its inputs are the source it read and its home's files outside derived roots; its failed lookups too", () => {
    const writes = classify(
      [
        run({
          ...install,
          reads: [
            ...install.reads,
            ".pinetrie-lane/home/.cache/z",
            "node_modules/.modules.yaml",
          ],
        }),
      ],
      {
        registry: {
          recipes: [],
          roots: {
            ".pinetrie-lane/home/.cache": { evidence: "added", tagged: false },
          },
        },
      },
    )
    expect(writes.made[0]?.inputs).toEqual([
      ".pinetrie-lane/home/.npmrc",
      "package.json",
      "pnpm-lock.yaml",
    ])
    expect(writes.made[0]?.missing).toEqual([".npmrc"])
  })

  test("a shared file it read keys by its stamp", () => {
    const writes = classify([
      run({
        ...install,
        shared: [
          {
            path: ".plans/p.md",
            kind: "open",
            writable: false,
            append: false,
            at: 1,
            pid: 2,
            stamp: stamp("1:2:3"),
          },
          {
            path: ".plans/q.md",
            kind: "open",
            writable: true,
            append: false,
            at: 1,
            pid: 2,
            stamp: stamp("4:5:6"),
          },
        ],
      }),
    ])
    expect(writes.made[0]?.shared).toEqual({ ".plans/p.md": "1:2:3" })
  })
})

describe("caches", () => {
  const known: Registry = {
    recipes: [],
    roots: { ".pnpm-store": { evidence: "none", tagged: false } },
  }
  const next = (registry: Registry, runs: readonly RunRecord[]) =>
    nextRegistry({
      registry,
      writes: classify(runs, { registry }),
      hashes: {},
      tagged: new Set(),
      image: "img",
    })

  test("a root's first making shows nothing of a cache", () => {
    const registry = next(EMPTY_REGISTRY, [install])
    expect(registry.roots.node_modules).toEqual({
      evidence: "none",
      tagged: false,
    })
    expect(isCache({ evidence: "none", tagged: false })).toBe(false)
  })

  test("a root a later run only added to is a cache", () => {
    const registry = next(known, [
      run({ reads: ["pnpm-lock.yaml"], writes: [made(".pnpm-store/y")] }),
    ])
    expect(registry.roots[".pnpm-store"]?.evidence).toBe("added")
  })

  test("a root a run changed or deleted under is never a cache again", () => {
    const added: Registry = {
      recipes: [],
      roots: { ".pnpm-store": { evidence: "added", tagged: false } },
    }
    const rewrote = next(added, [
      run({ reads: ["pnpm-lock.yaml"], writes: [rewritten(".pnpm-store/x")] }),
    ])
    expect(rewrote.roots[".pnpm-store"]?.evidence).toBe("changed")
    const deleted = next(added, [
      run({
        reads: ["pnpm-lock.yaml"],
        writes: [made(".pnpm-store/y")],
        deletions: [".pnpm-store/x"],
      }),
    ])
    expect(deleted.roots[".pnpm-store"]?.evidence).toBe("changed")
  })

  test("a changed root only added to later stays changed", () => {
    const changed: Registry = {
      recipes: [],
      roots: { ".pnpm-store": { evidence: "changed", tagged: false } },
    }
    const registry = next(changed, [
      run({ reads: ["pnpm-lock.yaml"], writes: [made(".pnpm-store/y")] }),
    ])
    expect(registry.roots[".pnpm-store"]?.evidence).toBe("changed")
  })

  test("a root holding a CACHEDIR.TAG is a cache from its first making", () => {
    const registry = nextRegistry({
      registry: EMPTY_REGISTRY,
      writes: classify([install]),
      hashes: {},
      tagged: new Set(["node_modules"]),
      image: "img",
    })
    expect(
      isCache(
        registry.roots.node_modules ?? { evidence: "none", tagged: false },
      ),
    ).toBe(true)
  })
})

describe("nextRegistry", () => {
  test("a recipe keyed by its inputs' hashes; an input gone before hashing keys as missing", () => {
    const registry = nextRegistry({
      registry: EMPTY_REGISTRY,
      writes: classify([install]),
      hashes: {
        "package.json": "h1",
        "pnpm-lock.yaml": "h2",
        ".pinetrie-lane/home/.npmrc": null,
      },
      tagged: new Set(),
      image: "img",
    })
    expect(registry.recipes).toEqual([
      {
        run: "r1",
        key: {
          command: "pnpm install",
          image: "img",
          inputs: { "package.json": "h1", "pnpm-lock.yaml": "h2" },
          missing: [".npmrc", ".pinetrie-lane/home/.npmrc"],
          shared: {},
        },
        outputs: out("node_modules"),
      },
    ])
  })

  test("a newer recipe takes an older one's outputs; one left with none goes", () => {
    const first = nextRegistry({
      registry: EMPTY_REGISTRY,
      writes: classify([install]),
      hashes: {},
      tagged: new Set(),
      image: "img",
    })
    const second = nextRegistry({
      registry: first,
      writes: classify([{ ...install, id: "r2" }], { registry: first }),
      hashes: {},
      tagged: new Set(),
      image: "img",
    })
    expect(second.recipes.map(r => r.run)).toEqual(["r2"])
  })

  test("a root deleted whole leaves the registry", () => {
    const first = nextRegistry({
      registry: EMPTY_REGISTRY,
      writes: classify([install]),
      hashes: {},
      tagged: new Set(),
      image: "img",
    })
    const after = nextRegistry({
      registry: first,
      writes: classify(
        [run({ command: "rm -rf node_modules", deletions: ["node_modules"] })],
        { registry: first },
      ),
      hashes: {},
      tagged: new Set(),
      image: "img",
    })
    expect(after).toEqual(EMPTY_REGISTRY)
  })
})

describe("ignoreQuery", () => {
  const links = {
    "node_modules/.pnpm/a/node_modules/b/lib/p.json":
      "node_modules/.pnpm/a/node_modules/b",
    "node_modules/.pnpm/a/node_modules/b/index.js":
      "node_modules/.pnpm/a/node_modules/b",
  }
  const query = ignoreQuery(
    [...Object.keys(links), "src/a.ts", "dist/x.js"],
    links,
  )
  test("a path beyond a symlink asks the symlink, once, and stands as it does", () => {
    expect(query.asked).toEqual([
      "dist/x.js",
      "node_modules/.pnpm/a/node_modules/b",
      "src/a.ts",
    ])
    expect(
      [
        ...query.ignored(
          new Set(["node_modules/.pnpm/a/node_modules/b", "dist/x.js"]),
        ),
      ].sort(),
    ).toEqual([
      "dist/x.js",
      "node_modules/.pnpm/a/node_modules/b/index.js",
      "node_modules/.pnpm/a/node_modules/b/lib/p.json",
    ])
  })
})

describe("unattributed", () => {
  const written = (...paths: string[]) => ({
    classes: new Map(paths.map(p => [p, "private" as const])),
    made: [],
    roots: new Map(),
    gone: [],
    unignored: [],
    leftovers: [],
  })
  const diffOf = (...paths: string[]) => ({
    changes: paths.map(path => ({
      path,
      change: "added" as const,
      kind: "file" as const,
    })),
  })

  test("a path is attributed when written, above a write, or under a written directory", () => {
    expect(
      unattributed(
        written("dist", "src/a.ts", "out/x"),
        diffOf(
          "dist/app.js",
          "src",
          "src/a.ts",
          "out/x",
          "out/y",
          ".plans/p.md",
          "log",
        ),
        [".plans"],
      ),
    ).toEqual(["out/y", "log"])
  })
  test("unattributed takes a bounded number of steps per write", () => {
    const n = 1_000
    const paths = Array.from(
      { length: n },
      (_, i) => `node_modules/.pnpm/p${i % 50}/f${i}`,
    )
    const { result, steps } = collectionSteps(() =>
      unattributed(
        written(...[...paths].reverse()),
        diffOf(...paths, "stray"),
        [],
      ),
    )
    expect(result).toEqual(["stray"])
    expect(steps).toBeLessThanOrEqual(4 * n)
  })
})

describe("the turn's record", () => {
  test("derived roots and private paths, topmost; a diff's ignored path no call wrote is private", () => {
    const writes = classify([
      install,
      run({ id: "r2", command: "echo k > .env", writes: [made(".env")] }),
    ])
    const diff = {
      changes: [
        {
          path: "node_modules",
          change: "added" as const,
          kind: "dir" as const,
        },
        { path: ".env", change: "added" as const, kind: "file" as const },
        { path: "out.log", change: "added" as const, kind: "file" as const },
        { path: ".jj", change: "changed" as const, kind: "dir" as const },
      ],
    }
    expect(unattributed(writes, diff, [".plans"])).toEqual(["out.log"])
    expect(turnDisk(writes, ["out.log"])).toEqual({
      derived: { paths: ["node_modules"], more: 0 },
      private: { paths: [".env", "out.log"], more: 0 },
      unignored: [],
      leftovers: [],
      shared: NO_SHARED,
    })
  })

  test("at most a hundred paths of a class, and how many more", () => {
    const made103 = Array.from({ length: 103 }, (_, i) =>
      made(`l${String(i).padStart(3, "0")}`),
    )
    const writes = classify([run({ writes: made103 })], {
      ignored: new Set(made103.map(w => w.path)),
    })
    const disk = turnDisk(writes, [])
    expect([disk.private.paths.length, disk.private.more]).toEqual([100, 3])
  })

  test("topmost: a directory stands for what is under it", () => {
    expect(topmost(["a/b", "a", "c/d", "b"])).toEqual(["a", "b", "c/d"])
  })

  test("writesToClass: it asks about every path written (and above), read or looked for, but pine·trie's own and the shared", () => {
    expect(
      writesToClass({
        runs: [
          run({ reads: ["a", ".jj/x"], writes: [made("b/f")], missing: ["c"] }),
        ],
        toolWrites: ["d", ".plans/e"],
        registry: EMPTY_REGISTRY,
        shared: [".plans"],
        changed: [],
      }).paths,
    ).toEqual(["a", "b", "b/f", "c", "d"])
  })

  test("registryAfter: it hashes each new recipe's inputs and each new root's CACHEDIR.TAG, and refuses an answer short of one", () => {
    const toKey = registryAfter({
      registry: EMPTY_REGISTRY,
      writes: classify([install]),
      image: "img",
    })
    expect(toKey.paths).toEqual([
      ".pinetrie-lane/home/.npmrc",
      "package.json",
      "pnpm-lock.yaml",
      "node_modules/CACHEDIR.TAG",
    ])
    expect(() => toKey.next({})).toThrow("never hashed")
    expect(
      toKey.next(answered(toKey.paths, { "node_modules/CACHEDIR.TAG": "t" }))
        .roots.node_modules?.tagged,
    ).toBe(true)
  })
})

describe("decodeRegistry", () => {
  test("an output leaving the disk is dropped as the file is read", () => {
    const written = {
      recipes: [
        {
          run: "x",
          key: {
            command: "c",
            image: "i",
            inputs: {},
            missing: [],
            shared: {},
          },
          outputs: out("../etc", "/etc", "a/../../b", "ok"),
        },
      ],
      roots: {},
    }
    expect(decodeRegistry(JSON.stringify(written)).recipes[0]?.outputs).toEqual(
      ["ok"],
    )
  })

  test("a broken or missing file is an empty registry", () => {
    expect(decodeRegistry(null)).toEqual(EMPTY_REGISTRY)
    expect(decodeRegistry("{")).toEqual(EMPTY_REGISTRY)
    expect(decodeRegistry('{"recipes":"no"}')).toEqual(EMPTY_REGISTRY)
  })

  test("a registry round-trips", () => {
    const registry: Registry = {
      recipes: [
        {
          run: "r1",
          key: {
            command: "c",
            image: "i",
            inputs: { a: "h" },
            missing: ["m"],
            shared: { ".plans/p": stamp("1:2:3") },
          },
          outputs: out("node_modules"),
        },
      ],
      roots: { node_modules: { evidence: "added", tagged: true } },
    }
    expect(decodeRegistry(JSON.stringify(registry))).toEqual(registry)
  })
})

describe("planStaleOutputs", () => {
  const key = {
    command: "c",
    image: "img",
    inputs: {},
    missing: [],
    shared: {},
  }
  const registry: Registry = {
    recipes: [
      { run: "install", key, outputs: out("node_modules", ".pnpm-store") },
      { run: "build", key, outputs: out("dist") },
    ],
    roots: {
      node_modules: { evidence: "changed", tagged: false },
      ".pnpm-store": { evidence: "added", tagged: false },
      dist: { evidence: "none", tagged: false },
    },
  }
  const holds = (run: string) => ({ run, broken: null })
  const breaks = (run: string) => ({ run, broken: "pnpm-lock.yaml" })
  const removed = (planned: ReturnType<typeof planStaleOutputs>) =>
    planned.removals.flatMap(r => r.paths)

  test("a broken recipe's outputs go, its caches stay, and the registry keeps them", () => {
    const planned = planStaleOutputs({
      registry,
      checks: [breaks("install"), holds("build")],
      image: "img",
    })
    expect(removed(planned)).toEqual(["node_modules"])
    expect(planned.registry).toEqual({
      recipes: [registry.recipes[1]],
      roots: {
        ".pnpm-store": { evidence: "added", tagged: false },
        dist: { evidence: "none", tagged: false },
      },
    })
  })

  test("a removal names what went, its cause and its command, never a cache", () => {
    const planned = planStaleOutputs({
      registry: {
        ...registry,
        recipes: [
          {
            run: "install",
            key: { ...key, command: "pnpm i && pnpm test" },
            outputs: out(
              "packages/a/node_modules",
              "node_modules",
              ".pnpm-store",
            ),
          },
          { run: "build", key, outputs: out("dist") },
        ],
      },
      checks: [breaks("install"), holds("build")],
      image: "img",
    })
    expect(planned.removals).toEqual([
      {
        paths: ["node_modules", "packages/a/node_modules"],
        cause: { kind: "changed", path: "pnpm-lock.yaml" },
        command: "pnpm i && pnpm test",
      },
    ])
  })

  test("every key holds: nothing goes", () => {
    const planned = planStaleOutputs({
      registry,
      checks: [holds("install"), holds("build")],
      image: "img",
    })
    expect(planned).toEqual({ removals: [], registry })
  })

  test("another image, or no answer for a recipe, breaks it", () => {
    expect(
      removed(
        planStaleOutputs({
          registry,
          checks: [holds("install"), holds("build")],
          image: "other",
        }),
      ),
    ).toEqual(["dist", "node_modules"])
    expect(
      removed(
        planStaleOutputs({
          registry,
          checks: [holds("install")],
          image: "img",
        }),
      ),
    ).toEqual(["dist"])
  })

  test("pine·trie's own paths are never deleted", () => {
    const odd: Registry = {
      recipes: [{ run: "x", key, outputs: out(".jj/repo", ".git", "ok") }],
      roots: {},
    }
    expect(
      removed(
        planStaleOutputs({
          registry: odd,
          checks: [breaks("x")],
          image: "img",
        }),
      ),
    ).toEqual(["ok"])
  })
})

describe("staleCause", () => {
  const recipe = {
    run: "r",
    key: { command: "c", image: "img", inputs: {}, missing: [], shared: {} },
    outputs: out("dist"),
  }
  test("a recipe's cause is the unanswered check, else the changed path, else the image", () => {
    expect(staleCause(recipe, undefined, "other")).toEqual({
      kind: "unchecked",
    })
    expect(staleCause(recipe, { run: "r", broken: "a.txt" }, "other")).toEqual({
      kind: "changed",
      path: "a.txt",
    })
    expect(staleCause(recipe, { run: "r", broken: null }, "other")).toEqual({
      kind: "image",
    })
    expect(staleCause(recipe, { run: "r", broken: null }, "img")).toBeNull()
  })
})

describe("nextRegistry: caches", () => {
  test("a cache stays a root once no recipe holds it", () => {
    const cached: Registry = {
      recipes: [],
      roots: { ".pnpm-store": { evidence: "added", tagged: false } },
    }
    const next = nextRegistry({
      registry: cached,
      writes: classify([install], { registry: cached }),
      hashes: {},
      tagged: new Set(),
      image: "img",
    })
    expect(next.roots[".pnpm-store"]).toEqual({
      evidence: "added",
      tagged: false,
    })
  })
})
