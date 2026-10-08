import { BASE_SNAPSHOT, snapshotId, threadIdFor } from "@pinetrie/core"
import {
  type ContainerShape,
  type LaneSpec,
  planMounts,
  planShape,
} from "@pinetrie/lanes"
import { describe, expect, test } from "vitest"
import { buildError } from "./cli.ts"
import {
  type DockerHostFacts,
  dockerWords,
  type Listed,
  labelled,
  mountArgs,
  NESTED_MOUNT,
  parseImagePath,
  parseInspect,
  parseMountinfo,
  parsePs,
  planDiskCommand,
  planDockerHost,
  planHostPortRules,
  planProjectSweep,
  planSlotSweep,
  projectDisks,
  projectKey,
  renderRun,
} from "./plan.ts"
import type { DockerTarget } from "./target.ts"

const LANE = threadIdFor("1")
const spec: LaneSpec = {
  lane: LANE,
  image: "pinetrie-lane:abc",
  imagePath: "/usr/bin:/bin",
  mounts: planMounts({
    hostWorkingCopy: "/Users/ada/p",
    pinetrie: "/opt/pinetrie",
    runtime: "/Users/ada/p/.pinetrie/runtime/abc",
    ignoreDir: "/Users/ada/p/.pinetrie/lane-git",
    links: [],
    grants: [],
    shared: [{ path: ".plans", source: "/Users/ada/p/.plans" }],
    hostPaths: [],
  }),
  grants: { ssh: false, nested: false, hostPorts: [], env: [] },
  identity: { name: "agent", email: "agent@pinetrie" },
  memory: "4G",
}
const key = projectKey("/Users/ada/p")
const disks = projectDisks("/var/lib/lanehost", key)
/** The Mac's target: every host path under slot 3. */
const mac: DockerTarget = {
  socket: "/s/docker.sock",
  pathOf: p => `/mnt/host-shares/3/${p.replaceAll("/", "_")}`,
  labels: { "pinetrie.slot": "3" },
  sshAgent: "/run/pinetrie/ssh-3.sock",
  hostAddress: "192.168.127.254",
}
const render = (shape: ContainerShape, target = mac) =>
  renderRun(shape, {
    target,
    disks,
    project: key,
    seccomp: "/opt/p/seccomp.json",
  })
const valuesOf = (argv: readonly string[], flag: string) =>
  argv.flatMap((a, i) => (a === flag ? [argv[i + 1] ?? ""] : []))

const shapes: readonly ContainerShape[] = [
  planShape(spec, {}),
  planShape({ ...spec, grants: { ...spec.grants, ssh: true } }, {}),
  planShape({ ...spec, grants: { ...spec.grants, nested: true } }, {}),
]

