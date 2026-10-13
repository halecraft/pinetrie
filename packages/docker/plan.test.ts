import { threadIdFor } from "@pinetrie/core"
import { projectDisks } from "@pinetrie/lanehost"
import {
  type ContainerShape,
  type LaneSpec,
  NOTHING_ATTACHED,
  planMounts,
  planShape,
} from "@pinetrie/lanes"
import { describe, expect, test } from "vitest"
import { buildError } from "./cli.ts"
import {
  type DockerHostFacts,
  dockerWords,
  imagePathOf,
  isRootless,
  type Listed,
  labelled,
  laneCommand,
  lanehostContainer,
  NESTED_MOUNT,
  parseMountinfo,
  planDockerHost,
  planProjectSweep,
  planSlotSweep,
  projectKey,
  renderHelper,
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
  grants: { nested: false, hostPorts: [], env: [] },
  attached: NOTHING_ATTACHED,
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
  hostSocket: "/run/pinetrie/ssh-3.sock",
  hostAddress: "192.168.127.254",
  remoteHostPaths: true,
}
const render = (shape: ContainerShape, target = mac) =>
  renderRun(shape, {
    target,
    disks,
    project: key,
    seccomp: "/opt/p/seccomp.json",
  })

const shapes: readonly ContainerShape[] = [
  planShape(spec, {}),
  planShape(
    {
      ...spec,
      attached: {
        hostSocket: "/run/pinetrie/ssh-host.sock",
        mounts: [],
        env: {},
        starts: ["hop serve"],
      },
    },
    {},
  ),
  planShape({ ...spec, grants: { ...spec.grants, nested: true } }, {}),
]

