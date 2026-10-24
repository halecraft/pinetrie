import { readFileSync } from "node:fs"
import path from "node:path"
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
import { createBody } from "./api.ts"
import { buildError } from "./cli.ts"
import {
  cgroupMount,
  containerService,
  type DockerHostFacts,
  dockerWords,
  eventsSince,
  HOST_CGROUP,
  INNER_DOCKER_DATA_ROOT_DIR,
  imageEnvPath,
  isNewEvent,
  isRootless,
  LANEHOST_LABEL,
  type Listed,
  labelled,
  laneCommand,
  lanehostContainer,
  NESTED_MOUNT,
  observerContainer,
  PROJECT_LABEL,
  parseMountinfo,
  parseOomEvent,
  planDockerHost,
  planProjectSweep,
  planSlotSweep,
  projectKey,
  renderHelper,
  renderRun,
  runningLanes,
  runningServices,
  systemTimeNanos,
  unneededImageTags,
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
  states: false,
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
  test("every shape keeps a PID namespace of its own: the observer's lane is it", () => {
    for (const shape of shapes) {
      const host = createBody(render(shape), () => "").HostConfig as Record<
        string,
        unknown
      >
      expect(host.PidMode).toBeUndefined()
    }
  })
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
  test("a folder lane sees its states directory, read-only; a jj lane's spec has no such mount", () => {
    const folder = render(planShape({ ...spec, states: true }, {}))
    expect(folder.mounts).toContainEqual({
      source: disks.states(LANE),
      target: "/pinetrie-states",
      readonly: true,
    })
    expect(
      render(shapes[0] as ContainerShape).mounts.map(m => m.target),
    ).not.toContain("/pinetrie-states")
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
    root: "/Users/ada/p",
    install: "/opt/pinetrie",
    runtime: "/Users/ada/p/.pinetrie/runtime/abc",
    rootless: false,
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
    expect(made.mounts.map(m => m.target)).not.toContain("/pinetrie-folder")
  })
  test("the install and the runtime, read-only where a lane has them, and the disks role's project root, through the slot", () => {
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
      {
        source: mac.pathOf("/Users/ada/p"),
        target: "/pinetrie-folder",
        readonly: true,
      },
      { source: "/sys/fs/cgroup", target: "/host-cgroup", readonly: true },
    ])
    expect([made.image, made.cmd]).toEqual([shape.image, ["sleep", "infinity"]])
  })
  test("the disks role reads the machine's cgroup tree read-only, and the privileged role has none", () => {
    const disks = renderHelper({ ...shape, role: "disks" }, mac)
    expect(disks.mounts.filter(m => m.source === "/sys/fs/cgroup")).toEqual([
      { source: "/sys/fs/cgroup", target: HOST_CGROUP, readonly: true },
    ])
    expect(cgroupMount("disks", false)).toBe(HOST_CGROUP)
    const privileged = renderHelper({ ...shape, role: "privileged" }, mac)
    expect(privileged.mounts.map(m => m.source)).not.toContain("/sys/fs/cgroup")
    expect(cgroupMount("privileged", false)).toBeNull()
  })
  test("under rootless Docker no role is given the cgroup tree", () => {
    for (const role of ["disks", "privileged"] as const) {
      const made = renderHelper({ ...shape, role, rootless: true }, mac)
      expect(made.mounts.map(m => m.source)).not.toContain("/sys/fs/cgroup")
      expect(cgroupMount(role, true)).toBeNull()
    }
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
  const c = (
    name: string,
    labels: Record<string, string>,
    binds: readonly string[] = [],
  ): Listed => ({ id: "", name, state: "running", labels, binds })
  test("a slot's sweep takes every container with a bind into it, whatever its labels", () => {
    expect(
      planSlotSweep("/mnt/host-shares/3/", [
        c("a", { "pinetrie.slot": "3" }, ["/mnt/host-shares/3/abc"]),
        c("extra", { "pinetrie.slot": "1" }, [
          "/lanes/k/t",
          "/mnt/host-shares/3/def",
        ]),
        c("b", { "pinetrie.slot": "13" }, ["/mnt/host-shares/13/abc"]),
        c("labelled-only", { "pinetrie.slot": "3" }),
      ]),
    ).toEqual(["a", "extra"])
  })
  test("a root is a whole path: slot 1's is not slot 10's", () => {
    expect(
      planSlotSweep("/mnt/host-shares/1", [
        c("one", {}, ["/mnt/host-shares/1/abc"]),
        c("ten", {}, ["/mnt/host-shares/10/abc"]),
      ]),
    ).toEqual(["one"])
  })
  test("the startup sweep takes the containers and disks of projects whose root is gone", () => {
    expect(
      planProjectSweep({
        ownKey: "own",
        lanesDir: "/lanes",
        projects: [
          { key: "k1", rootExists: true },
          { key: "k2", rootExists: false },
        ],
        containers: [
          c("a", { "pinetrie.project": "k1" }),
          c("b", { "pinetrie.project": "k2" }),
        ],
      }),
    ).toEqual({ containers: ["b"], projects: ["k2"], unlistedNetworks: [] })
  })
  test("it takes an unlisted project's containers in its lanes directory, and none elsewhere", () => {
    const under = "/lanes/projects/x/lanes/t"
    expect(
      planProjectSweep({
        ownKey: "own",
        lanesDir: "/lanes",
        projects: [],
        containers: [
          c("mine", { "pinetrie.project": "own" }, [under]),
          c("cloned", { "pinetrie.project": "x" }, [under, "/lanes/x2"]),
          c("other-dir", { "pinetrie.project": "y" }, ["/other/lanes/t"]),
          c("half", { "pinetrie.project": "z" }, [under, "/elsewhere"]),
          c("next-door", { "pinetrie.project": "w" }, ["/lanes2/t"]),
          c("no-binds", { "pinetrie.project": "v" }),
        ],
      }),
    ).toEqual({ containers: ["cloned"], projects: [], unlistedNetworks: ["x"] })
  })
  test("an unlisted project's network stays while it has a container left", () => {
    expect(
      planProjectSweep({
        ownKey: "own",
        lanesDir: "/lanes",
        projects: [],
        containers: [
          c("in", { "pinetrie.project": "x" }, ["/lanes/a"]),
          c("out", { "pinetrie.project": "x" }, ["/elsewhere"]),
        ],
      }).unlistedNetworks,
    ).toEqual([])
  })
})

