import {
  BASE_SNAPSHOT,
  baseMessage,
  commitId,
  shellWord,
  snapshotId,
  type ThreadName,
  threadIdFor,
} from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  BASE_FORMAT,
  BASE_LANE,
  bookmarkName,
  configChangeNote,
  configWidenings,
  DEFAULT_REPO,
  decodeLaneConfig,
  effectiveLaneConfig,
  FETCHED_REF,
  fetchById,
  forkConfig,
  imageRefusal,
  isBaseCurrent,
  isBookmarkName,
  isCopyableBase,
  type LaneSpec,
  type LaneStep,
  laneContainer,
  laneGitConfig,
  laneIgnores,
  machineConfig,
  NO_GRANTS,
  NOTHING_ATTACHED,
  parseBaseFacts,
  planBaseCheckout,
  planBaseFacts,
  planBundle,
  planContainer,
  planDisk,
  planExclude,
  planFork,
  planForkSetup,
  planHostMounts,
  planImages,
  planJoins,
  planLinks,
  planMerge,
  planMounts,
  planOldNamesOnDisk,
  planProjectDir,
  planRoot,
  planShape,
  planShared,
  planSnapshot,
  planStartFrom,
  planTurnCommit,
  repoConfig,
  type Step,
  slotMounts,
  specHash,
  specHashOf,
} from "./index.ts"

const LANE = threadIdFor("1")
const C1 = commitId("c1")
const C2 = commitId("c2")
const HOME = "/Users/ada"

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
  image: "pinetrie-lane:abc",
  imagePath: "/usr/local/bin:/usr/bin:/bin",
  mounts: planMounts(parts),
  grants: { nested: false, hostPorts: [], env: [] },
  attached: NOTHING_ATTACHED,
  identity: { name: "agent", email: "agent@pinetrie" },
  memory: "2G",
}

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