describe("renderRun: a lane's shape as `docker run`", () => {
  test("no shape gets --privileged, a capability, or a Docker socket", () => {
    for (const shape of shapes) {
      const argv = render(shape)
      expect(argv).not.toContain("--privileged")
      expect(argv).not.toContain("--cap-add")
      for (const bind of [
        ...valuesOf(argv, "--mount"),
        ...valuesOf(argv, "-v"),
      ])
        expect(bind).not.toMatch(/docker\.sock|\/var\/run|\/run\/docker/)
    }
  })
  test("the lane's subvolume at /workspace; every mount through pathOf, read-only where it says", () => {
    const argv = render(shapes[0] as ContainerShape)
    const mounts = valuesOf(argv, "--mount")
    expect(mounts[0]).toBe(
      `type=bind,source=${disks.lane(LANE)},target=/workspace`,
    )
    for (const m of spec.mounts)
      expect(mounts).toContain(
        `type=bind,source=${mac.pathOf(m.source)},target=${m.target}${m.readonly ? ",readonly" : ""}`,
      )
    expect(mounts.filter(m => m.endsWith(",readonly")).length).toBe(
      spec.mounts.filter(m => m.readonly).length,
    )
  })
  test("the lane's hostname is its container's name, as under container", () => {
    const argv = render(shapes[0] as ContainerShape)
    expect(valuesOf(argv, "--hostname")).toEqual([`pinetrie-${LANE}`])
  })
  test("the project's and the target's labels; the image's command last", () => {
    const argv = render(shapes[0] as ContainerShape)
    expect(valuesOf(argv, "--label")).toEqual([
      `pinetrie.project=${key}`,
      "pinetrie.slot=3",
    ])
    expect(argv.slice(-3)).toEqual(["pinetrie-lane:abc", "sleep", "infinity"])
  })
  test("ssh: the slot's agent, only with the grant", () => {
    expect(render(shapes[0] as ContainerShape).join(" ")).not.toContain("ssh")
    const argv = render(shapes[1] as ContainerShape)
    expect(valuesOf(argv, "--mount")).toContain(
      "type=bind,source=/run/pinetrie/ssh-3.sock,target=/run/pinetrie/ssh-agent.sock",
    )
    expect(valuesOf(argv, "-e")).toContain(
      "SSH_AUTH_SOCK=/run/pinetrie/ssh-agent.sock",
    )
  })
  test("the nested options only for a nested shape; every other lane has no-new-privileges", () => {
    const plain = render(shapes[0] as ContainerShape)
    expect(valuesOf(plain, "--security-opt")).toEqual(["no-new-privileges"])
    expect(plain).not.toContain("--device")
    const nested = render(shapes[2] as ContainerShape)
    expect(valuesOf(nested, "--security-opt")).toEqual([
      "seccomp=/opt/p/seccomp.json",
      "systempaths=unconfined",
    ])
    expect(valuesOf(nested, "--device")).toEqual(["/dev/net/tun"])
    expect(valuesOf(nested, "--mount")).toContain(
      `type=bind,source=${disks.nested(LANE)},target=${NESTED_MOUNT}`,
    )
    expect(valuesOf(nested, "-e")).toContain(
      "DOCKER_HOST=unix:///run/user/1000/docker.sock",
    )
    expect(nested.slice(-3)).toEqual([
      "sh",
      "-c",
      "(pinetrie-inner-docker &); exec sleep infinity",
    ])
  })
  test("on Linux, paths as they are", () => {
    const linux: DockerTarget = {
      socket: "/var/run/docker.sock",
      pathOf: p => p,
      labels: {},
      sshAgent: null,
      hostAddress: null,
    }
    const argv = render(shapes[1] as ContainerShape, linux)
    expect(valuesOf(argv, "--mount")).toContain(
      "type=bind,source=/Users/ada/p,target=/mnt/host-working-copy,readonly",
    )
    expect(argv.join(" ")).not.toContain("SSH_AUTH_SOCK")
    expect(valuesOf(argv, "--label")).toEqual([`pinetrie.project=${key}`])
  })
  test("a path with a comma takes -v; the label goes after `run`", () => {
    expect(
      mountArgs("/a,b", { source: "/a,b", target: "/t", readonly: true }),
    ).toEqual(["-v", "/a,b:/t:ro"])
    expect(labelled(["run", "-d"], "pinetrie.spec=h")).toEqual([
      "run",
      "--label",
      "pinetrie.spec=h",
      "-d",
    ])
  })
})

