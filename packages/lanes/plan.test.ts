import path from "node:path"
import { BASE_SNAPSHOT, pointId, snapshotId, threadIdFor } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import { forkSetup } from "./history-port.ts"
import {
  BASE_FORMAT,
  BASE_LANE,
  configChangeNote,
  configWidenings,
  effectiveLaneConfig,
  imageRefusal,
  innerDockerDataRootStep,
  innerDockerDataRootsAfterClone,
  innerDockerDataRootsAfterRunEnd,
  isBaseCurrent,
  isCopyableBase,
  type LaneSpec,
  type LaneStep,
  laneContainer,
  laneGitConfig,
  laneIgnores,
  NO_GRANTS,
  NO_INNER_DOCKER_DATA_ROOTS,
  NOTHING_ATTACHED,
  parseBaseFacts,
  planBaseFacts,
  planContainer,
  planDisk,
  planExclude,
  planFork,
  planHostMounts,
  planImages,
  planInnerDockerDataRootSource,
  planLaneStart,
  planLinks,
  planMounts,
  planProjectDir,
  planShape,
  planShared,
  planSnapshot,
  type Step,
  sessionFiles,
  shapeSpecHash,
  slotMounts,
  specHash,
} from "./plan.ts"

const LANE = threadIdFor("1")
const C1 = pointId("c1")
const C2 = pointId("c2")
const HOME = "/Users/ada"
const SESSION = "/xdg/data/pinetrie/sessions/p"
const files = sessionFiles(SESSION)

const parts = {
  hostWorkingCopy: "/p",
  pinetrie: "/opt/pinetrie",
  runtime: `${files.lanes.runtime}/abc`,
  ignoreDir: files.lanes.laneGit,
  links: [{ source: "/k", target: "/k", readonly: true }],
  grants: [],
  shared: [],
  hostPaths: [],
}

const spec: LaneSpec = {
  lane: LANE,
  image: "pinetrie-lane:abc",
  imagePath: "/usr/local/bin:/usr/bin:/bin",
  mounts: planMounts(parts),
  grants: { nested: false, hostPorts: [], env: [] },
  attached: NOTHING_ATTACHED,
  identity: { name: "agent", email: "agent@pinetrie" },
  memory: "2G",
  states: false,
}

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

test("sessionFiles: every file of a session under its data directory", () => {
  const { store, lanes } = sessionFiles(SESSION)
  for (const f of [store, ...Object.values(lanes)])
    expect(path.dirname(f)).toBe(SESSION)
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
        home,
        own,
      }),
    ).toEqual({ mounts: ["/Users/ada/ai/duane", "/opt/x"], refused: [] })
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

describe("planShared: which shared directories apply, and what the host does for them", () => {
  const none = new Set<string>()
  const facts = {
    entries: [".plans", "notes/", ".plans", "shared/data"],
    exists: new Set([".plans"]),
    tracked: none,
    ignored: new Set([".plans"]),
  }
  test("in order, normalized, each once", () => {
    expect(planShared(facts).shared).toEqual([".plans", "notes", "shared/data"])
  })
  test("created when missing; excluded in your repo unless already ignored", () => {
    const planned = planShared(facts)
    expect(planned.create).toEqual(["notes", "shared/data"])
    expect(planned.exclude).toEqual(["notes", "shared/data"])
  })
  test("refused, with a reason: absolute, leaving the project, in a repo or dependencies, tracked", () => {
    const planned = planShared({
      ...facts,
      entries: [
        "/abs",
        "../out",
        ".",
        ".jj/plans",
        ".git",
        "node_modules/y",
        "docs",
      ],
      tracked: new Set(["docs"]),
    })
    expect(planned.shared).toEqual([])
    expect(planned.refused.map(r => `${r.path}: ${r.reason}`)).toEqual([
      "/abs: it is absolute",
      "../out: it leaves the project",
      ".: it leaves the project",
      ".jj/plans: it is inside .jj",
      ".git: it is inside .git",
      "node_modules/y: it is inside node_modules",
      "docs: it holds files jj tracks",
    ])
  })
})

test("planLinks: the directory beside the project that a link leaves for, mounted where it resolves", () => {
  expect(
    planLinks("/w/pinetrie", [
      { path: "node_modules/@k/a", target: "../../../kyneta/packages/a" },
      {
        path: "packages/x/node_modules/@k/a",
        target: "../../../../kyneta/packages/b",
      },
      { path: "node_modules/far", target: "../../../other/c" },
      { path: "node_modules/in", target: "../packages/in" },
      { path: "node_modules/abs", target: "/opt/abs" },
    ]),
  ).toEqual([
    { source: "/other", target: "/other", readonly: true },
    { source: "/w/kyneta", target: "/kyneta", readonly: true },
  ])
})

