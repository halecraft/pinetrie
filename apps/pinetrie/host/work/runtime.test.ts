import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { thisInstall } from "@pinetrie/install"
import { describe, expect, test } from "vitest"
import { findProject, planRuntime } from "./runtime.ts"

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
        root: dir,
        install: thisInstall,
        slots: 16,
        hostSocket: path.join(dir, ".no-ssh.sock"),
        log: () => {},
        building: () => {},
        manage: "manage",
      })
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
          root: null,
          install: thisInstall,
          slots: 16,
          hostSocket: "/no-ssh.sock",
          log: () => {},
          building: () => {},
          manage: "manage",
        }),
      ).toBeNull()
    })
  },
)
