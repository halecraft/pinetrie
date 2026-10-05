import {
  BASE_SNAPSHOT,
  baseMessage,
  commitId,
  laneNameForThread,
  shellWord,
  snapshotId,
  type ThreadName,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  DEFAULT_LINE,
  decodeLaneConfig,
  FETCHED_REF,
  fetchById,
  forkConfig,
  imageRefusal,
  isBookmarkName,
  type LaneSpec,
  type LaneStep,
  laneIgnores,
  lineConfig,
  mountArgs,
  NO_GRANTS,
  planBaseRefresh,
  planBundle,
  planContainer,
  planDisk,
  planExclude,
  planFork,
  planForkSetup,
  planHost,
  planHostMounts,
  planImages,
  planJoins,
  planLinks,
  planMerge,
  planMounts,
  planProjectDir,
  planRoot,
  planRun,
  planShared,
  planSnapshot,
  planStartFrom,
  planTurnCommit,
  SPEC_LABEL,
  specHashOf,
} from "./index.ts"

const LANE = laneNameForThread("1")
const C1 = commitId("c1")
const C2 = commitId("c2")
const HOME = "/Users/ada"
const paths = { volumes: "/v", snapshots: "/p/.pinetrie/snapshots" }

const parts = {
  hostWorkingCopy: "/p",
  pinetrie: "/opt/pinetrie",
  runtime: "/p/.pinetrie/runtime/abc",
  ignoreDir: "/p/.pinetrie/lane-git",
  links: [{ source: "/k", target: "/k", readonly: true }],
  grants: [],
  shared: [],
  hostPaths: [],
}

const spec: LaneSpec = {
  lane: LANE,
  volume: "pinetrie-t-1",
  image: "pinetrie-lane:abc",
  imagePath: "/usr/local/bin:/usr/bin:/bin",
  mounts: planMounts(parts),
  grants: { ssh: false, env: [] },
  identity: { name: "agent", email: "agent@pinetrie" },
  memory: "2G",
}

/** Each `--mount` value, and each `-e` value, from a `container run`. */
const valuesOf = (argv: readonly string[], flag: string) =>
  argv.flatMap((a, i) => (a === flag ? [argv[i + 1] ?? ""] : []))

