import {
  BASE_SNAPSHOT,
  commitId,
  laneNameForThread,
  shellWord,
  snapshotId,
  type ThreadName,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  baseMessage,
  DEFAULT_LINE,
  decodeLaneConfig,
  FETCHED_REF,
  fetchById,
  forkConfig,
  imageRefusal,
  immutableHeads,
  isBookmarkName,
  type LaneSpec,
  type LaneStep,
  laneIgnores,
  laneRefSteps,
  lineConfig,
  logRevset,
  mountArgs,
  NO_GRANTS,
  nonceRevset,
  offerStart,
  PINETA_HEADS,
  parseBase,
  parseEvolog,
  planBaseRefresh,
  planBundle,
  planContainer,
  planDisk,
  planExclude,
  planFetch,
  planFollowOffer,
  planFork,
  planForkSetup,
  planHost,
  planHostMounts,
  planImages,
  planLinks,
  planMerge,
  planMounts,
  planOffer,
  planRetire,
  planRoot,
  planRun,
  planShared,
  planSnapshot,
  planStartFrom,
  planTakeOffer,
  planTurnCommit,
  SPEC_LABEL,
  specHashOf,
  takenRevset,
  walkToHost,
  withoutPinetaHeads,
} from "./index.ts"

const LANE = laneNameForThread("1")
const NAME = "amber-fox" as ThreadName
const C1 = commitId("c1")
const C2 = commitId("c2")
const HOME = "/Users/ada"
const paths = { volumes: "/v", snapshots: "/p/.pineta/snapshots" }

const parts = {
  hostWorkingCopy: "/p",
  pineta: "/opt/pineta",
  runtime: "/p/.pineta/runtime/abc",
  ignoreDir: "/p/.pineta/lane-git",
  links: [{ source: "/k", target: "/k", readonly: true }],
  grants: [],
  shared: [],
  hostPaths: [],
}

const spec: LaneSpec = {
  lane: LANE,
  volume: "pineta-t-1",
  image: "pineta-lane:abc",
  imagePath: "/usr/local/bin:/usr/bin:/bin",
  mounts: planMounts(parts),
  grants: { ssh: false, env: [] },
  identity: { name: "agent", email: "agent@pineta" },
  memory: "2G",
}

/** Each `--mount` value, and each `-e` value, from a `container run`. */
const valuesOf = (argv: readonly string[], flag: string) =>
  argv.flatMap((a, i) => (a === flag ? [argv[i + 1] ?? ""] : []))

describe("planMounts: every host path a lane sees, in one list", () => {
  test("your working copy, Pineta's own and the ignore file's directory, read-only", () => {
    expect(planMounts(parts)).toEqual([
      { source: "/p", target: "/mnt/host-working-copy", readonly: true },
      { source: "/opt/pineta", target: "/pineta", readonly: true },
      {
        source: "/p/.pineta/runtime/abc",
        target: "/pineta-runtime",
        readonly: true,
      },
      { source: "/p/.pineta/lane-git", target: "/pineta-git", readonly: true },
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
    expect(valuesOf(argv, "-v")).toEqual(["pineta-t-1:/workspace"])
    expect(valuesOf(argv, "--mount")).toEqual(
      spec.mounts.map(m => mountArgs(m)[1]),
    )
  })
  test("every repo in the lane ignores what the ignore file lists, through git's own variables", () => {
    expect(valuesOf(argv, "-e")).toEqual(
      expect.arrayContaining([
        "GIT_CONFIG_COUNT=1",
        "GIT_CONFIG_KEY_0=core.excludesFile",
        "GIT_CONFIG_VALUE_0=/pineta-git/ignore",
      ]),
    )
    expect(laneIgnores([".plans", "notes/shared"])).toBe(
      "/.pineta-lane/\n/lost+found/\n/.plans/\n/notes/shared/\n",
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
    expect(specHashOf({ ...spec, image: "pineta-lane:def" }, {})).not.toBe(hash)
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
        "JJ_EMAIL=agent@pineta",
        "JJ_CONFIG=/workspace/.pineta-lane/jj.toml",
        "JJ_EDITOR=false",
        "PATH=/usr/local/bin:/usr/bin:/bin:/pineta-runtime/bin",
      ]),
    )
    expect(argv.slice(-4)).toEqual([
      "/workspace",
      "pineta-lane:abc",
      "sleep",
      "infinity",
    ])
  })
})