const argvs = (steps: readonly (LaneStep | Step)[]) =>
  steps.map(s =>
    s.in === "lane"
      ? `lane: ${s.argv.join(" ")}`
      : s.op.kind === "run"
        ? `runtime: run ${s.op.shape.name}`
        : `runtime: ${JSON.stringify(s.op)}`,
  )

test("planFork: the container and disk deleted, the restore, the container, the old config folder gone, then the adapter's setup", () => {
  const { steps } = planFork({
    source: { snapshot: snapshotId("e1") },
    spec,
    env: {},
    setup: forkSetup(null, [{ in: "lane", argv: ["setup"] }]),
    innerDockerDataRoot: { kind: "keep" },
  })
  expect(argvs(steps)).toEqual([
    `runtime: ${JSON.stringify({ kind: "remove", container: `pinetrie-${LANE}` })}`,
    `runtime: ${JSON.stringify({ kind: "delete", lane: LANE })}`,
    `runtime: ${JSON.stringify({ kind: "restore", lane: LANE, from: "e1" })}`,
    `runtime: run pinetrie-${LANE}`,
    "lane: sh -c rm -rf /workspace/.pineta-lane",
    "lane: setup",
  ])
})

test("planFork: a nested lane's data root is made after the delete and before the container runs", () => {
  const nested: LaneSpec = { ...spec, grants: { ...spec.grants, nested: true } }
  const other = threadIdFor("2")
  const { steps } = planFork({
    source: { snapshot: snapshotId("e1") },
    spec: nested,
    env: {},
    setup: forkSetup(null, []),
    innerDockerDataRoot: { kind: "clone", cloneFromLane: other, atRunEnd: 3 },
  })
  expect(argvs(steps).slice(0, 4)).toEqual([
    `runtime: ${JSON.stringify({ kind: "remove", container: `pinetrie-${LANE}` })}`,
    `runtime: ${JSON.stringify({ kind: "delete", lane: LANE })}`,
    `runtime: ${JSON.stringify({ kind: "innerDockerDataRoot", lane: LANE, cloneFromLane: other })}`,
    `runtime: ${JSON.stringify({ kind: "restore", lane: LANE, from: "e1" })}`,
  ])
})

describe("a nested lane's inner Docker data root: the last run's lane's, cloned", () => {
  const [A, B, C] = [threadIdFor("a"), threadIdFor("b"), threadIdFor("c")]
  const afterRun = (...lanes: (typeof A)[]) =>
    lanes.reduce(innerDockerDataRootsAfterRunEnd, NO_INNER_DOCKER_DATA_ROOTS)
  const atStart = (roots: typeof NO_INNER_DOCKER_DATA_ROOTS, lane: typeof A) =>
    planInnerDockerDataRootSource({
      roots,
      lane,
      clonedAtRunEnd: roots.clonedAtRunEnd.get(lane) ?? null,
      forkSourceLane: null,
    })
  test("with no run ended, every lane keeps its own", () => {
    expect(atStart(NO_INNER_DOCKER_DATA_ROOTS, A)).toEqual({ kind: "keep" })
  })
  test("the last run's lane keeps its own; another clones it, then keeps it until another run ends", () => {
    const roots = afterRun(A, B)
    expect(atStart(roots, B)).toEqual({ kind: "keep" })
    const source = atStart(roots, A)
    expect(source).toEqual({ kind: "clone", cloneFromLane: B, atRunEnd: 2 })
    const cloned = innerDockerDataRootsAfterClone(roots, A, source)
    expect(atStart(cloned, A)).toEqual({ kind: "keep" })
    expect(atStart(innerDockerDataRootsAfterRunEnd(cloned, C), A)).toEqual({
      kind: "clone",
      cloneFromLane: C,
      atRunEnd: 3,
    })
  })
  test("a fork clones the last run's lane, else its source lane, else keeps", () => {
    const atFork = (
      roots: typeof NO_INNER_DOCKER_DATA_ROOTS,
      lane: typeof A,
      forkSourceLane: typeof A | null,
    ) =>
      planInnerDockerDataRootSource({
        roots,
        lane,
        clonedAtRunEnd: null,
        forkSourceLane,
      })
    expect(atFork(afterRun(B), A, C)).toEqual({
      kind: "clone",
      cloneFromLane: B,
      atRunEnd: 1,
    })
    // The fork's delete dropped the last run's own: its source's instead.
    expect(atFork(afterRun(A), A, C)).toEqual({
      kind: "clone",
      cloneFromLane: C,
      atRunEnd: null,
    })
    expect(atFork(NO_INNER_DOCKER_DATA_ROOTS, A, null)).toEqual({
      kind: "keep",
    })
    expect(atFork(NO_INNER_DOCKER_DATA_ROOTS, A, A)).toEqual({ kind: "keep" })
  })
  test("only a nested lane's start makes its data root", () => {
    const keep = { kind: "keep" } as const
    const start = { kind: "container", plan: "start" } as const
    expect(innerDockerDataRootStep(spec, start, keep)).toBeNull()
    expect(
      innerDockerDataRootStep(
        { ...spec, grants: { ...spec.grants, nested: true } },
        start,
        keep,
      ),
    ).toEqual({
      in: "runtime",
      op: { kind: "innerDockerDataRoot", lane: LANE, cloneFromLane: null },
    })
  })
})

