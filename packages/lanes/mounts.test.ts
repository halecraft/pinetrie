import { describe, expect, test } from "vitest"
import { parts, SESSION } from "./fixtures.ts"
import { planHostMounts, planMounts, slotMounts } from "./mounts.ts"

describe("planMounts: every host path a lane sees, in one list", () => {
  test("your working copy, pinetrie's own and the ignore file's directory, read-only", () => {
    expect(planMounts(parts)).toEqual([
      { source: "/p", target: "/mnt/host-working-copy", readonly: true },
      { source: "/opt/pinetrie", target: "/pinetrie", readonly: true },
      {
        source: `${SESSION}/runtime/abc`,
        target: "/pinetrie-runtime",
        readonly: true,
      },
      {
        source: `${SESSION}/lane-git`,
        target: "/pinetrie-git",
        readonly: true,
      },
      { source: "/k", target: "/k", readonly: true },
    ])
  })
  test("shared directories read-write in /workspace; granted host paths read-only under /mnt/host", () => {
    const mounts = planMounts({
      ...parts,
      shared: [{ path: ".plans", source: "/p/.plans" }],
      hostPaths: ["/Users/ada/skills"],
    })
    expect(mounts).toContainEqual({
      source: "/p/.plans",
      target: "/workspace/.plans",
      readonly: false,
    })
    expect(mounts).toContainEqual({
      source: "/Users/ada/skills",
      target: "/mnt/host/Users/ada/skills",
      readonly: true,
    })
  })
})

describe("slotMounts: what a host shares into its slot of the lane VM", () => {
  test("every directory a lane mounts, its shared directories with the base's", () => {
    const shared = [{ path: ".plans", source: "/p/.plans" }]
    const attached = [{ source: "/s/ssh", target: "/run/ssh", readonly: true }]
    const slot = slotMounts({ base: planMounts(parts), shared, attached })
    const sources = new Set(slot.map(m => m.source))
    for (const m of [...planMounts({ ...parts, shared }), ...attached])
      expect(sources).toContain(m.source)
  })
  test("the runtime and the ignore file's directory come from the session's data directory", () => {
    const slot = slotMounts({
      base: planMounts(parts),
      shared: [],
      attached: [],
    })
    const from = (target: string) => slot.find(m => m.target === target)?.source
    expect(from("/pinetrie-runtime")).toBe(`${SESSION}/runtime/abc`)
    expect(from("/pinetrie-git")).toBe(`${SESSION}/lane-git`)
  })
})

describe("planHostMounts: granted host paths, and the ones never mounted", () => {
  const home = "/Users/ada"
  const own = [
    "/Users/ada/.config/pinetrie",
    "/Users/ada/.local/share/pinetrie",
  ]
  test("nested roots collapse into the outermost", () => {
    expect(
      planHostMounts({
        roots: [
          "/Users/ada/ai/duane",
          "/Users/ada/ai/duane/skills/plan",
          "/opt/x",
        ],
        project: null,
        home,
        own,
      }),
    ).toEqual({ mounts: ["/Users/ada/ai/duane", "/opt/x"], refused: [] })
  })
  test("a root inside the project is neither mounted nor refused: each lane has its own copy", () => {
    expect(
      planHostMounts({
        roots: ["/work/app/.pi/skills", "/work/app", "/opt/x"],
        project: "/work/app",
        home,
        own,
      }),
    ).toEqual({ mounts: ["/opt/x"], refused: [] })
  })
  test("never your home directory, / or pine·trie's own directories; a folder inside one is fine", () => {
    const planned = planHostMounts({
      roots: [
        "/",
        "/Users",
        "/Users/ada",
        "/Users/ada/.config",
        "/Users/ada/.local/share/pinetrie",
        "/Users/ada/.config/pinetrie/skills/plan",
        "/x/a,b:c",
      ],
      project: null,
      home,
      own,
    })
    // Docker's API takes any path: a comma and a colon are no trouble.
    expect(planned.mounts).toEqual([
      "/Users/ada/.config/pinetrie/skills/plan",
      "/x/a,b:c",
    ])
    expect(planned.refused.map(r => `${r.path}: ${r.reason}`)).toEqual([
      "/: it is the file system's root",
      "/Users: it is, or holds, your home directory",
      "/Users/ada: it is, or holds, your home directory",
      "/Users/ada/.config: it is, or holds, one of pine·trie's own directories",
      "/Users/ada/.local/share/pinetrie: it is, or holds, one of pine·trie's own directories",
    ])
  })
})
