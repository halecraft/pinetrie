import { mkdtemp, rm } from "node:fs/promises"
import http from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { thisInstall } from "@pinetrie/install"
import { baseLane } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { PROJECT_LABEL, projectKey } from "./plan.ts"
import { dockerRuntime, stopSlot } from "./runtime.ts"
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

/**
 * A Docker API on a socket of its own: three containers bound into slot 0
 * (one running, one stopped, one gone by the time it is stopped) and one into
 * slot 1. Each wait is held until `release`; every request is recorded.
 */
async function standInDocker() {
  const dir = await mkdtemp(path.join(tmpdir(), "pinetrie-docker-"))
  const socket = path.join(dir, "docker.sock")
  const requests: string[] = []
  const held: (() => void)[] = []
  let waitsHeld = 0
  let onWaitHeld = () => {}
  const listed = [
    { Names: ["/running"], Mounts: [{ Source: "/mnt/host-shares/0/a" }] },
    { Names: ["/stopped"], Mounts: [{ Source: "/mnt/host-shares/0/b" }] },
    { Names: ["/gone"], Mounts: [{ Source: "/mnt/host-shares/0/a" }] },
    { Names: ["/elsewhere"], Mounts: [{ Source: "/mnt/host-shares/1/a" }] },
  ].map(c => ({ ...c, Labels: { [PROJECT_LABEL]: "k" } }))
  const server = http.createServer((req, res) => {
    const url = req.url ?? ""
    requests.push(`${req.method} ${url}`)
    const name = url.split("/")[2]?.split("?")[0]
    if (url.startsWith("/containers/json")) {
      res.end(JSON.stringify(listed))
      return
    }
    if (name === "gone") {
      res.statusCode = 404
      res.end("{}")
      return
    }
    if (url.includes("/stop?")) {
      res.statusCode = name === "stopped" ? 304 : 204
      res.end()
      return
    }
    if (url.includes("/wait?")) {
      held.push(() => res.end('{"StatusCode":137}'))
      waitsHeld++
      onWaitHeld()
      return
    }
    res.statusCode = 500
    res.end("{}")
  })
  await new Promise<void>(r => server.listen(socket, r))
  return {
    socket,
    requests,
    /** Settles once `n` waits are held. */
    waitsHeld: (n: number) =>
      new Promise<void>(resolve => {
        onWaitHeld = () => {
          if (waitsHeld >= n) resolve()
        }
        onWaitHeld()
      }),
    release: () => {
      for (const answer of held.splice(0)) answer()
    },
    async close() {
      server.close()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

test("stopSlot kills every container bound into the slot, and answers only once each has died, removing none", async () => {
  const docker = await standInDocker()
  try {
    const told: (readonly string[])[] = []
    let isAnswered = false
    const answer = stopSlot(
      { socket: docker.socket },
      "/mnt/host-shares/0/",
      names => told.push(names),
    ).then(names => {
      isAnswered = true
      return names
    })
    await docker.waitsHeld(2)
    await new Promise(r => setImmediate(r))
    expect(isAnswered).toBe(false)
    docker.release()
    expect(await answer).toEqual(["running", "stopped", "gone"])
    expect(told).toEqual([["running", "stopped", "gone"]])
    const asked = docker.requests.filter(r => !r.includes("/containers/json"))
    expect([...asked].sort()).toEqual([
      "POST /containers/gone/stop?t=0",
      "POST /containers/gone/wait?condition=not-running",
      "POST /containers/running/stop?t=0",
      "POST /containers/running/wait?condition=not-running",
      "POST /containers/stopped/stop?t=0",
      "POST /containers/stopped/wait?condition=not-running",
    ])
  } finally {
    await docker.close()
  }
})