describe("planDiskCommand: each disk operation as one command in the helper", () => {
  const script = (op: Parameters<typeof planDiskCommand>[0]) => {
    const [sh, c, body, , ...args] = planDiskCommand(op, disks)
    expect([sh, c]).toEqual(["sh", "-c"])
    return { body: body ?? "", args }
  }
  test("each project's disks are under its key", () => {
    expect(disks.lane(LANE)).toBe(
      `/var/lib/lanehost/projects/${key}/lanes/${LANE}`,
    )
    expect(projectKey("/Users/ada/q")).not.toBe(key)
  })
  test("create and restore", () => {
    expect(script({ kind: "create", lane: LANE })).toMatchObject({
      args: [disks.lane(LANE)],
    })
    expect(script({ kind: "create", lane: LANE }).body).toContain(
      'btrfs -q subvolume create "$1"',
    )
    const restore = script({ kind: "restore", lane: LANE, from: BASE_SNAPSHOT })
    expect(restore.args).toEqual([
      `/var/lib/lanehost/projects/${key}/snapshots/base`,
      disks.lane(LANE),
    ])
    expect(restore.body).toContain('btrfs -q subvolume snapshot "$1" "$2"')
  })
  test("a snapshot is made aside, then renamed over the old one; writable, so it can be deleted", () => {
    const s = script({
      kind: "snapshot",
      lane: LANE,
      snapshot: snapshotId("e1"),
    })
    expect(s.args).toEqual([disks.lane(LANE), disks.snapshot(snapshotId("e1"))])
    expect(s.body).toContain('btrfs -q subvolume snapshot "$1" "$2.tmp"')
    expect(s.body).toContain('mv "$2.tmp" "$2"')
    expect(s.body).not.toContain("snapshot -r")
  })
  test("a lane's delete takes its inner lanes' disk; snapshots are deleted by id", () => {
    expect(script({ kind: "delete", lane: LANE }).args).toEqual([
      disks.lane(LANE),
      disks.nested(LANE),
    ])
    expect(
      script({
        kind: "deleteSnapshots",
        ids: [snapshotId("e1"), snapshotId("e2")],
      }).args,
    ).toEqual([
      disks.snapshot(snapshotId("e1")),
      disks.snapshot(snapshotId("e2")),
    ])
  })
})

describe("planDockerHost: what stops Docker running lanes here, with its fix", () => {
  const ok: DockerHostFacts = {
    platform: "linux",
    docker: null,
    buildx: null,
    lanesDir: { dir: "/l", fs: { btrfs: true, rmAllowed: true } },
  }
  const words = (f: Partial<DockerHostFacts>) => {
    const r = planDockerHost({ ...ok, ...f })
    return r === null ? null : dockerWords(r)
  }
  test("nothing when all is there; the Mac's lanes directory is the VM's", () => {
    expect(words({})).toBeNull()
    expect(words({ platform: "darwin", lanesDir: null })).toBeNull()
  })
  test("a refusal carries what the command said", () => {
    expect(words({ buildx: "docker: unknown command: docker buildx" })).toMatch(
      /\(it said: docker: unknown command: docker buildx\)$/,
    )
  })
  test("each refusal in order", () => {
    expect(words({ docker: "", buildx: "" })).toContain("docker version")
    expect(words({ platform: "darwin", docker: "" })).toContain(
      "brew install docker",
    )
    expect(words({ platform: "darwin", buildx: "" })).toContain(
      "cliPluginsExtraDirs",
    )
    expect(
      words({
        lanesDir: { dir: "/l", fs: { btrfs: false, rmAllowed: false } },
      }),
    ).toContain("mkfs.btrfs")
    expect(
      words({ lanesDir: { dir: "/l", fs: { btrfs: true, rmAllowed: false } } }),
    ).toContain("user_subvol_rm_allowed")
  })
})

test("parseMountinfo: the mount holding the directory, by its longest point", () => {
  const info = [
    "22 1 0:21 / / rw,relatime - overlay overlay rw,lowerdir=x",
    "40 22 0:40 / /var/lib/pinetrie-lanes rw,relatime - btrfs /dev/vdb rw,user_subvol_rm_allowed,space_cache=v2",
    "41 22 0:41 / /data rw - btrfs /dev/vdc rw,space_cache=v2",
  ].join("\n")
  expect(parseMountinfo(info, "/var/lib/pinetrie-lanes")).toEqual({
    btrfs: true,
    rmAllowed: true,
  })
  expect(parseMountinfo(info, "/data/lanes")).toEqual({
    btrfs: true,
    rmAllowed: false,
  })
  expect(parseMountinfo(info, "/home/x")).toEqual({
    btrfs: false,
    rmAllowed: false,
  })
})