test("planFork restores from the adapter's snapshot when it names one", () => {
  const { steps } = planFork({
    source: { snapshot: snapshotId("e1") },
    spec,
    env: {},
    setup: forkSetup(snapshotId("line-1"), []),
    innerDockerDataRoot: { kind: "keep" },
  })
  expect(steps[2]).toEqual({
    in: "runtime",
    op: { kind: "restore", lane: LANE, from: "line-1" },
  })
})

test("planDisk: a new disk, or one restored from a snapshot; then the container, from the spec's shape", () => {
  const disk = (from: typeof BASE_SNAPSHOT | null) =>
    planDisk({ spec, env: {}, from })
  expect(disk(null)).toEqual([
    { in: "runtime", op: { kind: "create", lane: LANE } },
    { in: "runtime", op: { kind: "run", shape: planShape(spec, {}) } },
  ])
  expect(disk(BASE_SNAPSHOT)[0]).toEqual({
    in: "runtime",
    op: { kind: "restore", lane: LANE, from: BASE_SNAPSHOT },
  })
})

test("planSnapshot: sync comes before the snapshot", () => {
  expect(planSnapshot({ lane: LANE, snapshot: snapshotId("e2") })).toEqual([
    { in: "lane", argv: ["sync"] },
    {
      in: "runtime",
      op: { kind: "snapshot", lane: LANE, snapshot: snapshotId("e2") },
    },
  ])
})

describe("the base: the base before it, checked out at accepted work", () => {
  test("isBaseCurrent: the same states, made the way bases are now", () => {
    const base = { points: [C1], format: BASE_FORMAT }
    expect(isBaseCurrent(base, [C1])).toBe(true)
    expect(isBaseCurrent(base, [C2])).toBe(false)
    expect(isBaseCurrent({ ...base, format: BASE_FORMAT - 1 }, [C1])).toBe(
      false,
    )
    expect(isBaseCurrent(null, [C1])).toBe(false)
  })
  test("isCopyableBase: a base made the way they are now; one from before was made on a layer", () => {
    expect(isCopyableBase({ points: [C1], format: BASE_FORMAT })).toBe(true)
    expect(
      isCopyableBase(
        parseBaseFacts(JSON.stringify({ commits: [C1], key: "k" })),
      ),
    ).toBe(false)
    expect(isCopyableBase(null)).toBe(false)
  })
  test("planBaseFacts: its states and its format, read back", () => {
    const [written] = argvs([planBaseFacts([C1])])
    expect(written).toContain(
      JSON.stringify({ commits: [C1], format: BASE_FORMAT }),
    )
  })
})