describe("unneededImageTags: what a host removes after a build", () => {
  const unneeded = (
    needed: readonly string[],
    images: readonly (readonly [string, readonly string[]])[],
    used: readonly string[] = [],
  ) =>
    unneededImageTags({
      neededTags: new Set(needed),
      listedImages: images.map(([id, tags]) => ({ id, tags })),
      imageIdsContainersUse: new Set(used),
    })
  test("a needed tag is never removed, though it shares a repository with another", () => {
    expect(
      unneeded(
        ["pinetrie-lane:default", "pinetrie-lane:project"],
        [
          ["a", ["pinetrie-lane:default"]],
          ["b", ["pinetrie-lane:project"]],
          ["c", ["pinetrie-lane:old"]],
        ],
      ),
    ).toEqual(["pinetrie-lane:old"])
  })
  test("an image a container was made from keeps all its tags", () => {
    expect(
      unneeded(
        [],
        [
          ["a", ["pinetrie-observer:old", "pinetrie-observer:older"]],
          ["b", ["pinetrie-lanehost:old"]],
        ],
        ["a"],
      ),
    ).toEqual(["pinetrie-lanehost:old"])
  })
  test("an image of any other repository is never touched", () => {
    expect(
      unneeded(
        [],
        [
          ["a", ["alpine:3.23", "pinetrie-lanes:x", "my/pinetrie-lane:y"]],
          ["b", ["pinetrie-lane:x"]],
        ],
      ),
    ).toEqual(["pinetrie-lane:x"])
  })
})

test("the lane image's inner Docker keeps its data at the data root a fork clones", () => {
  const containerfile = readFileSync(
    path.join(import.meta.dirname, "..", "lanes", "image", "Containerfile"),
    "utf8",
  )
  expect(containerfile).toContain(
    `--data-root ${NESTED_MOUNT}/${INNER_DOCKER_DATA_ROOT_DIR} `,
  )
})