describe("lineConfig: the project's names win, and a bad one falls back", () => {
  const none = { onto: null, wipPrefix: null }
  test("defaults with nothing set", () => {
    expect(lineConfig(none, none)).toEqual({ line: DEFAULT_LINE, refused: [] })
  })
  test("the project's name wins over the user's", () => {
    expect(
      lineConfig(
        { onto: "mine", wipPrefix: "draft/" },
        { onto: "trunk", wipPrefix: null },
      ).line,
    ).toEqual({ onto: "trunk", wipPrefix: "draft/" })
  })
  test("a name that is no bookmark falls back, saying why", () => {
    const r = lineConfig(none, { onto: "has space", wipPrefix: "a..b/" })
    expect(r.line).toEqual(DEFAULT_LINE)
    expect(r.refused).toHaveLength(2)
    expect(r.refused[0]).toContain("has space")
  })
  test("isBookmarkName: git's rules", () => {
    for (const ok of ["pineta-onto", "wip/x", "a.b"])
      expect(isBookmarkName(ok)).toBe(true)
    for (const bad of ["", "a b", "a..b", "-a", "a/", "a.lock", "a@b", "a:b"])
      expect(isBookmarkName(bad)).toBe(false)
  })
})

describe("logRevset: the offers added to your log (S77 item 8)", () => {
  test("added to jj's default when the repo defines none, and idempotent", () => {
    const once = logRevset(null)
    expect(once).toBe('builtin_log() | bookmarks(glob:"pineta-offer/*")')
    expect(logRevset(once)).toBe(once)
    expect(logRevset("@ | trunk()")).toBe(
      '@ | trunk() | bookmarks(glob:"pineta-offer/*")',
    )
  })
})

