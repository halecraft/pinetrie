import {
  BASE_SNAPSHOT,
  commitId,
  laneNameForThread,
  snapshotId,
} from "@pineta/core"
import { describe, expect, test } from "vitest"
import {
  decodeGrants,
  decodeInstall,
  extendImmutable,
  FETCHED_REF,
  fetchById,
  forkConfig,
  imageRefusal,
  type LaneSpec,
  type LaneStep,
  NO_GRANTS,
  PINETA_HEADS,
  planBaseRefresh,
  planBundle,
  planDisk,
  planExclude,
  planFetch,
  planFork,
  planForkSetup,
  planHost,
  planLinks,
  planRoot,
  planRun,
  planSnapshot,
  shellWord,
} from "./index.ts"

const LANE = laneNameForThread("1")
const C1 = commitId("c1")
const C2 = commitId("c2")
const HOME = "/Users/ada"
const paths = { volumes: "/v", snapshots: "/p/.pineta/snapshots" }

const spec: LaneSpec = {
  lane: LANE,
  volume: "pineta-t-1",
  image: "pineta-lane:abc",
  imagePath: "/usr/local/bin:/usr/bin:/bin",
  hostWorkingCopy: "/p",
  pineta: "/opt/pineta",
  runtime: "/p/.pineta/runtime/abc",
  links: [{ source: "/k", target: "/k" }],
  grants: NO_GRANTS,
  identity: { name: "agent", email: "agent@pineta" },
  memory: "2G",
}

/** Each `--mount` value, and each `-e` value, from a `container run`. */
const valuesOf = (argv: readonly string[], flag: string) =>
  argv.flatMap((a, i) => (a === flag ? [argv[i + 1] ?? ""] : []))