test("imageEnvPath: an image's PATH, else the standard one", () => {
  expect(imageEnvPath(["A=1", "PATH=/a:/b"])).toBe("/a:/b")
  expect(imageEnvPath(null)).toBe(
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

test("the running lanes are the running containers named for a thread", () => {
  const id = "a".repeat(64)
  const thread = "t-0197a3c2-5b1e-7c4d-8e2f-1a2b3c4d5e6f"
  const listed = (name: string, state: string) => ({
    id,
    name,
    state,
    labels: {},
    binds: [],
  })
  expect(
    runningLanes([
      listed(`pinetrie-${thread}`, "running"),
      listed(`pinetrie-${thread.replace("6f", "70")}`, "exited"),
      listed(`pinetrie-lanehost-disks-${key}`, "running"),
      listed(`pinetrie-base-scratch-${key}`, "running"),
    ]),
  ).toEqual([{ lane: thread, id }])
})

describe("the events a service's kill is heard from", () => {
  const line = (action: string, attributes: Record<string, string>) =>
    `{"status":"${action}","Type":"container","Action":"${action}","Actor":{"ID":"c1","Attributes":${JSON.stringify(attributes)}},"scope":"local","time":1792686556,"timeNano":1792686556215607848}`

  test("an oom's time is kept to the nanosecond", () => {
    expect(parseOomEvent(line("oom", { name: "x", image: "i" }))).toEqual({
      timeNano: 1792686556215607848n,
      name: "x",
      labels: { name: "x", image: "i" },
    })
  })

  test("a line that is not a container's oom is no kill", () => {
    expect(parseOomEvent(line("die", { name: "x" }))).toBeNull()
    expect(parseOomEvent("not json")).toBeNull()
  })

  const ours = { project: "p1", observer: observerContainer("v1") }
  const event = (name: string, labels: Record<string, string> = {}) => ({
    timeNano: 1n,
    name,
    labels: { name, ...labels },
  })

  test("each role of this project, and this version's observer, is named", () => {
    expect([
      containerService(
        event("r", { [PROJECT_LABEL]: "p1", [LANEHOST_LABEL]: "disks" }),
        ours,
      ),
      containerService(
        event("r", { [PROJECT_LABEL]: "p1", [LANEHOST_LABEL]: "privileged" }),
        ours,
      ),
      containerService(event(observerContainer("v1")), ours),
    ]).toEqual(["disks", "privileged", "observer"])
  })

  test("a lane, another project's role and another version's observer are none", () => {
    expect([
      containerService(event("pinetrie-t-1", { [PROJECT_LABEL]: "p1" }), ours),
      containerService(
        event("r", { [PROJECT_LABEL]: "p2", [LANEHOST_LABEL]: "disks" }),
        ours,
      ),
      containerService(event(observerContainer("v0")), ours),
      containerService(event(observerContainer("v1")), {
        ...ours,
        observer: null,
      }),
    ]).toEqual([null, null, null, null])
  })

  test("the services running are this project's roles and this version's observer, each by its full id", () => {
    const listed = (
      id: string,
      name: string,
      state: string,
      labels: Record<string, string> = {},
    ) => ({ id, name, state, labels, binds: [] })
    expect(
      runningServices(
        [
          listed("d1", "r1", "running", {
            [PROJECT_LABEL]: "p1",
            [LANEHOST_LABEL]: "disks",
          }),
          listed("p1", "r2", "exited", {
            [PROJECT_LABEL]: "p1",
            [LANEHOST_LABEL]: "privileged",
          }),
          listed("l1", "pinetrie-t-1", "running", { [PROJECT_LABEL]: "p1" }),
          listed("o1", observerContainer("v1"), "running"),
        ],
        ours,
      ),
    ).toEqual([
      { service: "disks", id: "d1" },
      { service: "observer", id: "o1" },
    ])
  })

  test("a resume's since pads its nanoseconds", () => {
    expect(eventsSince(1792686556000000042n)).toBe("1792686556.000000042")
  })

  test("the event at the last one heard is not new", () => {
    expect([
      isNewEvent({ timeNano: 5n }, 5n),
      isNewEvent({ timeNano: 6n }, 5n),
    ]).toEqual([false, true])
  })

  test("the daemon's clock is read to the nanosecond", () => {
    expect(systemTimeNanos("2026-10-22T16:29:00.08483309Z")).toBe(
      1792686540084833090n,
    )
    expect(systemTimeNanos("2026-10-22T16:29:00Z")).toBe(1792686540000000000n)
    expect(systemTimeNanos("yesterday")).toBeNull()
  })
})