describe("slotMounts: what a host shares into its slot of the lane VM", () => {
  test("every directory a lane mounts, its shared directories with the base's", () => {
    const shared = [{ path: ".plans", source: "/p/.plans" }]
    const attached = [{ source: "/s/ssh", target: "/run/ssh", readonly: true }]
    const slot = slotMounts({ base: planMounts(parts), shared, attached })
    const sources = new Set(slot.map(m => m.source))
    for (const m of [...planMounts({ ...parts, shared }), ...attached])
      expect(sources).toContain(m.source)
  })
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
    // Docker's API takes any path: a comma and a colon are no trouble.
    expect(planned.mounts).toEqual([
      "/Users/ada/.pi/agent/npm/node_modules/pi-subagents",
      "/x/a,b:c",
    ])
    expect(planned.refused.map(r => `${r.path}: ${r.reason}`)).toEqual([
      "/: it is the file system's root",
      "/Users: it is, or holds, your home directory",
      "/Users/ada: it is, or holds, your home directory",
      "/Users/ada/.pi: it is, or holds, pi's agent directory",
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
      "/.pinetrie-lane/\n/lost+found/\n/.pnpm-store/\n/.plans/\n/notes/shared/\n",
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

test("specHashOf: the hash of the runtime's spec, changed when it changes", () => {
  const runtime = { runSpec: (s: { image: string }) => ["run", s.image] }
  const shape = planShape(spec, {})
  expect(specHashOf(runtime, shape)).toBe(
    specHash(["run", "pinetrie-lane:abc"]),
  )
  expect(
    specHashOf(runtime, { ...shape, image: "pinetrie-lane:def" }),
  ).not.toBe(specHashOf(runtime, shape))
})

describe("machineConfig: the VM's slots, a bad value refused", () => {
  test("default: 16 slots", () => {
    expect(machineConfig({ slots: null })).toEqual({
      machine: { slots: 16 },
      refused: [],
    })
  })
  test("what the user wrote, when it can be used", () => {
    expect(machineConfig({ slots: 20 }).machine).toEqual({ slots: 20 })
  })
  test("more than 20 slots, refused with why; the default holds", () => {
    const { machine, refused } = machineConfig({ slots: 24 })
    expect(machine).toEqual({ slots: 16 })
    expect(refused).toEqual([
      "lanes.vm.slots 24 is not a whole number from 1 to 20: a VM boots with at most 20 share devices beside its others; using 16",
    ])
    expect(machineConfig({ slots: 2.5 }).refused).toHaveLength(1)
    expect(machineConfig({ slots: 0 }).refused).toHaveLength(1)
  })
})

describe("repoConfig: the project's values win, and a bad one falls back", () => {
  const none = {
    acceptedBookmark: null,
    wipPrefix: null,
    publish: null,
    catchUp: null,
    offers: false,
  }
  test("defaults with nothing set", () => {
    expect(repoConfig(none, none)).toEqual({
      repoConfig: DEFAULT_REPO,
      refused: [],
    })
  })
  test("the project's name wins over the user's", () => {
    expect(
      repoConfig(
        {
          ...none,
          acceptedBookmark: "mine",
          wipPrefix: "draft/",
          publish: "master",
          catchUp: true,
        },
        { ...none, acceptedBookmark: "trunk" },
      ).repoConfig,
    ).toEqual({
      acceptedBookmark: "trunk",
      wipPrefix: "draft/",
      publish: "master",
      publishCatchesUp: true,
    })
  })
  test("catching up is off unless set, and the project's setting wins", () => {
    expect(DEFAULT_REPO.publishCatchesUp).toBe(false)
    expect(
      repoConfig({ ...none, catchUp: true }, { ...none, catchUp: false })
        .repoConfig.publishCatchesUp,
    ).toBe(false)
    expect(
      repoConfig(none, { ...none, catchUp: true }).repoConfig.publishCatchesUp,
    ).toBe(true)
  })
  test("a catchUp that is not true or false falls back to off, saying why", () => {
    const r = repoConfig(
      { ...none, catchUp: true },
      { ...none, catchUp: { invalid: '"yes"' } },
    )
    expect(r.repoConfig.publishCatchesUp).toBe(false)
    expect(r.refused).toEqual([
      'publish.catchUp "yes" is not true or false; using false',
    ])
  })
  test("a name that is no bookmark falls back, saying why", () => {
    const r = repoConfig(none, {
      ...none,
      acceptedBookmark: "has space",
      wipPrefix: "a..b/",
      publish: "a:b",
    })
    expect(r.repoConfig).toEqual(DEFAULT_REPO)
    expect(r.refused).toEqual([
      `accepted.bookmark "has space" is not a bookmark name; using "${DEFAULT_REPO.acceptedBookmark}"`,
      'wip.prefix "a..b/" is not a bookmark name; using "wip/"',
      'publish.bookmark "a:b" is not a bookmark name; using "main"',
    ])
  })
  test("a config that still has offers is named, and nothing of it is read", () => {
    const r = repoConfig({ ...none, offers: true }, { ...none, offers: true })
    expect(r.repoConfig).toEqual(DEFAULT_REPO)
    expect(r.refused).toEqual([
      "your config: offers is no longer read; use accepted.bookmark, wip.prefix, publish.bookmark and publish.catchUp",
      "pinetrie.json: offers is no longer read; use accepted.bookmark, wip.prefix, publish.bookmark and publish.catchUp",
    ])
  })
  test("isBookmarkName: git's rules", () => {
    for (const ok of ["pinetrie-accepted", "wip/x", "a.b"])
      expect(isBookmarkName(ok)).toBe(true)
    for (const bad of ["", "a b", "a..b", "-a", "a/", "a.lock", "a@b", "a:b"])
      expect(isBookmarkName(bad)).toBe(false)
  })
})

describe("decodeLaneConfig: grants and shared directories, total", () => {
  test("nothing, or anything malformed, grants and shares nothing", () => {
    for (const json of [undefined, {}, { lanes: 3 }])
      expect(decodeLaneConfig(json, "/p")).toEqual({
        grants: NO_GRANTS,
        shared: [],
        repo: {
          acceptedBookmark: null,
          wipPrefix: null,
          publish: null,
          catchUp: null,
          offers: false,
        },
        machine: { slots: null },
      })
    expect(
      decodeLaneConfig(
        {
          lanes: {
            ssh: "yes",
            nested: "yes",
            env: ["OK_1", 4, "no-dash", "A=B"],
            mounts: [{ source: "d" }, { source: "d", target: "rel" }],
            shared: [".plans", 3, null],
          },
        },
        "/p",
      ),
    ).toEqual({
      grants: {
        ssh: false,
        nested: false,
        hostPorts: [],
        env: ["OK_1"],
        mounts: [],
      },
      shared: [".plans"],
      repo: {
        acceptedBookmark: null,
        wipPrefix: null,
        publish: null,
        catchUp: null,
        offers: false,
      },
      machine: { slots: null },
    })
  })
  test("lanes.hostPorts: whole ports from 1 to 65535, once each, in order", () => {
    const ports = (v: unknown) =>
      decodeLaneConfig({ lanes: { hostPorts: v } }, "/p").grants.hostPorts
    expect(ports([5432, 3000, 3000, 0, 70000, 2.5, "80"])).toEqual([3000, 5432])
    expect(ports("5432")).toEqual([])
    expect(ports(undefined)).toEqual([])
  })
  test("lanes.nested grants lanes inside a lane, only when true", () => {
    const nested = (v: unknown) =>
      decodeLaneConfig({ lanes: { nested: v } }, "/p").grants.nested
    expect(nested(true)).toBe(true)
    expect(nested("true")).toBe(false)
    expect(nested(undefined)).toBe(false)
  })
  test("lanes.vm.slots: the machine's setting, as written", () => {
    const machine = (lanes: unknown) =>
      decodeLaneConfig({ lanes }, "/p").machine
    expect(machine({ vm: { slots: 4 } })).toEqual({ slots: 4 })
    expect(machine({ vm: { slots: "4" } })).toEqual({
      slots: { invalid: '"4"' },
    })
  })
  test("accepted, wip and publish: how pine·trie uses your repo, as written", () => {
    expect(
      decodeLaneConfig(
        {
          accepted: { bookmark: "trunk" },
          wip: { prefix: 3 },
          publish: { bookmark: "master" },
        },
        "/p",
      ).repo,
    ).toEqual({
      acceptedBookmark: "trunk",
      wipPrefix: null,
      publish: "master",
      catchUp: null,
      offers: false,
    })
    expect(decodeLaneConfig({ offers: { onto: "trunk" } }, "/p").repo).toEqual({
      acceptedBookmark: null,
      wipPrefix: null,
      publish: null,
      catchUp: null,
      offers: true,
    })
  })
  test("publish.catchUp: a boolean, else the text written", () => {
    const flag = (catchUp: unknown) =>
      decodeLaneConfig({ publish: { catchUp } }, "/p").repo.catchUp
    expect(flag(true)).toBe(true)
    expect(flag(false)).toBe(false)
    expect(flag(undefined)).toBeNull()
    expect(flag("yes")).toEqual({ invalid: '"yes"' })
    expect(flag(null)).toEqual({ invalid: "null" })
  })
  test("mount sources are relative to the project", () => {
    expect(
      decodeLaneConfig(
        { lanes: { ssh: true, mounts: [{ source: "../d", target: "/d" }] } },
        "/p/app",
      ).grants,
    ).toEqual({
      ssh: true,
      nested: false,
      hostPorts: [],
      env: [],
      mounts: [{ source: "/p/d", target: "/d", readonly: true }],
    })
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
      2,
      5,
    ),
  ).toEqual([
    "lane: jj new c1 c2",
    `lane: jj commit -m base: ${LANE}`,
    `lane: jj bookmark set --allow-backwards pinetrie/${LANE} -r @-`,
  ])
})

test("planForkSetup: on accepted work, an empty commit naming it; its id read for the config", () => {
  const steps = argvs(
    planForkSetup(LANE, {
      kind: "accepted",
      commit: C1,
    }),
  )
  expect(steps.slice(2, 4)).toEqual([
    "lane: jj new c1",
    `lane: jj commit -m ${baseMessage("base: accepted work", { kind: "accepted", commit: C1 })}`,
  ])
  expect(steps.at(-1)).toContain(
    "jj --ignore-working-copy log --no-graph -r @-",
  )
})

test("planForkSetup: a WIP's copy on accepted commit under it, never the WIP's own commits", () => {
  const W = commitId("w1")
  const steps = argvs(
    planForkSetup(LANE, {
      kind: "wip",
      bookmark: "wip/x",
      commit: W,
      under: C1,
    }),
  )
  expect(steps[1]).toBe(`lane: ${fetchById([W, C1]).argv.join(" ")}`)
  expect(steps.slice(2, 5)).toEqual([
    "lane: jj new c1",
    "lane: jj restore --from w1",
    `lane: jj commit -m ${baseMessage("copy of wip/x", { kind: "wip", bookmark: "wip/x", commit: W })}`,
  ])
  expect(steps.some(s => s.includes("jj new w1"))).toBe(false)
  // No fork installs: a WIP's dependencies are a layer of its own.
  expect(steps.join("\n")).not.toContain("pnpm")
})

describe("planJoins: the accepted-offer commits a lane holds, joined before it catches up", () => {
  const T1 = commitId("t1")
  const T2 = commitId("t2")
  const SRC1 = commitId("s1")
  const SRC2 = commitId("s2")
  const X = commitId("x1")
  test("an accepted-offer commit whose sources the lane lacks is not joined", () => {
    expect(
      planJoins([{ acceptedOfferCommit: T1, sources: [X] }], new Set([SRC1])),
    ).toEqual([])
  })
  test("a squash naming one source held and one not is joined, with the held one alone", () => {
    expect(
      planJoins(
        [{ acceptedOfferCommit: T1, sources: [SRC1, X] }],
        new Set([SRC1]),
      ).map(j => [j.acceptedOfferCommit, j.sources]),
    ).toEqual([[T1, [SRC1]]])
  })
  test("several accepted-offer commits keep their order, oldest first", () => {
    expect(
      planJoins(
        [
          { acceptedOfferCommit: T1, sources: [SRC1] },
          { acceptedOfferCommit: T2, sources: [SRC2] },
        ],
        new Set([SRC1, SRC2]),
      ).map(j => j.acceptedOfferCommit),
    ).toEqual([T1, T2])
  })
  test("a join's message names the accepted-offer commit and its sources, and carries no trailer", () => {
    const [join] = planJoins(
      [{ acceptedOfferCommit: T1, sources: [SRC1] }],
      new Set([SRC1]),
    )
    expect(join?.message).toBe("join: t1 holds s1")
    expect(join?.message).not.toMatch(/^Pinetrie-/m)
  })
})

describe("planMerge: an update's steps", () => {
  const W = commitId("w1")
  const COPY = commitId("copy1")
  test("accepted work's merge names its base, and lists what came in since the lane", () => {
    expect(
      planMerge({
        kind: "accepted",
        commit: C1,
        mark: true,
      }),
    ).toEqual({
      steps: [fetchById([C1])],
      source: C1,
      message: baseMessage("catch up: accepted work", {
        kind: "accepted",
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
      `lane: jj commit -m ${baseMessage("copy of wip/x", { kind: "wip", bookmark: "wip/x", commit: W })}`,
    ])
    expect(plan).toMatchObject({
      source: "copy",
      message: "update: wip/x",
      mark: false,
      came: { from: C2, to: W },
    })
  })
  test("the thread it branched from is merged as a commit, named, with no Pinetrie-Base", () => {
    expect(
      planMerge({
        kind: "parent",
        lane: threadIdFor("p"),
        name: "amber-fox" as ThreadName,
        commit: C2,
        caughtUpWith: C1,
      }),
    ).toEqual({
      steps: [fetchById([C2])],
      source: C2,
      message: "catch up: amber-fox",
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

const argvs = (steps: readonly (LaneStep | Step)[]) =>
  steps.map(s =>
    s.in === "lane"
      ? `lane: ${s.argv.join(" ")}`
      : s.op.kind === "run"
        ? `runtime: run ${s.op.shape.name}`
        : `runtime: ${JSON.stringify(s.op)}`,
  )

test("planFork: the restore, the container, the old config folder gone, then jj new before any other jj command, then the config", () => {
  const steps = planFork({
    point: {
      snapshot: snapshotId("e1"),
      start: { kind: "commits", commits: [C1] },
    },
    spec,
    env: {},
  })
  expect(argvs(steps)).toEqual([
    `runtime: ${JSON.stringify({ kind: "restore", lane: LANE, from: "e1" })}`,
    `runtime: run pinetrie-${LANE}`,
    "lane: sh -c rm -rf /workspace/.pineta-lane",
    `lane: ${fetchById([C1]).argv.join(" ")}`,
    "lane: jj new c1",
    `lane: jj bookmark set --allow-backwards pinetrie/${LANE} -r @-`,
    `lane: sh -c mkdir -p /workspace/.pinetrie-lane && printf ${shellWord(forkConfig("%s", ["%s" as never]))} /workspace c1 > /workspace/.pinetrie-lane/jj.toml`,
  ])
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

describe("the base: the base before it, checked out at accepted work", () => {
  test("planBaseCheckout: a fresh disk's git and jj, not cloned; a copied base's stale copy recovered", () => {
    expect(argvs(planBaseCheckout({ yours: [C1], fresh: true }))).toEqual([
      "lane: git init -q",
      "lane: jj git init --colocate",
      `lane: ${fetchById([C1]).argv.join(" ")}`,
      "lane: jj new c1",
    ])
    expect(argvs(planBaseCheckout({ yours: [C2], fresh: false }))).toEqual([
      `lane: ${fetchById([C2]).argv.join(" ")}`,
      "lane: jj workspace update-stale",
      "lane: jj new c2",
    ])
  })
  test("isBaseCurrent: the same commits, made the way bases are now", () => {
    const base = { commits: [C1], format: BASE_FORMAT }
    expect(isBaseCurrent(base, [C1])).toBe(true)
    expect(isBaseCurrent(base, [C2])).toBe(false)
    expect(isBaseCurrent({ ...base, format: BASE_FORMAT - 1 }, [C1])).toBe(
      false,
    )
    expect(isBaseCurrent(null, [C1])).toBe(false)
  })
  test("isCopyableBase: a base made the way they are now; one from before was made on a layer", () => {
    expect(isCopyableBase({ commits: [C1], format: BASE_FORMAT })).toBe(true)
    expect(
      isCopyableBase(
        parseBaseFacts(JSON.stringify({ commits: [C1], key: "k" })),
      ),
    ).toBe(false)
    expect(isCopyableBase(null)).toBe(false)
  })
  test("planBaseFacts: its commits and its format, read back", () => {
    const [written] = argvs([planBaseFacts([C1])])
    expect(written).toContain(
      JSON.stringify({ commits: [C1], format: BASE_FORMAT }),
    )
  })
})

describe("the host: its root", () => {
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
  test("planRoot: a jj repo's root; a refused folder, or a repo without jj, is refused with how to fix it", () => {
    expect(planRoot({ kind: "found", root: "/p", repo: "jj" })).toEqual({
      ok: "/p",
    })
    expect(
      planRoot({ kind: "refused", refusal: { kind: "unsafe", root: HOME } }),
    ).toEqual({ refused: expect.stringContaining("your home directory") })
    expect(
      planRoot({
        kind: "refused",
        refusal: { kind: "unexcludable", root: "/p" },
      }),
    ).toEqual({ refused: expect.stringContaining("--colocate") })
    expect(planRoot({ kind: "found", root: "/p", repo: "git" })).toEqual({
      refused:
        "/p has no jj repo: `jj git init --colocate` makes one, and gives its threads' agents their lanes",
    })
    expect(planRoot({ kind: "found", root: "/p", repo: null })).toEqual({
      refused: expect.stringContaining("no jj repo"),
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
  test("planStartFrom: a disk starts from it; none, from the newest snapshot; neither, retired", () => {
    const newest = snapshotId("e1")
    expect(planStartFrom({ disk: true, newest: null })).toEqual({
      kind: "disk",
    })
    expect(planStartFrom({ disk: false, newest })).toEqual({
      kind: "snapshot",
      from: newest,
    })
    expect(planStartFrom({ disk: false, newest: null })).toEqual({
      kind: "retired",
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

describe("planTurnCommit: the turn's revision", () => {
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

describe("pre-rename: planOldNamesOnDisk, for a disk cloned from a snapshot taken before the rename", () => {
  const STACK = `pineta/${LANE}-stack`
  const facts = (
    configDir: { old: boolean; current: boolean },
    bookmarks: string[],
  ) => argvs(planOldNamesOnDisk({ configDir, bookmarks }, LANE))
  test("the config folder moves, first; the lane's bookmarks are renamed; fetched ones are deleted; another lane's stay", () => {
    expect(
      facts({ old: true, current: false }, [
        `pineta/${LANE}`,
        STACK,
        "pineta/fetched/0",
        "pineta/fetched/1",
        "pineta/t-parent",
      ]),
    ).toEqual([
      "lane: sh -c mv /workspace/.pineta-lane /workspace/.pinetrie-lane",
      `lane: jj -R /workspace --ignore-working-copy bookmark rename pineta/${LANE} pinetrie/${LANE}`,
      `lane: jj -R /workspace --ignore-working-copy bookmark rename ${STACK} pinetrie/${LANE}-stack`,
      "lane: jj -R /workspace --ignore-working-copy bookmark delete pineta/fetched/0 pineta/fetched/1",
    ])
  })
  test("where the current name is already there, the old one is removed instead", () => {
    expect(
      facts({ old: true, current: true }, [
        `pineta/${LANE}`,
        `pinetrie/${LANE}`,
      ]),
    ).toEqual([
      "lane: sh -c rm -rf /workspace/.pineta-lane",
      `lane: jj -R /workspace --ignore-working-copy bookmark delete pineta/${LANE}`,
    ])
  })
  test("a disk with nothing old has no steps", () => {
    expect(facts({ old: false, current: true }, [`pinetrie/${LANE}`])).toEqual(
      [],
    )
  })
})

test("the base's scratch lane is no thread's: nothing that takes a thread takes it", () => {
  // @ts-expect-error: a bookmark, a remote and a stack are a thread's lane's
  const bookmark = bookmarkName(BASE_LANE)
  expect([laneContainer(BASE_LANE), bookmark]).toEqual([
    "pinetrie-base-scratch",
    "pinetrie/base-scratch",
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