describe("renderRun: a lane's shape as a container", () => {
  test("no shape gets a capability, or a Docker socket", () => {
    for (const shape of shapes) {
      const made = render(shape)
      expect([made.capAdd, made.capDrop]).toEqual([[], []])
      for (const m of made.mounts)
        expect(m.source).not.toMatch(/docker\.sock|\/var\/run|\/run\/docker/)
    }
  })
  test("the lane's subvolume at /workspace; every mount through pathOf, read-only where it says", () => {
    const { mounts } = render(shapes[0] as ContainerShape)
    expect(mounts[0]).toEqual({
      source: disks.lane(LANE),
      target: "/workspace",
      readonly: false,
    })
    for (const m of spec.mounts)
      expect(mounts).toContainEqual({
        source: mac.pathOf(m.source),
        target: m.target,
        readonly: m.readonly,
      })
    expect(mounts.filter(m => m.readonly).length).toBe(
      spec.mounts.filter(m => m.readonly).length,
    )
  })
  test("the lane's hostname is its container's name, as under container", () => {
    expect(render(shapes[0] as ContainerShape).hostname).toBe(
      `pinetrie-${LANE}`,
    )
  })
  test("the project's and the target's labels; the image and its command", () => {
    const made = render(shapes[0] as ContainerShape)
    expect(made.labels).toEqual({
      "pinetrie.project": key,
      "pinetrie.slot": "3",
    })
    expect([made.image, made.cmd]).toEqual([
      "pinetrie-lane:abc",
      ["sleep", "infinity"],
    ])
  })
  test("the host socket is mounted where the shape says, only when it asks for one", () => {
    expect(JSON.stringify(render(shapes[0] as ContainerShape))).not.toContain(
      "ssh",
    )
    const made = render(shapes[1] as ContainerShape)
    expect(made.mounts).toContainEqual({
      source: "/run/pinetrie/ssh-3.sock",
      target: "/run/pinetrie/ssh-host.sock",
      readonly: false,
    })
  })
  test("a lane's starts run in the background before its wait, and before a nested lane's Docker", () => {
    expect(laneCommand({ nested: false, starts: [] })).toEqual([
      "sleep",
      "infinity",
    ])
    expect(laneCommand({ nested: false, starts: ["a", "b"] })).toEqual([
      "sh",
      "-c",
      "(a &); (b &); exec sleep infinity",
    ])
    expect(laneCommand({ nested: true, starts: ["a"] })).toEqual([
      "sh",
      "-c",
      "(a &); (pinetrie-inner-docker &); exec sleep infinity",
    ])
  })
  test("the nested options only for a nested shape; every other lane has no-new-privileges", () => {
    const plain = render(shapes[0] as ContainerShape)
    expect(plain.securityOpt).toEqual(["no-new-privileges"])
    expect(plain.devices).toEqual([])
    const nested = render(shapes[2] as ContainerShape)
    expect(nested.securityOpt).toEqual([
      "seccomp=/opt/p/seccomp.json",
      "systempaths=unconfined",
    ])
    expect(nested.devices).toEqual(["/dev/net/tun"])
    expect(nested.mounts).toContainEqual({
      source: disks.nested(LANE),
      target: NESTED_MOUNT,
      readonly: false,
    })
    expect(nested.env).toContain(
      "DOCKER_HOST=unix:///run/user/1000/docker.sock",
    )
    expect(nested.cmd).toEqual([
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
      hostSocket: null,
      hostAddress: null,
      remoteHostPaths: false,
    }
    const made = render(shapes[1] as ContainerShape, linux)
    expect(made.mounts).toContainEqual({
      source: "/Users/ada/p",
      target: "/mnt/host-working-copy",
      readonly: true,
    })
    expect(JSON.stringify(made.mounts)).not.toContain("ssh-host.sock")
    expect(made.labels).toEqual({ "pinetrie.project": key })
  })
  test("the spec label is a label like any other", () => {
    expect(labelled(render(shapes[0] as ContainerShape), "h").labels).toEqual({
      "pinetrie.project": key,
      "pinetrie.slot": "3",
      "pinetrie.spec": "h",
    })
  })
})

describe("renderHelper: a lanehost role's container", () => {
  const shape = {
    project: key,
    image: "pinetrie-lanehost:abc",
    lanesDir: "/var/lib/lanehost",
    install: "/opt/pinetrie",
    runtime: "/Users/ada/p/.pinetrie/runtime/abc",
  }
  test("the disks role: Docker's default capabilities, no network, the lanes directory read-write", () => {
    const made = renderHelper({ ...shape, role: "disks" }, mac)
    expect(made.name).toBe(lanehostContainer("disks", key, mac))
    expect(lanehostContainer("disks", key, mac)).toBe(
      `pinetrie-lanehost-disks-${key}-3`,
    )
    expect([made.capDrop, made.capAdd, made.network]).toEqual([[], [], "none"])
    expect(made.mounts[0]).toEqual({
      source: "/var/lib/lanehost",
      target: "/var/lib/lanehost",
      readonly: false,
    })
    expect(made.labels).toEqual({
      "pinetrie.project": key,
      "pinetrie.slot": "3",
      "pinetrie.lanehost": "disks",
    })
  })
  test("the privileged role: every capability dropped but its own, the lanes directory read-only", () => {
    const made = renderHelper({ ...shape, role: "privileged" }, mac)
    expect([made.capDrop, made.capAdd, made.network]).toEqual([
      ["ALL"],
      ["NET_ADMIN", "NET_RAW", "SYS_ADMIN"],
      "host",
    ])
    expect(made.mounts[0]?.readonly).toBe(true)
  })
  test("the install and the runtime, read-only where a lane has them, through the slot", () => {
    const made = renderHelper({ ...shape, role: "disks" }, mac)
    expect(made.mounts.slice(1)).toEqual([
      {
        source: mac.pathOf("/opt/pinetrie"),
        target: "/pinetrie",
        readonly: true,
      },
      {
        source: mac.pathOf(shape.runtime),
        target: "/pinetrie-runtime",
        readonly: true,
      },
    ])
    expect([made.image, made.cmd]).toEqual([shape.image, ["sleep", "infinity"]])
  })
  test("on Linux, no slot in its name", () => {
    expect(lanehostContainer("disks", key, { labels: {} })).toBe(
      `pinetrie-lanehost-disks-${key}`,
    )
  })
})

test("isRootless: Docker's security options name a rootless daemon", () => {
  expect(
    isRootless([
      "name=seccomp,profile=builtin",
      "name=rootless",
      "name=cgroupns",
    ]),
  ).toBe(true)
  expect(isRootless(["name=seccomp,profile=builtin", "name=cgroupns"])).toBe(
    false,
  )
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
})

test("imagePathOf: an image's PATH, else the standard one", () => {
  expect(imagePathOf(["A=1", "PATH=/a:/b"])).toBe("/a:/b")
  expect(imagePathOf(null)).toBe(
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
    expect(render(shapes[0] as ContainerShape).network).toBe(`pinetrie-${key}`)
  })
  test("a lane is told the host's address and its granted ports, where the target has an address", () => {
    expect(render(granted).env).toEqual(
      expect.arrayContaining([
        "PINETRIE_HOST=192.168.127.254",
        "PINETRIE_HOST_PORTS=3000,5432",
      ]),
    )
    expect(render(shapes[0] as ContainerShape).env.join(" ")).not.toContain(
      "PINETRIE_HOST",
    )
    const linux: DockerTarget = { ...mac, hostAddress: null }
    expect(render(granted, linux).env.join(" ")).not.toContain("PINETRIE_HOST")
  })
})
