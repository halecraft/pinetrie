import { BASE_SNAPSHOT, laneNameForThread, snapshotId } from "@pinetrie/core"
import { type LaneSpec, planMounts, planShape } from "@pinetrie/lanes"
import { describe, expect, test } from "vitest"
import {
  labelled,
  mountArgs,
  parseImagePath,
  parseInspect,
  planContainerHost,
  planDiskCommands,
  renderRun,
} from "./plan.ts"

const LANE = laneNameForThread("1")
const HOME = "/Users/ada"
const paths = { volumes: "/v", snapshots: "/p/.pinetrie/snapshots" }
const VOLUME = `pinetrie-${LANE}`

const spec: LaneSpec = {
  lane: LANE,
  image: "pinetrie-lane:abc",
  imagePath: "/usr/local/bin:/usr/bin:/bin",
  mounts: planMounts({
    hostWorkingCopy: "/p",
    pinetrie: "/opt/pinetrie",
    runtime: "/p/.pinetrie/runtime/abc",
    ignoreDir: "/p/.pinetrie/lane-git",
    links: [{ source: "/k", target: "/k", readonly: true }],
    grants: [],
    shared: [],
    hostPaths: [],
  }),
  grants: { ssh: false, nested: false, hostPorts: [], env: [] },
  identity: { name: "agent", email: "agent@pinetrie" },
  memory: "2G",
}

/** Each value of `flag` in an argument list. */
const valuesOf = (argv: readonly string[], flag: string) =>
  argv.flatMap((a, i) => (a === flag ? [argv[i + 1] ?? ""] : []))

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

describe("renderRun: a lane's shape as `container run`", () => {
  const argv = renderRun(
    planShape(spec, { HOME, SECRET: "s", GITHUB_TOKEN: "t" }),
  )
  test("--init, the lane's volume at /workspace, and every mount planMounts gave", () => {
    expect(argv.slice(0, 3)).toEqual(["run", "-d", "--init"])
    expect(valuesOf(argv, "-v")).toEqual([`${VOLUME}:/workspace`])
    expect(valuesOf(argv, "--mount")).toEqual(
      spec.mounts.map(m => mountArgs(m)[1]),
    )
  })
  test("each variable of the shape, and the image's command last", () => {
    expect(valuesOf(argv, "-e")).toEqual(
      expect.arrayContaining([
        "GIT_CONFIG_VALUE_0=/pinetrie-git/ignore",
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
  test("never your home directory, and ssh only when granted", () => {
    expect(argv.join(" ")).not.toContain(HOME)
    expect(argv).not.toContain("--ssh")
    expect(
      renderRun(
        planShape(
          {
            ...spec,
            grants: { ssh: true, nested: false, hostPorts: [], env: [] },
          },
          {},
        ),
      ),
    ).toContain("--ssh")
  })
  test("the label goes after `run`", () => {
    expect(labelled(["run", "-d"], "pinetrie.spec=h")).toEqual([
      "run",
      "--label",
      "pinetrie.spec=h",
      "-d",
    ])
  })
})

describe("planDiskCommands: each disk operation as host commands", () => {
  const commands = (op: Parameters<typeof planDiskCommands>[0]) =>
    planDiskCommands(op, paths).commands.map(c => c.join(" "))
  test("a new volume is journaled", () => {
    expect(commands({ kind: "create", lane: LANE })).toEqual([
      `container volume create --opt journal=ordered --opt size=64G ${VOLUME}`,
    ])
  })
  test("a restore creates the volume, then clones the snapshot's file over its image", () => {
    expect(
      commands({ kind: "restore", lane: LANE, from: BASE_SNAPSHOT }),
    ).toEqual([
      `container volume create --opt journal=ordered --opt size=64G ${VOLUME}`,
      `/bin/cp -c /p/.pinetrie/snapshots/base.img /v/${VOLUME}/volume.img.tmp`,
      `/bin/mv -f /v/${VOLUME}/volume.img.tmp /v/${VOLUME}/volume.img`,
    ])
  })
  test("a snapshot clones the volume's image to a temporary name, renamed into place", () => {
    expect(
      commands({ kind: "snapshot", lane: LANE, snapshot: snapshotId("e2") }),
    ).toEqual([
      `/bin/cp -c /v/${VOLUME}/volume.img /p/.pinetrie/snapshots/e2.img.tmp`,
      "/bin/mv -f /p/.pinetrie/snapshots/e2.img.tmp /p/.pinetrie/snapshots/e2.img",
    ])
  })
  test("deletes succeed when there is nothing to delete", () => {
    expect(planDiskCommands({ kind: "delete", lane: LANE }, paths)).toEqual({
      commands: [["container", "volume", "rm", VOLUME]],
      ignoreFailure: true,
    })
    expect(
      commands({ kind: "deleteSnapshots", ids: [snapshotId("e1")] }),
    ).toEqual(["/bin/rm -f /p/.pinetrie/snapshots/e1.img"])
  })
})

test("parseInspect: running or stopped with its label; missing when unreadable", () => {
  const out = (state: string, labels: Record<string, string>) =>
    JSON.stringify([{ status: { state }, configuration: { labels } }])
  expect(
    parseInspect(out("running", { "pinetrie.spec": "h" }), "pinetrie.spec"),
  ).toEqual({
    state: "running",
    label: "h",
  })
  expect(parseInspect(out("stopped", {}), "pinetrie.spec")).toEqual({
    state: "stopped",
    label: null,
  })
  expect(parseInspect("not json", "pinetrie.spec")).toEqual({
    state: "missing",
    label: null,
  })
})

test("parseImagePath: the arm64 variant's PATH, else the standard one", () => {
  const out = (env: string[]) =>
    JSON.stringify([
      {
        variants: [
          { config: { architecture: "amd64", config: { Env: ["PATH=/x"] } } },
          { config: { architecture: "arm64", config: { Env: env } } },
        ],
      },
    ])
  expect(parseImagePath(out(["PATH=/a:/b"]))).toBe("/a:/b")
  expect(parseImagePath(out([]))).toBe(
    "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  )
})

describe("the host: its root, then container, in order", () => {
  const ok = { installed: true, running: true, kernel: true, clones: true }
  const root = { ok: "/p" }
  test("lanes when every check passes", () => {
    expect(planContainerHost({ root, ...ok })).toEqual({
      kind: "lanes",
      root: "/p",
      rootDefault: "own",
    })
  })
  test("the first failing check is the reason", () => {
    const reason = (f: Partial<typeof ok>) => {
      const r = planContainerHost({ root, ...ok, ...f })
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
      planContainerHost({ root: { direct: "/p", reason: "no jj" }, ...ok }),
    ).toEqual({ kind: "direct", root: "/p", reason: "no jj" })
  })
})
