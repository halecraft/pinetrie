import {
  MACHINE_SOCKET,
  OBSERVER_LOADER,
  OBSERVER_SERVER,
} from "@pinetrie/lanehost"
import { PINETRIE_MOUNT, runtimeNode } from "@pinetrie/lanes"
import { describe, expect, test } from "vitest"
import { createBody, memoryBytes, parseListed } from "./api.ts"
import { type ContainerSpec, renderObserver } from "./plan.ts"

const spec: ContainerSpec = {
  name: "pinetrie-t-1",
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
  machine: null,
}

describe("createBody: a spec as the API's create", () => {
  test("every container runs --init, with its mounts as binds, read-only where they say", () => {
    const body = createBody(spec, () => "")
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
})

test("memoryBytes reads -m as the CLI does: units of 1024", () => {
  expect(memoryBytes("4G")).toBe(4 * 1024 ** 3)
  expect(memoryBytes("256m")).toBe(256 * 1024 ** 2)
  expect(memoryBytes("1g")).toBe(1024 ** 3)
  expect(() => memoryBytes("lots")).toThrow("not an amount of memory")
})

test("the machine role's container is made with its grant and nothing more", () => {
  const body = createBody(renderObserver("abc"), () => "")
  expect(body).toEqual({
    Image: "pinetrie-observer:abc",
    Cmd: [
      ...runtimeNode(`${PINETRIE_MOUNT}/${OBSERVER_SERVER}`),
      MACHINE_SOCKET,
      OBSERVER_LOADER,
      "abc",
    ],
    Env: [],
    Labels: {},
    HostConfig: {
      Init: true,
      NetworkMode: "none",
      Memory: 512 * 1024 ** 2,
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
  test("each container's name, labels and bind sources", () => {
    const body = JSON.stringify([
      {
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
        name: "pinetrie-t-1",
        labels: { "pinetrie.project": "k" },
        binds: ["/mnt/host-shares/2/abc", "/l/t"],
      },
      { name: "bare", labels: {}, binds: [] },
    ])
  })
  test("an answer that is not a list lists nothing", () => {
    expect(parseListed("not json")).toEqual([])
  })
})