describe("planRun: a lane's container", () => {
  const argv = planRun(spec, { HOME, SECRET: "s", GITHUB_TOKEN: "t" })
  test("--init, the lane's disk at /workspace, and every host path read-only", () => {
    expect(argv.slice(0, 3)).toEqual(["run", "-d", "--init"])
    expect(valuesOf(argv, "-v")).toEqual(["pineta-t-1:/workspace"])
    expect(valuesOf(argv, "--mount")).toEqual([
      "type=bind,source=/p,target=/mnt/host-working-copy,readonly",
      "type=bind,source=/opt/pineta,target=/pineta,readonly",
      "type=bind,source=/p/.pineta/runtime/abc,target=/pineta-runtime,readonly",
      "type=bind,source=/k,target=/k,readonly",
    ])
  })
  test("never your home directory, and no variable no grant names", () => {
    expect(argv.join(" ")).not.toContain(HOME)
    expect(argv.join(" ")).not.toContain("SECRET")
    expect(argv).not.toContain("--ssh")
  })
  test("each grant applies", () => {
    const granted = planRun(
      {
        ...spec,
        grants: {
          ssh: true,
          env: ["GITHUB_TOKEN", "MISSING"],
          mounts: [{ source: "/data", target: "/data" }],
        },
      },
      { GITHUB_TOKEN: "t" },
    )
    expect(granted).toContain("--ssh")
    expect(valuesOf(granted, "-e")).toContain("GITHUB_TOKEN=t")
    expect(valuesOf(granted, "-e").some(e => e.startsWith("MISSING"))).toBe(
      false,
    )
    expect(valuesOf(granted, "--mount")).toContain(
      "type=bind,source=/data,target=/data,readonly",
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

describe("pineta.json: grants and the install, total", () => {
  test("nothing, or anything malformed, grants nothing", () => {
    expect(decodeGrants(undefined, "/p")).toEqual(NO_GRANTS)
    expect(decodeGrants({}, "/p")).toEqual(NO_GRANTS)
    expect(decodeGrants({ lanes: 3 }, "/p")).toEqual(NO_GRANTS)
    expect(
      decodeGrants(
        {
          lanes: {
            ssh: "yes",
            env: ["OK_1", 4, "no-dash", "A=B"],
            mounts: [{ source: "d" }, { source: "d", target: "rel" }],
          },
        },
        "/p",
      ),
    ).toEqual({ ssh: false, env: ["OK_1"], mounts: [] })
  })
  test("mount sources are relative to the project", () => {
    expect(
      decodeGrants(
        { lanes: { ssh: true, mounts: [{ source: "../d", target: "/d" }] } },
        "/p/app",
      ),
    ).toEqual({
      ssh: true,
      env: [],
      mounts: [{ source: "/p/d", target: "/d" }],
    })
  })
  test("the install: pineta.json's, else pnpm's for a pnpm repo, else none", () => {
    expect(
      decodeInstall(
        { lanes: { install: "npm ci", installWhen: "package-lock.json" } },
        true,
      ),
    ).toEqual({ command: "npm ci", lockfile: "package-lock.json" })
    expect(decodeInstall({ lanes: { install: "npm ci" } }, true)).toEqual({
      command: "pnpm install --frozen-lockfile",
      lockfile: "pnpm-lock.yaml",
    })
    expect(decodeInstall(null, false)).toBeNull()
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
    { source: "/other", target: "/other" },
    { source: "/w/kyneta", target: "/kyneta" },
  ])
})

describe("immutable heads", () => {
  test("extendImmutable: keeps your value and adds the lanes' bookmarks once", () => {
    expect(extendImmutable("", PINETA_HEADS)).toBe(PINETA_HEADS)
    expect(extendImmutable("trunk()", PINETA_HEADS)).toBe(
      `(trunk()) | ${PINETA_HEADS}`,
    )
    expect(extendImmutable(`(trunk()) | ${PINETA_HEADS}`, PINETA_HEADS)).toBe(
      null,
    )
  })
  test("forkConfig: jj's own heads and the fork point", () => {
    expect(forkConfig([C1, C2])).toBe(
      '[revset-aliases]\n"immutable_heads()" = "builtin_immutable_heads() | c1 | c2"\n',
    )
  })
})

test("planForkSetup: a base with several parents is committed once, so the bookmark names one", () => {
  expect(argvs(planForkSetup(LANE, [C1, C2])).slice(1, 4)).toEqual([
    "lane: jj new c1 c2",
    `lane: jj commit -m base: ${LANE}`,
    `lane: jj bookmark set --allow-backwards pineta/${LANE} -r @-`,
  ])
})

test("fetchById: skipped when every commit is on the disk, else onto branches", () => {
  const step = fetchById([C1, C2])
  expect(step.in).toBe("lane")
  expect(step.argv.slice(0, 2)).toEqual(["sh", "-c"])
  expect(step.argv[2]).toBe(
    `{ git cat-file -e c1^{commit} && git cat-file -e c2^{commit}; } 2>/dev/null || { git fetch -q /mnt/host-working-copy +c1:${FETCHED_REF}/0 +c2:${FETCHED_REF}/1 && jj --ignore-working-copy git import --quiet; }`,
  )
})

test("shellWord: one word, whatever it holds", () => {
  expect(shellWord("abc/d.e")).toBe("abc/d.e")
  expect(shellWord('it\'s "x"')).toBe(`'it'\\''s "x"'`)
})

const argvs = (steps: readonly LaneStep[]) =>
  steps.map(s => `${s.in}: ${s.argv.join(" ")}`)

test("planFork: the clone, the container, then jj new before anything else, then the config", () => {
  const steps = planFork({
    point: { snapshot: snapshotId("e1"), commits: [C1] },
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
    `lane: sh -c mkdir -p /workspace/.pineta-lane && printf '%s' ${shellWord(forkConfig([C1]))} > /workspace/.pineta-lane/jj.toml`,
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

test("planFetch: the lane's bundle to a host file, then your repo fetches and jj imports it", () => {
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
    `host: git -C /p fetch -q /tmp/b.bundle +refs/heads/pineta/${LANE}:refs/heads/pineta/${LANE}`,
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
      "lane: sh -c printf '%s\\n' /.pineta-lane/ /lost+found/ >> .git/info/exclude",
      `lane: ${fetchById([C1]).argv.join(" ")}`,
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
  test("fetch and jj new when only your @- moved", () => {
    expect(
      argvs(
        planBaseRefresh({
          base: { commits: [C1], lock: "h" },
          yours: [C2],
          lock: "h",
          install,
        }),
      ),
    ).toEqual([`lane: ${fetchById([C2]).argv.join(" ")}`, "lane: jj new c2"])
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
  test("planExclude: adds /.pineta/ once, on a line of its own", () => {
    expect(planExclude("")).toBe("/.pineta/\n")
    expect(planExclude("# x")).toBe("# x\n/.pineta/\n")
    expect(planExclude("a\n/.pineta/\n")).toBeNull()
  })
})

test("imageRefusal: git 2.41 or later, named when missing or old", () => {
  expect(imageRefusal("git version 2.49.1\n")).toBeNull()
  expect(imageRefusal("git version 3.0.0")).toBeNull()
  expect(imageRefusal("git version 2.40.9")).toContain("git 2.40")
  expect(imageRefusal("")).toContain("has no git")
})
