import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  BUILDER_WORDS,
  findProject,
  planBuilder,
  planHostPortGrant,
  planRuntime,
} from "./runtime.ts"

describe("planBuilder: the first Docker found builds the VM's image", () => {
  test("the VM's own Docker first", () => {
    expect(planBuilder({ vmDocker: true, hostDocker: true })).toEqual({
      kind: "docker-vm",
    })
  })
  test("else a Docker on this machine, whatever its platform", () => {
    expect(planBuilder({ vmDocker: false, hostDocker: true })).toEqual({
      kind: "docker-host",
    })
  })
  test("none: worded with what would let it", () => {
    expect(planBuilder({ vmDocker: false, hostDocker: false })).toEqual({
      kind: "none",
    })
    expect(BUILDER_WORDS).toContain("docker version")
  })
})

describe("planRuntime: Docker, in the VM on the Mac and the host's own on Linux", () => {
  const facts = {
    platform: "darwin" as NodeJS.Platform,
    nestedMount: false,
    stateHome: "/h/.local/state",
  }
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
  "findProject: a host with tools that cannot run lanes is refused, in words",
  () => {
    const inRepo = async (
      init: readonly string[] | null,
      body: (dir: string) => Promise<void>,
    ) => {
      const dir = mkdtempSync(path.join(tmpdir(), "pinetrie-refused-"))
      if (init !== null)
        execFileSync(init[0] ?? "", init.slice(1), {
          cwd: dir,
          stdio: "ignore",
        })
      try {
        await body(dir)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
    const find = (dir: string) =>
      findProject({
        dir,
        machine: { slots: null },
        hostSocket: path.join(dir, ".no-ssh.sock"),
        log: () => {},
      })
    test("a folder with no jj repo, with how to make one", () =>
      inRepo(["git", "init"], async dir => {
        expect(await find(dir)).toEqual({
          kind: "refused",
          words: `${dir} has no jj repo: \`jj git init --colocate\` makes one, and gives its threads' agents their lanes`,
        })
      }))
    test("a Docker that does not answer, in the runtime's words", () =>
      inRepo(["jj", "git", "init", "--colocate"], async dir => {
        const saved = process.env.DOCKER_HOST
        process.env.DOCKER_HOST = "unix:///nonexistent.sock"
        try {
          const found = await find(dir)
          expect(found?.kind).toBe("refused")
          expect(found?.kind === "refused" ? found.words : "").toContain(
            "Docker does not answer",
          )
        } finally {
          if (saved === undefined) delete process.env.DOCKER_HOST
          else process.env.DOCKER_HOST = saved
        }
      }))
    test("no tools: nothing to find", async () => {
      expect(
        await findProject({
          dir: null,
          machine: { slots: null },
          hostSocket: "/no-ssh.sock",
          log: () => {},
        }),
      ).toBeNull()
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
