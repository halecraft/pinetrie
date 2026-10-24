import { mkdtemp, rm } from "node:fs/promises"
import http from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  MACHINE_SOCKET,
  OBSERVER_LOADER,
  observerHeapBytes,
  observerMemoryBytes,
} from "@pinetrie/lanehost"
import { RUNTIME_NODE } from "@pinetrie/lanes"
import { describe, expect, test } from "vitest"
import {
  createBody,
  isCreateRefusedForMissingImage,
  isImageRemovalSettled,
  memoryBytes,
  parseImages,
  parseListed,
  requestRetried,
  runContainer,
} from "./api.ts"
import { type ContainerSpec, renderObserver } from "./plan.ts"

const spec: ContainerSpec = {
  name: "pinetrie-t-1",
  kind: "lane",
  hostname: "pinetrie-t-1",
  image: "pinetrie-lane:abc",
  cmd: ["sleep", "infinity"],
  workingDir: "/workspace",
  env: ["A=1"],
  labels: { "pinetrie.project": "k" },
  mounts: [
    { source: "/l/a,b", target: "/workspace", readonly: false },
    { source: "/h", target: "/mnt/host-working-copy", readonly: true },
  ],
  network: "pinetrie-k",
  memory: "4G",
  capDrop: [],
  capAdd: [],
  securityOpt: ["no-new-privileges"],
  devices: [],
}

/** A target with no services' parent: a Linux host's. */
const LINUX = { hasServicesParent: false }
/** The lane VM's, whose `init` made the services' parent. */
const LANE_VM = { hasServicesParent: true }

describe("createBody: a spec as the API's create", () => {
  test("every container runs --init, with its mounts as binds, read-only where they say", () => {
    const body = createBody(spec, () => "", LINUX)
    const host = body.HostConfig as Record<string, unknown>
    expect(host.Init).toBe(true)
    expect(host.Memory).toBe(4 * 1024 ** 3)
    expect(host.Mounts).toEqual([
      { Type: "bind", Source: "/l/a,b", Target: "/workspace", ReadOnly: false },
      {
        Type: "bind",
        Source: "/h",
        Target: "/mnt/host-working-copy",
        ReadOnly: true,
      },
    ])
    expect(host.SecurityOpt).toEqual(["no-new-privileges"])
    expect("MaskedPaths" in host).toBe(false)
  })
  test("a nested lane: the profile's content, no masked paths, its device", () => {
    const body = createBody(
      {
        ...spec,
        securityOpt: ["seccomp=/opt/p/seccomp.json", "systempaths=unconfined"],
        devices: ["/dev/net/tun"],
      },
      file => (file === "/opt/p/seccomp.json" ? '{"defaultAction":"x"}' : ""),
      LINUX,
    )
    const host = body.HostConfig as Record<string, unknown>
    expect(host.SecurityOpt).toEqual(['seccomp={"defaultAction":"x"}'])
    expect([host.MaskedPaths, host.ReadonlyPaths]).toEqual([[], []])
    expect(host.Devices).toEqual([
      {
        PathOnHost: "/dev/net/tun",
        PathInContainer: "/dev/net/tun",
        CgroupPermissions: "rwm",
      },
    ])
  })

  test("each kind carries its process limit, CPU share and OOM priority", () => {
    const limits = (kind: ContainerSpec["kind"]) => {
      const host = createBody({ ...spec, kind }, () => "", LANE_VM)
        .HostConfig as Record<string, unknown>
      return [host.PidsLimit, host.CpuShares, host.OomScoreAdj]
    }
    expect(limits("lane")).toEqual([16_384, 1024, 500])
    expect(limits("disks")).toEqual([1024, 4096, -500])
    expect(limits("privileged")).toEqual([1024, 4096, -500])
    expect(limits("observer")).toEqual([1024, 4096, -500])
  })

  test("a service goes under the services' parent only on a target that has one, and a lane never", () => {
    const parent = (kind: ContainerSpec["kind"], target: typeof LINUX) =>
      (
        createBody({ ...spec, kind }, () => "", target).HostConfig as Record<
          string,
          unknown
        >
      ).CgroupParent
    expect(parent("disks", LANE_VM)).toBe("/pinetrie-services")
    expect(parent("observer", LANE_VM)).toBe("/pinetrie-services")
    expect(parent("lane", LANE_VM)).toBeUndefined()
    expect(parent("disks", LINUX)).toBeUndefined()
  })

  test("only the observer's kind gets the machine's pid namespace", () => {
    const host = (kind: ContainerSpec["kind"]) =>
      createBody({ ...spec, kind }, () => "", LANE_VM).HostConfig as Record<
        string,
        unknown
      >
    expect(host("observer").PidMode).toBe("host")
    for (const kind of ["lane", "disks", "privileged"] as const)
      expect(
        ["PidMode", "ReadonlyRootfs", "AutoRemove", "Tmpfs"].filter(
          k => k in host(kind),
        ),
      ).toEqual([])
  })
})

test("memoryBytes reads -m as the CLI does: units of 1024", () => {
  expect(memoryBytes("4G")).toBe(4 * 1024 ** 3)
  expect(memoryBytes("256m")).toBe(256 * 1024 ** 2)
  expect(memoryBytes("1g")).toBe(1024 ** 3)
  expect(() => memoryBytes("lots")).toThrow("not an amount of memory")
})

