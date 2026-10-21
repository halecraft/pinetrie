import { thisInstall } from "@pinetrie/install"
import { baseLane } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { projectKey } from "./plan.ts"
import { dockerRuntime } from "./runtime.ts"
import type { DockerTarget } from "./target.ts"

const linux: DockerTarget = {
  socket: "/s/docker.sock",
  pathOf: p => p,
  labels: {},
  hostSocket: null,
  hostAddress: null,
  remoteHostPaths: false,
}

test("a runtime builds its base in its own project's scratch lane", () => {
  const baseOf = (root: string) =>
    dockerRuntime({
      target: linux,
      lanesDir: "/var/lib/lanehost",
      root,
      install: thisInstall,
    }).baseLane
  expect([baseOf("/home/ada/one"), baseOf("/home/ada/two")]).toEqual([
    baseLane(projectKey("/home/ada/one")),
    baseLane(projectKey("/home/ada/two")),
  ])
})