describe("the sweeps", () => {
  const c = (name: string, labels: Record<string, string>): Listed => ({
    name,
    labels,
  })
  test("a slot's sweep takes every container labelled with it, and no other", () => {
    expect(
      planSlotSweep(3, [
        c("a", { "pinetrie.slot": "3" }),
        c("b", { "pinetrie.slot": "13" }),
        c("pinetrie-disks", {}),
      ]),
    ).toEqual(["a"])
  })
  test("the startup sweep takes the containers and disks of projects whose root is gone", () => {
    expect(
      planProjectSweep({
        projects: [
          { key: "k1", rootExists: true },
          { key: "k2", rootExists: false },
        ],
        containers: [
          c("a", { "pinetrie.project": "k1" }),
          c("b", { "pinetrie.project": "k2" }),
        ],
      }),
    ).toEqual({ containers: ["b"], projects: ["k2"] })
  })
  test("parsePs reads names and labels", () => {
    expect(
      parsePs(
        '{"Names":"pinetrie-t-1","Labels":"pinetrie.project=k1,pinetrie.slot=3"}\n',
      ),
    ).toEqual([
      c("pinetrie-t-1", { "pinetrie.project": "k1", "pinetrie.slot": "3" }),
    ])
  })
})

test("parseInspect and parseImagePath", () => {
  expect(
    parseInspect(
      '[{"State":{"Running":true},"Config":{"Labels":{"pinetrie.spec":"h"}}}]',
      "pinetrie.spec",
    ),
  ).toEqual({ state: "running", label: "h" })
  expect(
    parseInspect('[{"State":{"Running":false},"Config":{"Labels":null}}]', "x"),
  ).toEqual({ state: "stopped", label: null })
  expect(parseImagePath('["A=1","PATH=/a:/b"]')).toBe("/a:/b")
  expect(parseImagePath("null")).toBe(
    "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  )
})

test("a failed build names buildx's error, not its builder", () => {
  expect(
    buildError(
      '#0 building with "default" instance using docker driver\n#1 [internal] load build definition\nERROR: failed to solve: docker.io/library/alpine:3.23: failed to resolve source metadata\n',
    ),
  ).toBe(
    "ERROR: failed to solve: docker.io/library/alpine:3.23: failed to resolve source metadata",
  )
  expect(buildError("just this\n")).toBe("just this")
})

describe("a project's grant of the host's ports", () => {
  const granted = planShape(
    { ...spec, grants: { ...spec.grants, hostPorts: [3000, 5432] } },
    {},
  )
  test("every lane is on its project's network", () => {
    expect(valuesOf(render(shapes[0] as ContainerShape), "--network")).toEqual([
      `pinetrie-${key}`,
    ])
  })
  test("a lane is told the host's address and its granted ports, where the target has an address", () => {
    expect(valuesOf(render(granted), "-e")).toEqual(
      expect.arrayContaining([
        "PINETRIE_HOST=192.168.127.254",
        "PINETRIE_HOST_PORTS=3000,5432",
      ]),
    )
    expect(render(shapes[0] as ContainerShape).join(" ")).not.toContain(
      "PINETRIE_HOST",
    )
    const linux: DockerTarget = { ...mac, hostAddress: null }
    expect(render(granted, linux).join(" ")).not.toContain("PINETRIE_HOST")
  })
  test("the rules accept each port only from the project's network, to the host's address, after clearing its old ones", () => {
    const [sh, c, script = ""] = planHostPortRules({
      key,
      subnet: "172.18.0.0/16",
      hostAddress: "192.168.127.254",
      ports: [3000, 5432],
    })
    expect([sh, c]).toEqual(["sh", "-c"])
    const lines = script.split("\n")
    const chain = `PT-${key.slice(0, 16)}`
    expect(lines.findIndex(l => l.includes("-D "))).toBeLessThan(
      lines.findIndex(l => l.includes("--dport")),
    )
    expect(lines).toContain(
      `iptables -A ${chain} -d 192.168.127.254 -p tcp --dport 5432 -j ACCEPT`,
    )
    expect(lines.at(-1)).toBe(
      `iptables -I DOCKER-USER -s 172.18.0.0/16 -j ${chain}`,
    )
  })
  test("with no ports, only the old rules go", () => {
    const [, , script = ""] = planHostPortRules({
      key,
      subnet: "172.18.0.0/16",
      hostAddress: "192.168.127.254",
      ports: [],
    })
    expect(script).not.toContain("ACCEPT")
    expect(script).not.toContain("-I DOCKER-USER")
    expect(script.split("\n").at(-1)).toBe(`iptables -X PT-${key.slice(0, 16)}`)
  })
})