describe("the host: its root", () => {
  test("planProjectDir: jj's root, a jj project; else git's, else the folder, a folder project; never missing, your home directory or /", () => {
    const facts = {
      dir: "/p/sub",
      isDirectory: true,
      jjRoot: "/p",
      gitTop: null,
      home: HOME,
    }
    expect(planProjectDir(facts)).toEqual({ kind: "jj", root: "/p" })
    expect(planProjectDir({ ...facts, jjRoot: null, gitTop: "/p" })).toEqual({
      kind: "folder",
      root: "/p",
    })
    expect(planProjectDir({ ...facts, jjRoot: null })).toEqual({
      kind: "folder",
      root: "/p/sub",
    })
    expect(planProjectDir({ ...facts, isDirectory: false })).toEqual({
      kind: "refused",
      refusal: { kind: "missing", dir: "/p/sub" },
    })
    expect(planProjectDir({ ...facts, jjRoot: HOME })).toEqual({
      kind: "refused",
      refusal: { kind: "unsafe", root: HOME },
    })
    expect(planProjectDir({ ...facts, jjRoot: null, gitTop: "/" })).toEqual({
      kind: "refused",
      refusal: { kind: "unsafe", root: "/" },
    })
  })
  test("planExclude: adds each missing line once, on a line of its own", () => {
    expect(planExclude("", ["/.notes/"])).toBe("/.notes/\n")
    expect(planExclude("# x", ["/.notes/", "/.plans/"])).toBe(
      "# x\n/.notes/\n/.plans/\n",
    )
    expect(planExclude("a\n/.notes/\n", ["/.notes/", "/.plans/"])).toBe(
      "a\n/.notes/\n/.plans/\n",
    )
    expect(planExclude("a\n/.notes/\n", ["/.notes/"])).toBeNull()
  })
  test("planContainer: create, recreate from another spec, start, or nothing", () => {
    const decide = (
      state: "running" | "stopped" | "missing",
      label: string | null,
    ) => planContainer({ facts: { state, label }, want: "h1" })
    expect(decide("missing", null)).toBe("create")
    expect(decide("stopped", "h0")).toBe("recreate")
    expect(decide("running", null)).toBe("recreate")
    expect(decide("stopped", "h1")).toBe("start")
    expect(decide("running", "h1")).toBe("running")
  })
  test("planLaneStart: a fork owed runs whatever is there", () => {
    for (const container of ["create", "recreate", "start", "running"] as const)
      expect(planLaneStart({ fork: "owed", container, made: null })).toEqual({
        kind: "fork",
      })
  })

  test("planLaneStart: a begun lane's container there is started; one to make asks for its facts", () => {
    expect(
      planLaneStart({ fork: "begun", container: "running", made: null }),
    ).toEqual({ kind: "container", plan: "running" })
    expect(
      planLaneStart({ fork: "begun", container: "create", made: null }),
    ).toEqual({ kind: "gather" })
  })

  describe("planLaneStart: a begun lane whose container must be made", () => {
    const made = {
      disk: false,
      own: [snapshotId("e2"), snapshotId("e1")],
      recorded: true,
      kept: snapshotId("turn-1"),
      listed: new Set([snapshotId("e1"), snapshotId("turn-1")]),
    }
    const start = (m: Partial<typeof made>, container = "create" as const) =>
      planLaneStart({ fork: "begun", container, made: { ...made, ...m } })

    test("planLaneStart: a disk starts from it", () => {
      expect(start({ disk: true })).toEqual({ kind: "disk", recreate: false })
      expect(
        planLaneStart({
          fork: "begun",
          container: "recreate",
          made: { ...made, disk: true },
        }),
      ).toEqual({ kind: "disk", recreate: true })
    })

    test("planLaneStart: with no disk, the newest of its snapshots that exists, then its kept state's", () => {
      expect(start({})).toEqual({
        kind: "snapshot",
        from: "e1",
        recreate: false,
      })
      expect(start({ own: [] })).toEqual({
        kind: "snapshot",
        from: "turn-1",
        recreate: false,
      })
    })

    test("planLaneStart: with nothing kept, a lane that recorded no turn forks again, and one that did is retired", () => {
      const gone = { listed: new Set<ReturnType<typeof snapshotId>>() }
      expect(start({ ...gone, recorded: false })).toEqual({ kind: "fork" })
      expect(start(gone)).toEqual({ kind: "retired" })
    })
  })
})

test("planImages: pinetrie's image is pinned to the app's Playwright, a project's is not", () => {
  const input = {
    pinetrie: {
      file: "/pinetrie/Containerfile",
      content: "FROM node",
      sources: ["int main"],
    },
    project: {
      file: "/p/pinetrie.Containerfile",
      content: "FROM alpine",
      sources: [],
    },
    jjVersion: "0.44.0",
    playwrightVersion: "1.56.0",
  }
  const plans = planImages(input)
  const bumped = planImages({ ...input, playwrightVersion: "1.57.0" })
  expect(plans.pinetrie.buildArgs).toEqual([
    "JJ_VERSION=0.44.0",
    "PLAYWRIGHT_VERSION=1.56.0",
  ])
  expect(bumped.pinetrie.tag).not.toBe(plans.pinetrie.tag)
  expect(plans.project?.buildArgs).toEqual(["JJ_VERSION=0.44.0"])
  expect(bumped.project?.tag).toBe(plans.project?.tag)
  expect(planImages({ ...input, project: null }).project).toBeNull()
})