describe("immutableHeads: the line and its offers added to yours", () => {
  test("added to jj's builtin when the repo defines none, with present()", () => {
    expect(immutableHeads(DEFAULT_LINE, null)).toBe(
      'builtin_immutable_heads() | present("pineta-onto") | (bookmarks(glob:"pineta-offer/*") & children(present("pineta-onto")))',
    )
  })
  test("joined to your own definition, and idempotent", () => {
    const once = immutableHeads(DEFAULT_LINE, "trunk() | tags()")
    expect(once.startsWith("trunk() | tags() | ")).toBe(true)
    expect(immutableHeads(DEFAULT_LINE, once)).toBe(once)
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
        offers: { onto: null, wipPrefix: null },
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
      offers: { onto: null, wipPrefix: null },
    })
  })
  test("offers: the line's names, as written", () => {
    expect(
      decodeLaneConfig({ offers: { onto: "trunk", wipPrefix: 3 } }, "/p", false)
        .offers,
    ).toEqual({ onto: "trunk", wipPrefix: null })
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
  test("refused, with a reason: absolute, leaving the project, in a repo's or Pineta's own, tracked", () => {
    const planned = planShared({
      ...facts,
      user: [
        "/abs",
        "../out",
        ".",
        ".jj/plans",
        ".git",
        ".pineta/x",
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
      ".pineta/x: it is inside .pineta",
      "node_modules/y: it is inside node_modules",
      "docs: it holds files jj tracks",
    ])
  })
})

test("planLinks: the directory beside the project that a link leaves for, mounted where it resolves", () => {
  expect(
    planLinks("/w/pineta", [
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
  test("withoutPinetaHeads: removes Pineta's line, keeps yours, unsets when only the builtin is left", () => {
    expect(
      withoutPinetaHeads(`builtin_immutable_heads() | ${PINETA_HEADS}`),
    ).toBe("")
    expect(
      withoutPinetaHeads(
        `builtin_immutable_heads() | tags() | ${PINETA_HEADS}`,
      ),
    ).toBe("builtin_immutable_heads() | tags()")
    expect(withoutPinetaHeads(`(trunk()) | ${PINETA_HEADS}`)).toBe("trunk()")
    expect(withoutPinetaHeads("builtin_immutable_heads()")).toBeNull()
  })
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
    `lane: jj bookmark set --allow-backwards pineta/${LANE} -r @-`,
  ])
})

test("planForkSetup: on the line, an empty commit naming it; its id read for the config (ADR-0060)", () => {
  const steps = argvs(
    planForkSetup(LANE, { kind: "line", onto: "pineta-onto", commit: C1 }),
  )
  expect(steps.slice(1, 3)).toEqual([
    "lane: jj new c1",
    `lane: jj commit -m ${baseMessage("base: pineta-onto", { bookmark: "pineta-onto", commit: C1 })}`,
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

describe("planMerge: an update's steps (ADR-0060)", () => {
  const W = commitId("w1")
  const COPY = commitId("copy1")
  test("the line's merge names its base, and lists what came in since the lane", () => {
    expect(
      planMerge({ kind: "line", onto: "pineta-onto", commit: C1, mark: true }),
    ).toEqual({
      steps: [fetchById([C1])],
      source: C1,
      message: baseMessage("update: pineta-onto", {
        bookmark: "pineta-onto",
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
})

test("baseMessage and parseBase round-trip a Pineta-Base", () => {
  const m = baseMessage("copy of wip/a@b", { bookmark: "wip/a@b", commit: C1 })
  expect(m).toBe("copy of wip/a@b\n\nPineta-Base: wip/a@b@c1\n")
  expect(parseBase("wip/a@b@c1")).toEqual({ bookmark: "wip/a@b", commit: C1 })
  expect(parseBase("nope")).toBeNull()
})

describe("offers (ADR-0038)", () => {
  const root = "/y"
  const op = (...args: string[]) =>
    `host: jj -R /y --ignore-working-copy --config operation.username=pineta-host ${args.join(" ")}`
  /** A rewrite of an offer, which may be immutable on the line (ADR-0060). */
  const rw = (...args: string[]) => op("--ignore-immutable", ...args)
  test("offerStart: the base's commit, and the history of each taken source (ADR-0060)", () => {
    expect(offerStart({ tip: C1, start: C2, sources: [] })).toBe(
      "heads(::c1 & (c2))",
    )
    expect(
      offerStart({
        tip: C1,
        start: C2,
        sources: [commitId("t1"), commitId("t2")],
      }),
    ).toBe("heads(::c1 & (c2 | ::(present(t1) | present(t2))))")
  })
  test("takenRevset: taken sources above the commit the base holds, never a WIP's copy (S81)", () => {
    const taken = 'description(regex:"(?m)^Pineta-Source: ")'
    expect(
      takenRevset({
        line: DEFAULT_LINE,
        base: { base: { kind: "line" }, start: C1, source: C1 },
      }),
    ).toBe(`(::(present("pineta-onto")) ~ ::present(c1)) & ${taken}`)
    // A WIP lane starts at its copy, which holds no taken commit: what it
    // holds is the WIP's commit the copy was made from.
    expect(
      takenRevset({
        line: DEFAULT_LINE,
        base: {
          base: { kind: "wip", bookmark: "wip/a" },
          start: C1,
          source: C2,
        },
      }),
    ).toBe(
      `(::(present("pineta-onto") | present("wip/a")) ~ ::present(c2)) & ${taken}`,
    )
  })
  test("planOffer: a commit per source, by nonce; rebased, bookmarked, then described", () => {
    const n = (i: number) => nonceRevset("N", i)
    expect(
      argvs(
        planOffer({
          root,
          name: NAME,
          start: [C1, C2],
          sources: [
            { commit: commitId("s1"), description: "one" },
            { commit: commitId("s2"), description: "two" },
          ],
          target: "@-",
          nonce: "N",
        }),
      ),
    ).toEqual([
      op("new", "--no-edit", "c1", "c2", "-m", "N-0"),
      rw("restore", "--from", "s1", "--into", n(0)),
      op("new", "--no-edit", n(0), "-m", "N-1"),
      rw("restore", "--from", "s2", "--into", n(1)),
      rw("rebase", "-s", n(0), "-o", "@-"),
      op(
        "bookmark",
        "set",
        "--allow-backwards",
        "pineta-offer/amber-fox",
        "-r",
        n(1),
      ),
      rw("describe", "-r", n(0), "-m", "one"),
      rw("describe", "-r", n(1), "-m", "two"),
    ])
  })
  test("planFollowOffer: back onto the start, the tip restored, onto the target; described only when asked", () => {
    const follow = (description: string | null) =>
      argvs(
        planFollowOffer({
          root,
          change: "ch",
          start: [C1, C2],
          tip: commitId("t2"),
          target: "@-",
          description,
        }),
      )
    expect(follow(null)).toEqual([
      rw("rebase", "-s", "ch", "-o", "c1", "-o", "c2"),
      rw("restore", "--from", "t2", "--into", "ch"),
      rw("rebase", "-s", "ch", "-o", "@-"),
    ])
    expect(follow("WIP (amber-fox): x").at(-1)).toBe(
      rw("describe", "-r", "ch", "-m", "WIP (amber-fox): x"),
    )
  })
  test("planTakeOffer: the destination moved forward to the top, as the host, never with --allow-backwards (ADR-0060)", () => {
    expect(
      argvs(
        planTakeOffer({
          root,
          bookmark: "pineta-offer/amber-fox",
          top: "t",
          destination: "pineta-onto",
        }),
      ),
    ).toEqual([
      op("bookmark", "move", "pineta-onto", "--to", "t"),
      op("bookmark", "delete", "pineta-offer/amber-fox"),
    ])
  })
  test("planRetire: moved to remote bookmarks first, then deleted, then the line (S48 item 21)", () => {
    expect(
      argvs(
        planRetire({
          root,
          bookmarks: [{ name: `pineta/${LANE}`, commit: C1 }],
          heads: `builtin_immutable_heads() | ${PINETA_HEADS}`,
        }),
      ),
    ).toEqual([
      `host: git -C /y update-ref refs/remotes/pineta-${LANE}/tip c1`,
      "host: jj -R /y --ignore-working-copy git import",
      op("bookmark", "delete", "glob:pineta/*"),
      'host: jj -R /y config unset --repo revset-aliases."immutable_heads()"',
    ])
    expect(planRetire({ root, bookmarks: [], heads: "trunk()" })).toEqual([])
  })
  test("laneRefSteps: update or delete, then one import", () => {
    expect(
      argvs(
        laneRefSteps(root, [
          { lane: LANE, commit: C1 },
          { lane: LANE, commit: null },
        ]),
      ),
    ).toEqual([
      `host: git -C /y update-ref refs/remotes/pineta-${LANE}/tip c1`,
      `host: git -C /y update-ref -d refs/remotes/pineta-${LANE}/tip`,
      "host: jj -R /y --ignore-working-copy git import",
    ])
    expect(laneRefSteps(root, [])).toEqual([])
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
    "host: container volume create --opt journal=ordered --opt size=64G pineta-t-1",
    "host: /bin/cp -c /p/.pineta/snapshots/e1.img /v/pineta-t-1/volume.img.tmp",
    "host: /bin/mv -f /v/pineta-t-1/volume.img.tmp /v/pineta-t-1/volume.img",
    `host: container ${planRun(spec, {}).join(" ")}`,
    `lane: ${fetchById([C1]).argv.join(" ")}`,
    "lane: jj new c1",
    `lane: jj bookmark set --allow-backwards pineta/${LANE} -r @-`,
    `lane: sh -c mkdir -p /workspace/.pineta-lane && printf ${shellWord(forkConfig("%s", ["%s" as never]))} /workspace c1 > /workspace/.pineta-lane/jj.toml`,
  ])
})

test("planDisk: a new volume, or one cloned from a snapshot; then the container", () => {
  const disk = (from: typeof BASE_SNAPSHOT | null) =>
    argvs(planDisk({ paths, spec, env: {}, from }))
  expect(disk(null)).toEqual([
    "host: container volume create --opt journal=ordered --opt size=64G pineta-t-1",
    `host: container ${planRun(spec, {}).join(" ")}`,
  ])
  expect(disk(BASE_SNAPSHOT)[1]).toContain("/snapshots/base.img ")
})

test("planSnapshot: sync comes before the clone", () => {
  expect(
    argvs(
      planSnapshot({ volume: "pineta-t-1", snapshot: snapshotId("e2"), paths }),
    ),
  ).toEqual([
    "lane: sync",
    "host: /bin/cp -c /v/pineta-t-1/volume.img /p/.pineta/snapshots/e2.img.tmp",
    "host: /bin/mv -f /p/.pineta/snapshots/e2.img.tmp /p/.pineta/snapshots/e2.img",
  ])
})

test("planFetch: the lane's bundle to a host file, then your repo fetches it as the lane's remote bookmark", () => {
  const fetch = planFetch({
    lane: LANE,
    have: [C1],
    root: "/p",
    bundle: "/tmp/b.bundle",
  })
  expect(fetch[0]).toEqual({
    in: "lane",
    argv: planBundle(LANE, [C1]),
    stdoutTo: "/tmp/b.bundle",
  })
  expect(argvs(fetch.slice(1))).toEqual([
    `host: git -C /p fetch -q /tmp/b.bundle +refs/heads/pineta/${LANE}:refs/remotes/pineta-${LANE}/tip`,
    "host: jj -R /p --ignore-working-copy git import",
    "host: rm -f /tmp/b.bundle",
  ])
})

test("planBundle: the lane's bookmark, excluding what your repo has", () => {
  expect(planBundle(LANE, [C1])).toEqual([
    "git",
    "bundle",
    "create",
    "-",
    `refs/heads/pineta/${LANE}`,
    "^c1",
  ])
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
  test("planRoot: jj's root; never your home directory or /; a git repo without jj works directly", () => {
    const facts = { dir: "/p/sub", jjRoot: "/p", gitTop: null, home: HOME }
    expect(planRoot(facts)).toEqual({ ok: "/p" })
    expect(planRoot({ ...facts, jjRoot: HOME })).toMatchObject({
      direct: "/p/sub",
    })
    expect(planRoot({ ...facts, jjRoot: null, gitTop: "/" })).toMatchObject({
      direct: "/p/sub",
    })
    expect(planRoot({ ...facts, jjRoot: null, gitTop: "/p" })).toMatchObject({
      direct: "/p",
      reason: expect.stringContaining("no jj repo"),
    })
  })
  test("planExclude: adds each missing line once, on a line of its own", () => {
    expect(planExclude("", ["/.pineta/"])).toBe("/.pineta/\n")
    expect(planExclude("# x", ["/.pineta/", "/.plans/"])).toBe(
      "# x\n/.pineta/\n/.plans/\n",
    )
    expect(planExclude("a\n/.pineta/\n", ["/.pineta/", "/.plans/"])).toBe(
      "a\n/.pineta/\n/.plans/\n",
    )
    expect(planExclude("a\n/.pineta/\n", ["/.pineta/"])).toBeNull()
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

test("planImages: Pineta's image is pinned to the app's Playwright, a project's is not", () => {
  const input = {
    pineta: { file: "/pineta/Containerfile", content: "FROM node" },
    project: { file: "/p/pineta.Containerfile", content: "FROM alpine" },
    jjVersion: "0.44.0",
    playwrightVersion: "1.56.0",
  }
  const plans = planImages(input)
  const bumped = planImages({ ...input, playwrightVersion: "1.57.0" })
  expect(plans.pineta.buildArgs).toEqual([
    "JJ_VERSION=0.44.0",
    "PLAYWRIGHT_VERSION=1.56.0",
  ])
  expect(bumped.pineta.tag).not.toBe(plans.pineta.tag)
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

describe("walkToHost", () => {
  // One line per version, newest first, as `jj evolog -T EVOLOG_ENTRY` prints them.
  const evolog = (...rows: readonly (readonly [string, string, string])[]) =>
    parseEvolog(
      rows
        .map(([commit, user, pred]) =>
          [commit, "kchange", user, pred === "" ? "" : `${pred}:kchange`].join(
            "\t",
          ),
        )
        .join("\n"),
    )
  const HOST = "pineta-host@mac"
  const id = commitId
  test("a revision the host made last: reached at once, none of yours", () => {
    const entries = evolog(["c2", HOST, "c1"], ["c1", "you@mac", ""])
    expect(walkToHost(entries, id("c2"))).toEqual({ reached: true, yours: [] })
  })
  test("your versions since the host's newest are listed, each with the one before it", () => {
    const entries = evolog(
      ["c4", "you@mac", "c3"],
      ["c3", "you@mac", "c2"],
      ["c2", HOST, "c1"],
      ["c1", "you@mac", ""],
    )
    expect(walkToHost(entries, id("c4"))).toEqual({
      reached: true,
      yours: [
        { from: id("c3"), to: id("c4") },
        { from: id("c2"), to: id("c3") },
      ],
    })
  })
  test("a revision the host never made is not reached", () => {
    const entries = evolog(["c2", "you@mac", "c1"], ["c1", "you@mac", ""])
    expect(walkToHost(entries, id("c2")).reached).toBe(false)
  })
  test("of a squash's predecessors, only its own change's is followed", () => {
    const entries = parseEvolog(
      [
        "c2\tkchange\tyou@mac\tcx:kother,c1:kchange",
        "cx\tkother\tpineta-host@mac\t",
        "c1\tkchange\tpineta-host@mac\t",
      ].join("\n"),
    )
    expect(walkToHost(entries, id("c2"))).toEqual({
      reached: true,
      yours: [{ from: id("c1"), to: id("c2") }],
    })
  })
})