describe("planMounts: every host path a lane sees, in one list", () => {
  test("your working copy, pinetrie's own and the ignore file's directory, read-only", () => {
    expect(planMounts(parts)).toEqual([
      { source: "/p", target: "/mnt/host-working-copy", readonly: true },
      { source: "/opt/pinetrie", target: "/pinetrie", readonly: true },
      {
        source: "/p/.pinetrie/runtime/abc",
        target: "/pinetrie-runtime",
        readonly: true,
      },
      {
        source: "/p/.pinetrie/lane-git",
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

test("mountArgs: --mount; -v for a path with a comma; neither for a comma and a colon", () => {
  expect(mountArgs({ source: "/a b", target: "/t", readonly: true })).toEqual([
    "--mount",
    "type=bind,source=/a b,target=/t,readonly",
  ])
  expect(mountArgs({ source: "/a", target: "/t", readonly: false })).toEqual([
    "--mount",
    "type=bind,source=/a,target=/t",
  ])
  expect(
    mountArgs({ source: "/a,b", target: "/t/a,b", readonly: true }),
  ).toEqual(["-v", "/a,b:/t/a,b:ro"])
  expect(() =>
    mountArgs({ source: "/a,b:c", target: "/t", readonly: true }),
  ).toThrow("both a comma and a colon")
})

describe("planHostMounts: granted host paths, and the ones never mounted", () => {
  const home = "/Users/ada"
  const agentDir = "/Users/ada/.pi/agent"
  test("nested roots collapse into the outermost", () => {
    expect(
      planHostMounts({
        roots: [
          "/Users/ada/ai/duane",
          "/Users/ada/ai/duane/skills/plan",
          "/opt/x",
        ],
        home,
        agentDir,
      }),
    ).toEqual({ mounts: ["/Users/ada/ai/duane", "/opt/x"], refused: [] })
  })
  test("never your home directory, / or pi's agent directory; a package inside the agent directory is fine", () => {
    const planned = planHostMounts({
      roots: [
        "/",
        "/Users",
        "/Users/ada",
        "/Users/ada/.pi",
        "/Users/ada/.pi/agent/npm/node_modules/pi-subagents",
        "/x/a,b:c",
      ],
      home,
      agentDir,
    })
    expect(planned.mounts).toEqual([
      "/Users/ada/.pi/agent/npm/node_modules/pi-subagents",
    ])
    expect(planned.refused.map(r => `${r.path}: ${r.reason}`)).toEqual([
      "/: it is the file system's root",
      "/Users: it is, or holds, your home directory",
      "/Users/ada: it is, or holds, your home directory",
      "/Users/ada/.pi: it is, or holds, pi's agent directory",
      "/x/a,b:c: it has both a comma and a colon, which container cannot mount",
    ])
  })
})

describe("planRun: a lane's container", () => {
  const argv = planRun(spec, { HOME, SECRET: "s", GITHUB_TOKEN: "t" })
  test("--init, the lane's disk at /workspace, and every mount planMounts gave", () => {
    expect(argv.slice(0, 5)).toEqual([
      "run",
      "--label",
      `${SPEC_LABEL}=${specHashOf(spec, { HOME, SECRET: "s", GITHUB_TOKEN: "t" })}`,
      "-d",
      "--init",
    ])
    expect(valuesOf(argv, "-v")).toEqual(["pinetrie-t-1:/workspace"])
    expect(valuesOf(argv, "--mount")).toEqual(
      spec.mounts.map(m => mountArgs(m)[1]),
    )
  })
  test("every repo in the lane ignores what the ignore file lists, through git's own variables", () => {
    expect(valuesOf(argv, "-e")).toEqual(
      expect.arrayContaining([
        "GIT_CONFIG_COUNT=1",
        "GIT_CONFIG_KEY_0=core.excludesFile",
        "GIT_CONFIG_VALUE_0=/pinetrie-git/ignore",
      ]),
    )
    expect(laneIgnores([".plans", "notes/shared"])).toBe(
      "/.pinetrie-lane/\n/lost+found/\n/.plans/\n/notes/shared/\n",
    )
  })
  test("the spec label: stable, and changed by a mount or the image", () => {
    const hash = specHashOf(spec, {})
    expect(specHashOf(spec, {})).toBe(hash)
    expect(
      specHashOf(
        {
          ...spec,
          mounts: planMounts({ ...parts, hostPaths: ["/opt/skills"] }),
        },
        {},
      ),
    ).not.toBe(hash)
    expect(specHashOf({ ...spec, image: "pinetrie-lane:def" }, {})).not.toBe(
      hash,
    )
  })
  test("never your home directory, and no variable no grant names", () => {
    expect(argv.join(" ")).not.toContain(HOME)
    expect(argv.join(" ")).not.toContain("SECRET")
    expect(argv).not.toContain("--ssh")
  })
  test("each grant applies", () => {
    const granted = planRun(
      { ...spec, grants: { ssh: true, env: ["GITHUB_TOKEN", "MISSING"] } },
      { GITHUB_TOKEN: "t" },
    )
    expect(granted).toContain("--ssh")
    expect(valuesOf(granted, "-e")).toContain("GITHUB_TOKEN=t")
    expect(valuesOf(granted, "-e").some(e => e.startsWith("MISSING"))).toBe(
      false,
    )
  })
  test("jj's identity and config, no editor, and the runtime's bin last on the PATH", () => {
    const env = valuesOf(argv, "-e")
    expect(env).toEqual(
      expect.arrayContaining([
        "JJ_USER=agent",
        "JJ_EMAIL=agent@pinetrie",
        "JJ_CONFIG=/workspace/.pinetrie-lane/jj.toml",
        "JJ_EDITOR=false",
        "PATH=/usr/local/bin:/usr/bin:/bin:/pinetrie-runtime/bin",
      ]),
    )
    expect(argv.slice(-4)).toEqual([
      "/workspace",
      "pinetrie-lane:abc",
      "sleep",
      "infinity",
    ])
  })
})

describe("lineConfig: the project's names win, and a bad one falls back", () => {
  const none = { onto: null, wipPrefix: null, publish: null }
  test("defaults with nothing set", () => {
    expect(lineConfig(none, none)).toEqual({ line: DEFAULT_LINE, refused: [] })
  })
  test("the project's name wins over the user's", () => {
    expect(
      lineConfig(
        { onto: "mine", wipPrefix: "draft/", publish: "master" },
        { onto: "trunk", wipPrefix: null, publish: null },
      ).line,
    ).toEqual({ onto: "trunk", wipPrefix: "draft/", publish: "master" })
  })
  test("a name that is no bookmark falls back, saying why", () => {
    const r = lineConfig(none, {
      onto: "has space",
      wipPrefix: "a..b/",
      publish: "a:b",
    })
    expect(r.line).toEqual(DEFAULT_LINE)
    expect(r.refused).toHaveLength(3)
    expect(r.refused[0]).toContain("has space")
  })
  test("isBookmarkName: git's rules", () => {
    for (const ok of ["pinetrie-onto", "wip/x", "a.b"])
      expect(isBookmarkName(ok)).toBe(true)
    for (const bad of ["", "a b", "a..b", "-a", "a/", "a.lock", "a@b", "a:b"])
      expect(isBookmarkName(bad)).toBe(false)
  })
})

describe("decodeLaneConfig: grants, the install and shared directories, total", () => {
  const empty = (pnpm: boolean) => decodeLaneConfig(undefined, "/p", pnpm)
  test("nothing, or anything malformed, grants and shares nothing", () => {
    for (const json of [undefined, {}, { lanes: 3 }])
      expect(decodeLaneConfig(json, "/p", false)).toEqual({
        grants: NO_GRANTS,
        install: null,
        shared: [],
        offers: { onto: null, wipPrefix: null, publish: null },
      })
    expect(
      decodeLaneConfig(
        {
          lanes: {
            ssh: "yes",
            env: ["OK_1", 4, "no-dash", "A=B"],
            mounts: [{ source: "d" }, { source: "d", target: "rel" }],
            shared: [".plans", 3, null],
          },
        },
        "/p",
        false,
      ),
    ).toEqual({
      grants: { ssh: false, env: ["OK_1"], mounts: [] },
      install: null,
      shared: [".plans"],
      offers: { onto: null, wipPrefix: null, publish: null },
    })
  })
  test("offers: the line's names, as written", () => {
    expect(
      decodeLaneConfig(
        { offers: { onto: "trunk", wipPrefix: 3, publish: "master" } },
        "/p",
        false,
      ).offers,
    ).toEqual({ onto: "trunk", wipPrefix: null, publish: "master" })
  })
  test("mount sources are relative to the project", () => {
    expect(
      decodeLaneConfig(
        { lanes: { ssh: true, mounts: [{ source: "../d", target: "/d" }] } },
        "/p/app",
        false,
      ).grants,
    ).toEqual({
      ssh: true,
      env: [],
      mounts: [{ source: "/p/d", target: "/d", readonly: true }],
    })
  })
  test("the install: the config's, else pnpm's for a pnpm repo, else none", () => {
    expect(
      decodeLaneConfig(
        { lanes: { install: "npm ci", installWhen: "package-lock.json" } },
        "/p",
        true,
      ).install,
    ).toEqual({ command: "npm ci", lockfile: "package-lock.json" })
    expect(
      decodeLaneConfig({ lanes: { install: "npm ci" } }, "/p", true).install,
    ).toEqual({
      command: "pnpm install --frozen-lockfile",
      lockfile: "pnpm-lock.yaml",
    })
    expect(empty(true).install?.command).toBe("pnpm install --frozen-lockfile")
    expect(empty(false).install).toBeNull()
  })
})

describe("planShared: which shared directories apply, and what the host does for them", () => {
  const none = new Set<string>()
  const facts = {
    user: [".plans", "notes/"],
    project: [".plans", "shared/data"],
    exists: new Set([".plans"]),
    tracked: none,
    ignored: new Set([".plans"]),
  }
  test("the user's, then the project's, normalized, each once", () => {
    expect(planShared(facts).shared).toEqual([".plans", "notes", "shared/data"])
  })
  test("created when missing; excluded in your repo unless already ignored", () => {
    const planned = planShared(facts)
    expect(planned.create).toEqual(["notes", "shared/data"])
    expect(planned.exclude).toEqual(["notes", "shared/data"])
  })
  test("refused, with a reason: absolute, leaving the project, in a repo's or pinetrie's own, tracked", () => {
    const planned = planShared({
      ...facts,
      user: [
        "/abs",
        "../out",
        ".",
        ".jj/plans",
        ".git",
        ".pinetrie/x",
        "node_modules/y",
        "docs",
      ],
      project: [],
      tracked: new Set(["docs"]),
    })
    expect(planned.shared).toEqual([])
    expect(planned.refused.map(r => `${r.path}: ${r.reason}`)).toEqual([
      "/abs: it is absolute",
      "../out: it leaves the project",
      ".: it leaves the project",
      ".jj/plans: it is inside .jj",
      ".git: it is inside .git",
      ".pinetrie/x: it is inside .pinetrie",
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

describe("immutable heads", () => {
  test("forkConfig: jj's own heads and the fork point, in its repo only", () => {
    expect(forkConfig("/workspace", [C1, C2])).toBe(
      '[[--scope]]\n--when.repositories = ["/workspace"]\n[--scope.revset-aliases]\n"immutable_heads()" = "builtin_immutable_heads() | c1 | c2"\n',
    )
  })
})

test("planForkSetup: a base with several parents is committed once, so the bookmark names one", () => {
  expect(
    argvs(planForkSetup(LANE, { kind: "commits", commits: [C1, C2] })).slice(
      1,
      4,
    ),
  ).toEqual([
    "lane: jj new c1 c2",
    `lane: jj commit -m base: ${LANE}`,
    `lane: jj bookmark set --allow-backwards pinetrie/${LANE} -r @-`,
  ])
})

test("planForkSetup: on the line, an empty commit naming it; its id read for the config (ADR-0060)", () => {
  const steps = argvs(
    planForkSetup(LANE, { kind: "line", onto: "pinetrie-onto", commit: C1 }),
  )
  expect(steps.slice(1, 3)).toEqual([
    "lane: jj new c1",
    `lane: jj commit -m ${baseMessage("base: pinetrie-onto", { bookmark: "pinetrie-onto", commit: C1 })}`,
  ])
  expect(steps.at(-1)).toContain(
    "jj --ignore-working-copy log --no-graph -r @-",
  )
})

test("planForkSetup: a WIP's copy on the line commit under it, never the WIP's own commits (ADR-0060)", () => {
  const W = commitId("w1")
  const steps = argvs(
    planForkSetup(
      LANE,
      { kind: "wip", bookmark: "wip/x", commit: W, under: C1 },
      "pnpm i",
    ),
  )
  expect(steps[0]).toBe(`lane: ${fetchById([W, C1]).argv.join(" ")}`)
  expect(steps.slice(1, 4)).toEqual([
    "lane: jj new c1",
    "lane: jj restore --from w1",
    `lane: jj commit -m ${baseMessage("copy of wip/x", { bookmark: "wip/x", commit: W })}`,
  ])
  expect(steps.some(s => s.includes("jj new w1"))).toBe(false)
  expect(steps.at(-1)).toBe("lane: sh -c pnpm i")
})

describe("planJoins: the integrated-offer commits a lane holds, joined before it catches up (S102)", () => {
  const T1 = commitId("t1")
  const T2 = commitId("t2")
  const S1 = commitId("s1")
  const S2 = commitId("s2")
  const X = commitId("x1")
  test("an integrated-offer commit whose sources the lane lacks is not joined", () => {
    expect(
      planJoins([{ integratedOfferCommit: T1, sources: [X] }], new Set([S1])),
    ).toEqual([])
  })
  test("a squash naming one source held and one not is joined, with the held one alone (S77 item 6)", () => {
    expect(
      planJoins(
        [{ integratedOfferCommit: T1, sources: [S1, X] }],
        new Set([S1]),
      ).map(j => [j.integratedOfferCommit, j.sources]),
    ).toEqual([[T1, [S1]]])
  })
  test("several integrated-offer commits keep their order, oldest first", () => {
    expect(
      planJoins(
        [
          { integratedOfferCommit: T1, sources: [S1] },
          { integratedOfferCommit: T2, sources: [S2] },
        ],
        new Set([S1, S2]),
      ).map(j => j.integratedOfferCommit),
    ).toEqual([T1, T2])
  })
  test("a join's message names the integrated-offer commit and its sources, and carries no trailer", () => {
    const [join] = planJoins(
      [{ integratedOfferCommit: T1, sources: [S1] }],
      new Set([S1]),
    )
    expect(join?.message).toBe("join: t1 holds s1")
    expect(join?.message).not.toMatch(/^Pinetrie-/m)
  })
})

describe("planMerge: an update's steps (ADR-0060)", () => {
  const W = commitId("w1")
  const COPY = commitId("copy1")
  test("the line's merge names its base, and lists what came in since the lane", () => {
    expect(
      planMerge({
        kind: "line",
        onto: "pinetrie-onto",
        commit: C1,
        mark: true,
      }),
    ).toEqual({
      steps: [fetchById([C1])],
      source: C1,
      message: baseMessage("update: pinetrie-onto", {
        bookmark: "pinetrie-onto",
        commit: C1,
      }),
      mark: true,
      came: { from: null, to: C1 },
    })
  })
  test("a WIP's copy fetches only the WIP's commit, and is made on the lane's last copy", () => {
    const plan = planMerge({
      kind: "wip",
      bookmark: "wip/x",
      commit: W,
      under: C2,
      on: COPY,
    })
    expect(argvs(plan.steps)).toEqual([
      `lane: ${fetchById([W]).argv.join(" ")}`,
      "lane: jj new copy1",
      "lane: jj restore --from w1",
      `lane: jj commit -m ${baseMessage("copy of wip/x", { bookmark: "wip/x", commit: W })}`,
    ])
    expect(plan).toMatchObject({
      source: "copy",
      message: "update: wip/x",
      mark: false,
      came: { from: C2, to: W },
    })
  })
  test("the thread it branched from is merged as a commit, named, with no Pinetrie-Base (ADR-0072)", () => {
    expect(
      planMerge({
        kind: "parent",
        lane: laneNameForThread("p"),
        name: "amber-fox" as ThreadName,
        commit: C2,
        caughtUpWith: C1,
      }),
    ).toEqual({
      steps: [fetchById([C2])],
      source: C2,
      message: "update: amber-fox",
      mark: false,
      came: { from: C1, to: C2 },
    })
  })
})

test("fetchById: skipped when every commit is on the disk, else onto branches", () => {
  const step = fetchById([C1, C2])
  expect(step.in).toBe("lane")
  expect(step.argv.slice(0, 2)).toEqual(["sh", "-c"])
  expect(step.argv[2]).toBe(
    `{ git cat-file -e c1^{commit} && git cat-file -e c2^{commit}; } 2>/dev/null || { git fetch -q /mnt/host-working-copy +c1:${FETCHED_REF}/0 +c2:${FETCHED_REF}/1 && jj --ignore-working-copy git import --quiet; }`,
  )
})

const argvs = (steps: readonly LaneStep[]) =>
  steps.map(s => `${s.in}: ${s.argv.join(" ")}`)

test("planFork: the clone, the container, then jj new before anything else, then the config", () => {
  const steps = planFork({
    point: {
      snapshot: snapshotId("e1"),
      start: { kind: "commits", commits: [C1] },
    },
    paths,
    spec,
    env: {},
  })
  expect(argvs(steps)).toEqual([
    "host: container volume create --opt journal=ordered --opt size=64G pinetrie-t-1",
    "host: /bin/cp -c /p/.pinetrie/snapshots/e1.img /v/pinetrie-t-1/volume.img.tmp",
    "host: /bin/mv -f /v/pinetrie-t-1/volume.img.tmp /v/pinetrie-t-1/volume.img",
    `host: container ${planRun(spec, {}).join(" ")}`,
    `lane: ${fetchById([C1]).argv.join(" ")}`,
    "lane: jj new c1",
    `lane: jj bookmark set --allow-backwards pinetrie/${LANE} -r @-`,
    `lane: sh -c mkdir -p /workspace/.pinetrie-lane && printf ${shellWord(forkConfig("%s", ["%s" as never]))} /workspace c1 > /workspace/.pinetrie-lane/jj.toml`,
  ])
})

test("planDisk: a new volume, or one cloned from a snapshot; then the container", () => {
  const disk = (from: typeof BASE_SNAPSHOT | null) =>
    argvs(planDisk({ paths, spec, env: {}, from }))
  expect(disk(null)).toEqual([
    "host: container volume create --opt journal=ordered --opt size=64G pinetrie-t-1",
    `host: container ${planRun(spec, {}).join(" ")}`,
  ])
  expect(disk(BASE_SNAPSHOT)[1]).toContain("/snapshots/base.img ")
})

test("planSnapshot: sync comes before the clone", () => {
  expect(
    argvs(
      planSnapshot({
        volume: "pinetrie-t-1",
        snapshot: snapshotId("e2"),
        paths,
      }),
    ),
  ).toEqual([
    "lane: sync",
    "host: /bin/cp -c /v/pinetrie-t-1/volume.img /p/.pinetrie/snapshots/e2.img.tmp",
    "host: /bin/mv -f /p/.pinetrie/snapshots/e2.img.tmp /p/.pinetrie/snapshots/e2.img",
  ])
})

test("planBundle: the lane's bookmark, excluding what your repo has", () => {
  expect(
    planBundle({ bookmark: `pinetrie/${LANE}`, have: [C1], to: "/tmp/b" }),
  ).toEqual({
    in: "lane",
    argv: [
      "git",
      "bundle",
      "create",
      "-",
      `refs/heads/pinetrie/${LANE}`,
      "^c1",
    ],
    stdoutTo: "/tmp/b",
  })
})

describe("planBaseRefresh: the base snapshot at your @-", () => {
  const install = {
    command: "pnpm install --frozen-lockfile",
    lockfile: "pnpm-lock.yaml",
  }
  test("a new base: git and jj initialized, not cloned, then your @-, then the install", () => {
    expect(
      argvs(planBaseRefresh({ base: null, yours: [C1], lock: "h", install })),
    ).toEqual([
      "lane: git init -q",
      "lane: jj git init --colocate",
      `lane: ${fetchById([C1]).argv.join(" ")}`,
      "lane: jj workspace update-stale",
      "lane: jj new c1",
      "lane: sh -c pnpm install --frozen-lockfile",
    ])
  })
  test("nothing when your @- and the lockfile match", () => {
    expect(
      planBaseRefresh({
        base: { commits: [C1], lock: "h" },
        yours: [C1],
        lock: "h",
        install,
      }),
    ).toEqual([])
  })
  test("fetch, recover a stale working copy, and jj new when only your @- moved", () => {
    expect(
      argvs(
        planBaseRefresh({
          base: { commits: [C1], lock: "h" },
          yours: [C2],
          lock: "h",
          install,
        }),
      ),
    ).toEqual([
      `lane: ${fetchById([C2]).argv.join(" ")}`,
      "lane: jj workspace update-stale",
      "lane: jj new c2",
    ])
  })
  test("then the install when the lockfile changed too", () => {
    expect(
      argvs(
        planBaseRefresh({
          base: { commits: [C1], lock: "h" },
          yours: [C2],
          lock: "i",
          install,
        }),
      ).at(-1),
    ).toBe("lane: sh -c pnpm install --frozen-lockfile")
  })
})

describe("the host: its root, then container, in order", () => {
  const ok = { installed: true, running: true, kernel: true, clones: true }
  const root = { ok: "/p" }
  test("lanes when every check passes", () => {
    expect(planHost({ root, ...ok })).toEqual({
      kind: "lanes",
      root: "/p",
      rootDefault: "own",
    })
  })
  test("the first failing check is the reason", () => {
    const reason = (f: Partial<typeof ok>) => {
      const r = planHost({ root, ...ok, ...f })
      return r.kind === "direct" ? r.reason : ""
    }
    expect(reason({ installed: false, running: false })).toContain(
      "not installed",
    )
    expect(reason({ running: false, kernel: false })).toContain("not running")
    expect(reason({ kernel: false, clones: false })).toContain(
      "kernel set --recommended",
    )
    expect(reason({ clones: false })).toContain("same APFS volume")
  })
  test("no repo: direct, before container is asked", () => {
    expect(
      planHost({ root: { direct: "/p", reason: "no jj" }, ...ok }),
    ).toEqual({ kind: "direct", root: "/p", reason: "no jj" })
  })
  test("planProjectDir: jj's root, else git's, else the folder; never missing, your home directory or /", () => {
    const facts = {
      dir: "/p/sub",
      isDirectory: true,
      jjRoot: "/p",
      gitTop: null,
      home: HOME,
    }
    expect(planProjectDir(facts)).toEqual({
      kind: "found",
      root: "/p",
      repo: "jj",
    })
    expect(planProjectDir({ ...facts, jjRoot: null, gitTop: "/p" })).toEqual({
      kind: "found",
      root: "/p",
      repo: "git",
    })
    expect(planProjectDir({ ...facts, jjRoot: null })).toEqual({
      kind: "found",
      root: "/p/sub",
      repo: null,
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
  test("planRoot: a jj repo's root; a refused folder works directly where it is, and a repo without jj at its root", () => {
    expect(
      planRoot({ kind: "found", root: "/p", repo: "jj" }, "/p/sub"),
    ).toEqual({ ok: "/p" })
    expect(
      planRoot(
        { kind: "refused", refusal: { kind: "unsafe", root: HOME } },
        "/p/sub",
      ),
    ).toEqual({
      direct: "/p/sub",
      reason: expect.stringContaining("your home directory"),
    })
    expect(
      planRoot(
        { kind: "refused", refusal: { kind: "unexcludable", root: "/p" } },
        "/p/sub",
      ),
    ).toEqual({ direct: "/p", reason: expect.stringContaining("--colocate") })
    expect(
      planRoot({ kind: "found", root: "/p", repo: "git" }, "/p/sub"),
    ).toMatchObject({
      direct: "/p",
      reason: expect.stringContaining("no jj repo"),
    })
  })
  test("planExclude: adds each missing line once, on a line of its own", () => {
    expect(planExclude("", ["/.pinetrie/"])).toBe("/.pinetrie/\n")
    expect(planExclude("# x", ["/.pinetrie/", "/.plans/"])).toBe(
      "# x\n/.pinetrie/\n/.plans/\n",
    )
    expect(planExclude("a\n/.pinetrie/\n", ["/.pinetrie/", "/.plans/"])).toBe(
      "a\n/.pinetrie/\n/.plans/\n",
    )
    expect(planExclude("a\n/.pinetrie/\n", ["/.pinetrie/"])).toBeNull()
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
  test("planStartFrom: a volume starts from it; none, from the newest snapshot; neither, retired", () => {
    const newest = snapshotId("e1")
    expect(planStartFrom({ volume: true, newest: null })).toEqual({
      kind: "volume",
    })
    expect(planStartFrom({ volume: false, newest })).toEqual({
      kind: "snapshot",
      from: newest,
    })
    expect(planStartFrom({ volume: false, newest: null })).toEqual({
      kind: "retired",
    })
  })
})

test("planImages: pinetrie's image is pinned to the app's Playwright, a project's is not", () => {
  const input = {
    pinetrie: { file: "/pinetrie/Containerfile", content: "FROM node" },
    project: { file: "/p/pinetrie.Containerfile", content: "FROM alpine" },
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

test("imageRefusal: git 2.41 or later, named when missing or old", () => {
  expect(imageRefusal("git version 2.49.1\n")).toBeNull()
  expect(imageRefusal("git version 3.0.0")).toBeNull()
  expect(imageRefusal("git version 2.40.9")).toContain("git 2.40")
  expect(imageRefusal("")).toContain("has no git")
})

describe("planTurnCommit: the turn's revision (S56)", () => {
  const C3 = commitId("c3")
  const at = {
    atEmpty: true,
    parents: [C2],
    bookmark: C1,
    parentDescends: true,
  }
  test("changes in @ are committed, whatever is below", () => {
    expect(planTurnCommit({ ...at, atEmpty: false })).toEqual({
      kind: "commit",
    })
    expect(
      planTurnCommit({ ...at, atEmpty: false, parentDescends: false }),
    ).toEqual({ kind: "commit" })
  })
  test("a commit the agent made on the bookmark is adopted", () => {
    expect(planTurnCommit(at)).toEqual({ kind: "adopt", commit: C2 })
  })
  test("nothing, when @- is the bookmark: the turn changed nothing", () => {
    expect(planTurnCommit({ ...at, parents: [C1] })).toEqual({ kind: "none" })
  })
  test("nothing, when @- is on another line, as a stack's commits are", () => {
    expect(planTurnCommit({ ...at, parentDescends: false })).toEqual({
      kind: "none",
    })
  })
  test("nothing, when @- is a merge", () => {
    expect(planTurnCommit({ ...at, parents: [C2, C3] })).toEqual({
      kind: "none",
    })
  })
  test("nothing, when the lane has no bookmark", () => {
    expect(planTurnCommit({ ...at, bookmark: null })).toEqual({ kind: "none" })
  })
})