test("planImages: a change to a file the build copies in is a new image", () => {
  const input = {
    pinetrie: {
      file: "/pinetrie/Containerfile",
      content: "FROM node",
      sources: ["a"],
    },
    project: null,
    jjVersion: "0.44.0",
    playwrightVersion: "1.56.0",
  }
  const changed = { ...input, pinetrie: { ...input.pinetrie, sources: ["b"] } }
  expect(planImages(changed).pinetrie.tag).not.toBe(
    planImages(input).pinetrie.tag,
  )
})

test("imageRefusal: git 2.41 or later, named when missing or old", () => {
  expect(imageRefusal("git version 2.49.1\n")).toBeNull()
  expect(imageRefusal("git version 3.0.0")).toBeNull()
  expect(imageRefusal("git version 2.40.9")).toContain("git 2.40")
  expect(imageRefusal("")).toContain("has no git")
})

test("the base's scratch lane is no thread's: nothing that takes a thread takes it", () => {
  const setup = planFork({
    source: { snapshot: snapshotId("e1") },
    // @ts-expect-error: a fork is a thread's lane's
    spec: { ...spec, lane: BASE_LANE },
    env: {},
    setup: forkSetup(null, []),
    innerDockerDataRoot: { kind: "keep" },
  })
  expect([laneContainer(BASE_LANE), setup.steps.length]).toEqual([
    "pinetrie-base-scratch",
    5,
  ])
})

describe("config as a fact of a state: accepted work's, narrowed by the lane's", () => {
  const mount = { source: "/p/d", target: "/d", readonly: true }
  const accepted = {
    grants: {
      ssh: true,
      nested: true,
      hostPorts: [5432, 6379],
      env: ["A", "B"],
      mounts: [mount],
    },
    shared: [".plans", "notes"],
  }
  const none = { grants: NO_GRANTS, shared: [] }

  test("effectiveLaneConfig: what a lane dropped from its base's copy, key by key, it gives up", () => {
    expect(
      effectiveLaneConfig(accepted, {
        base: accepted,
        own: {
          grants: {
            ssh: false,
            nested: true,
            hostPorts: [5432, 8080],
            env: ["B", "C"],
            mounts: [mount, { source: "/x", target: "/x", readonly: true }],
          },
          shared: [".plans", "other"],
        },
      }),
    ).toEqual({
      grants: {
        ssh: false,
        nested: true,
        hostPorts: [5432],
        env: ["B"],
        mounts: [mount],
      },
      shared: [".plans"],
    })
  })

  test("effectiveLaneConfig: a grant accepted after the lane started reaches it; one its own copy adds never does", () => {
    const later = {
      grants: { ...accepted.grants, env: [...accepted.grants.env, "LATER"] },
      shared: accepted.shared,
    }
    const own = {
      grants: { ...accepted.grants, env: [...accepted.grants.env, "MINE"] },
      shared: accepted.shared,
    }
    expect(
      effectiveLaneConfig(later, { base: accepted, own }).grants.env,
    ).toEqual(["A", "B", "LATER"])
  })

  test("effectiveLaneConfig: a lane with no copy read gets accepted work's", () => {
    expect(effectiveLaneConfig(accepted, null)).toEqual(accepted)
  })

  test("configWidenings: what the second lets that the first does not, key by key", () => {
    expect(configWidenings(none, accepted)).toEqual([
      { kind: "ssh" },
      { kind: "nested" },
      { kind: "env", name: "A" },
      { kind: "env", name: "B" },
      { kind: "mount", target: "/d" },
      { kind: "hostPort", port: 5432 },
      { kind: "hostPort", port: 6379 },
      { kind: "shared", path: ".plans" },
      { kind: "shared", path: "notes" },
    ])
    expect(configWidenings(accepted, none)).toEqual([])
    expect(configWidenings(accepted, accepted)).toEqual([])
  })

  test("configChangeNote: what a lane gave up applies from its next run; what it asked for waits for acceptance", () => {
    const written = {
      grants: { ...accepted.grants, ssh: false, env: ["A", "B", "TOKEN"] },
      shared: accepted.shared,
    }
    expect(configChangeNote(accepted, written)).toBe(
      "pine·trie: this lane gives up your ssh identity from its next run.\npine·trie: this lane gets $TOKEN only once this change to pinetrie.json is accepted.",
    )
    expect(configChangeNote(accepted, accepted)).toBeNull()
  })
})
