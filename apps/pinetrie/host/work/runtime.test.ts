import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ProjectRecord } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import {
  builderWords,
  findProject,
  planBuilder,
  planHostPortGrant,
  planRuntime,
  projectOf,
  RuntimeRefused,
} from "./runtime.ts"

test("projectOf keeps a project's own copies, and turns its default direct only with PINETRIE_LANES=0", () => {
  const lanes: ProjectRecord = {
    kind: "lanes",
    root: "/repo",
    rootDefault: "own",
  }
  const direct: ProjectRecord = {
    kind: "direct",
    root: "/repo",
    reason: "no container",
  }
  expect(projectOf({ project: lanes }, true)).toEqual({
    ...lanes,
    rootDefault: "direct",
  })
  expect(projectOf({ project: lanes }, false)).toEqual(lanes)
  expect(projectOf({ project: direct }, true)).toEqual(direct)
  expect(projectOf({ project: direct }, false)).toEqual(direct)
  expect(projectOf(null, true)).toBe(null)
})

describe("planBuilder: the first Linux runtime found builds the VM's image", () => {
  const none = {
    vmDocker: false,
    hostDocker: false,
    container: false,
  }
  test("the VM's own Docker first, on any platform", () => {
    expect(
      planBuilder({
        ...none,
        platform: "darwin",
        vmDocker: true,
        container: true,
      }),
    ).toEqual({ kind: "docker-vm" })
  })
  test("the host's Docker on Linux; on the Mac, Apple's container", () => {
    expect(
      planBuilder({ ...none, platform: "linux", hostDocker: true }),
    ).toEqual({
      kind: "docker-host",
    })
    expect(
      planBuilder({
        ...none,
        platform: "darwin",
        hostDocker: true,
        container: true,
      }),
    ).toEqual({ kind: "container" })
  })
  test("none: worded with what would let it", () => {
    const mac = planBuilder({ ...none, platform: "darwin" })
    expect(mac).toEqual({ kind: "none", platform: "darwin" })
    if (mac.kind === "none")
      expect(builderWords(mac)).toContain("container system start")
    const linux = planBuilder({ ...none, platform: "linux" })
    if (linux.kind === "none")
      expect(builderWords(linux)).toContain("docker version")
  })
})

describe("planRuntime: container when chosen; else Docker, in the VM on the Mac and the host's own on Linux", () => {
  const facts = {
    platform: "darwin" as NodeJS.Platform,
    choice: "docker" as const,
    nestedMount: false,
    stateHome: "/h/.local/state",
  }
  test("container, wherever it was chosen", () => {
    expect(planRuntime({ ...facts, choice: "container" })).toEqual({
      kind: "container",
    })
  })
  test("Docker on the Mac is the lane VM's", () => {
    expect(planRuntime(facts)).toEqual({
      kind: "docker-vm",
      lanesDir: "/var/lib/lanehost",
    })
  })
  test("on Linux, the host's Docker, its disks under the state directory", () => {
    expect(planRuntime({ ...facts, platform: "linux" })).toEqual({
      kind: "docker-host",
      lanesDir: "/h/.local/state/pinetrie/lanes",
    })
  })
  test("inside a lane granted lanes of its own, its inner lanes' directory", () => {
    expect(
      planRuntime({ ...facts, platform: "linux", nestedMount: true }),
    ).toEqual({ kind: "docker-host", lanesDir: "/var/lib/pinetrie-lanes" })
  })
})

// Off the Mac only: there, asking Docker takes a lease on the person's VM.
describe.skipIf(process.platform === "darwin")(
  "a runtime's refusal stops a host, or makes a suite's work directly",
  () => {
    const noDocker = { ...process.env, DOCKER_HOST: "unix:///nonexistent.sock" }
    test("stop throws the runtime's words; direct keeps them as the reason", async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "pinetrie-refused-"))
      execFileSync("jj", ["git", "init", "--colocate"], {
        cwd: dir,
        stdio: "ignore",
      })
      const saved = process.env.DOCKER_HOST
      process.env.DOCKER_HOST = noDocker.DOCKER_HOST
      try {
        const input = {
          dir,
          defaultDirect: false,
          containers: true,
          machine: { runtime: "docker", slots: null },
          log: () => {},
        } as const
        await expect(findProject(input)).rejects.toBeInstanceOf(RuntimeRefused)
        const found = await findProject({ ...input, runtimeRefused: "direct" })
        expect(found?.project).toMatchObject({ kind: "direct", root: dir })
        expect(
          found?.project.kind === "direct" ? found.project.reason : "",
        ).toContain("Docker does not answer")
      } finally {
        if (saved === undefined) delete process.env.DOCKER_HOST
        else process.env.DOCKER_HOST = saved
        rmSync(dir, { recursive: true, force: true })
      }
    })
  },
)

test("planHostPortGrant: the granted ports, but the host's own, refused with why", () => {
  expect(planHostPortGrant([3000, 7391], 7391)).toEqual({
    grant: [3000],
    refused: [
      "lanes.hostPorts 7391 is not granted: it is this pine·trie host's own port, which takes no key on loopback",
    ],
  })
  expect(planHostPortGrant([3000, 7391], null)).toEqual({
    grant: [3000, 7391],
    refused: [],
  })
})