test("the machine role's container is made with its grant and nothing more", () => {
  const body = createBody(
    renderObserver("abc", { form: "built" }),
    () => "",
    LANE_VM,
  )
  expect(body).toEqual({
    Image: "pinetrie-observer:abc",
    Cmd: [
      ...RUNTIME_NODE,
      `--max-old-space-size=${Math.ceil(observerHeapBytes() / 1024 ** 2)}`,
      "/pinetrie/packages/lanehost/observer-server.js",
      MACHINE_SOCKET,
      OBSERVER_LOADER,
      "abc",
    ],
    Env: [],
    Labels: {},
    HostConfig: {
      Init: true,
      NetworkMode: "none",
      Memory: observerMemoryBytes(),
      PidsLimit: 1024,
      CpuShares: 4096,
      OomScoreAdj: -500,
      CgroupParent: "/pinetrie-services",
      Mounts: [],
      CapAdd: ["BPF", "PERFMON", "SYS_PTRACE"],
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      Devices: [],
      PidMode: "host",
      ReadonlyRootfs: true,
      AutoRemove: true,
      Tmpfs: { "/run": "" },
    },
  })
})

describe("parseListed: the API's container list", () => {
  test("each container's id, name, state, labels and bind sources", () => {
    const body = JSON.stringify([
      {
        Id: "abc123",
        State: "running",
        Names: ["/pinetrie-t-1"],
        Labels: { "pinetrie.project": "k" },
        Mounts: [
          { Type: "bind", Source: "/mnt/host-shares/2/abc", Destination: "/h" },
          { Type: "bind", Source: "/l/t", Destination: "/workspace" },
        ],
      },
      { Names: ["/bare"], Labels: null, Mounts: null },
    ])
    expect(parseListed(body)).toEqual([
      {
        id: "abc123",
        name: "pinetrie-t-1",
        state: "running",
        labels: { "pinetrie.project": "k" },
        binds: ["/mnt/host-shares/2/abc", "/l/t"],
      },
      { id: "", name: "bare", state: "", labels: {}, binds: [] },
    ])
  })
  test("an answer that is not a list lists nothing", () => {
    expect(parseListed("not json")).toEqual([])
  })
})

test("parseImages: each image's id and tags; an untagged one has none", () => {
  const body = JSON.stringify([
    { Id: "sha256:a", RepoTags: ["pinetrie-lane:1", "pinetrie-lane:2"] },
    { Id: "sha256:b", RepoTags: null },
    { RepoTags: ["no-id:1"] },
  ])
  expect(parseImages(body)).toEqual([
    { id: "sha256:a", tags: ["pinetrie-lane:1", "pinetrie-lane:2"] },
    { id: "sha256:b", tags: [] },
  ])
  expect(parseImages("not json")).toEqual([])
})

test("a create refused for a missing image is told from any other refusal", () => {
  const answered = (status: number, message: string) => ({
    status,
    body: JSON.stringify({ message }),
  })
  expect(
    isCreateRefusedForMissingImage(
      answered(404, "No such image: pinetrie-lane:abc"),
    ),
  ).toBe(true)
  expect(
    isCreateRefusedForMissingImage(
      answered(404, "network pinetrie-k not found"),
    ),
  ).toBe(false)
  expect(
    isCreateRefusedForMissingImage(answered(409, "No such image: x")),
  ).toBe(false)
})

test("an image's removal is settled when done, gone, or held by a container", () => {
  const status = (s: number) => isImageRemovalSettled({ status: s, body: "" })
  expect([200, 404, 409].map(status)).toEqual([true, true, true])
  expect(status(500)).toBe(false)
})

/**
 * A Docker API on a socket of its own whose first connection is destroyed
 * before it answers, as the lane VM's proxy resets one just after it boots;
 * every later request is answered. Each request is recorded.
 */
async function droppingDocker() {
  const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-docker-"))
  const socket = path.join(dir, "docker.sock")
  const requests: string[] = []
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url ?? ""}`)
    if (requests.length === 1) {
      req.socket.destroy()
      return
    }
    res.end("{}")
  })
  await new Promise<void>(r => server.listen(socket, r))
  return {
    socket,
    requests,
    async close() {
      server.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

test("a request that changes nothing when repeated is answered on a second connection when its first drops", async () => {
  const docker = await droppingDocker()
  try {
    const answered = await requestRetried(
      { socket: docker.socket },
      "POST",
      "/containers/c/stop?t=0",
    )
    expect(answered.status).toBe(200)
    expect(docker.requests).toEqual([
      "POST /containers/c/stop?t=0",
      "POST /containers/c/stop?t=0",
    ])
  } finally {
    await docker.close()
  }
})

test("a create whose connection drops is not tried again", async () => {
  const docker = await droppingDocker()
  try {
    await expect(
      runContainer({ socket: docker.socket, ...LINUX }, spec),
    ).rejects.toThrow()
    expect(docker.requests).toEqual([
      "POST /containers/create?name=pinetrie-t-1",
    ])
  } finally {
    await docker.close()
  }
})
