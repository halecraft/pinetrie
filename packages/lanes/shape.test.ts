import { describe, expect, test } from "vitest"
import { HOME, LANE, spec } from "./fixtures.ts"
import {
  laneGitConfig,
  laneIgnores,
  planShape,
  shapeSpecHash,
  specHash,
} from "./shape.ts"

describe("planShape: a lane's container, as any runtime would make it", () => {
  const shape = planShape(spec, { HOME, SECRET: "s", GITHUB_TOKEN: "t" })
  test("named for the lane, on the lane's disk, with every mount planMounts gave", () => {
    expect(shape).toMatchObject({
      name: `pinetrie-${LANE}`,
      lane: LANE,
      image: "pinetrie-lane:abc",
      memory: "2G",
      mounts: spec.mounts,
      hostSocket: null,
      starts: [],
    })
  })
  test("every repo in the lane ignores what the ignore file lists, through git's own variables", () => {
    expect(shape.env).toMatchObject({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.excludesFile",
      GIT_CONFIG_VALUE_0: "/pinetrie-git/ignore",
      GIT_CONFIG_SYSTEM: "/pinetrie-git/gitconfig",
    })
    expect(laneGitConfig()).toBe(
      "[safe]\n\tdirectory = /mnt/host-working-copy\n\tdirectory = /mnt/host-working-copy/.git\n",
    )
    // pnpm's store, at the disk's root, is never tracked.
    expect(laneIgnores([".plans", "notes/shared"])).toBe(
      "/.pinetrie-lane/\n/.jj/\n/.git/\n/lost+found/\n/.pnpm-store/\n/.plans/\n/notes/shared/\n",
    )
  })
  test("never your home directory, and no variable no grant names", () => {
    expect(JSON.stringify(shape)).not.toContain(HOME)
    expect(Object.keys(shape.env)).not.toContain("SECRET")
    expect(Object.keys(shape.env)).not.toContain("GITHUB_TOKEN")
  })
  test("each grant applies", () => {
    const granted = planShape(
      {
        ...spec,
        grants: {
          nested: false,
          hostPorts: [],
          env: ["GITHUB_TOKEN", "MISSING"],
        },
      },
      { GITHUB_TOKEN: "t" },
    )
    expect(granted.env.GITHUB_TOKEN).toBe("t")
    expect(Object.keys(granted.env)).not.toContain("MISSING")
  })
  test("what is attached joins the mounts and variables, before pine·trie's own", () => {
    const attached = planShape(
      {
        ...spec,
        attached: {
          hostSocket: "/run/pinetrie/host.sock",
          mounts: [
            { source: "/h/ssh", target: "/pinetrie-ssh", readonly: true },
          ],
          env: { SSH_AUTH_SOCK: "/run/a.sock", JJ_USER: "not this" },
          starts: ["hop serve"],
        },
      },
      {},
    )
    expect(attached.mounts.at(-1)).toEqual({
      source: "/h/ssh",
      target: "/pinetrie-ssh",
      readonly: true,
    })
    expect(attached).toMatchObject({
      hostSocket: "/run/pinetrie/host.sock",
      starts: ["hop serve"],
    })
    expect(attached.env.SSH_AUTH_SOCK).toBe("/run/a.sock")
    expect(attached.env.JJ_USER).toBe("agent")
  })
  test("its home on its disk, and the shared directories", () => {
    const sharing = planShape(
      {
        ...spec,
        mounts: [
          ...spec.mounts,
          { source: "/p/.plans", target: "/workspace/.plans", readonly: false },
          {
            source: "/p/n",
            target: "/workspace/notes/shared",
            readonly: false,
          },
        ],
        grants: { ...spec.grants, env: ["HOME"] },
      },
      { HOME },
    )
    expect(sharing.env).toMatchObject({
      HOME: "/workspace/.pinetrie-lane/home",
      PINETRIE_SHARED: "/workspace/.plans\n/workspace/notes/shared",
    })
  })
  test("jj's identity and config, no editor, and the runtime's bin last on the PATH", () => {
    expect(shape.env).toMatchObject({
      JJ_USER: "agent",
      JJ_EMAIL: "agent@pinetrie",
      JJ_CONFIG: "/workspace/.pinetrie-lane/jj.toml",
      JJ_EDITOR: "false",
      PATH: "/usr/local/bin:/usr/bin:/bin:/pinetrie-runtime/bin",
    })
  })
})

test("shapeSpecHash: the hash of the runtime's spec, changed when it changes", () => {
  const runtime = { runSpec: (s: { image: string }) => ["run", s.image] }
  const shape = planShape(spec, {})
  expect(shapeSpecHash(runtime, shape)).toBe(
    specHash(["run", "pinetrie-lane:abc"]),
  )
  expect(
    shapeSpecHash(runtime, { ...shape, image: "pinetrie-lane:def" }),
  ).not.toBe(shapeSpecHash(runtime, shape))
})
