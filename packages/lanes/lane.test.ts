import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { PINETRIE_MOUNT, thisInstall } from "@pinetrie/install"
import {
  createQueue,
  laneNote,
  nestedLaneDockerNote,
} from "./index.ts"

test("every note a lane is pointed at exists in the install", () => {
  for (const inLane of [
    laneNote("jj"),
    laneNote("folder"),
    nestedLaneDockerNote,
  ]) {
    expect(inLane.startsWith(`${PINETRIE_MOUNT}/`)).toBe(true)
    const onHost = path.join(
      thisInstall.root,
      inLane.slice(PINETRIE_MOUNT.length),
    )
    expect(statSync(onHost, { throwIfNoEntry: false })?.isFile(), onHost).toBe(
      true,
    )
  }
})

const later = (ms: number) => new Promise(r => setTimeout(r, ms))

describe("createQueue: one lane's steps, in order, and the gate", () => {
  test("tasks run one after another, in the order queued", async () => {
    const queue = createQueue()
    const seen: string[] = []
    const a = queue.enqueue(async () => {
      await later(30)
      seen.push("a")
    })
    const b = queue.enqueue(async () => {
      seen.push("b")
    })
    await Promise.all([a, b])
    expect(seen).toEqual(["a", "b"])
  })

  test("the gate opens only after a turn's snapshot finishes", async () => {
    const queue = createQueue()
    const seen: string[] = []
    void queue.enqueue(async () => {
      await later(50)
      seen.push("snapshot")
    })
    await queue.idle()
    seen.push("tool")
    expect(seen).toEqual(["snapshot", "tool"])
  })

  test("a failed snapshot is reported to its caller, and the gate still opens", async () => {
    const queue = createQueue()
    await expect(
      queue.enqueue(async () => {
        throw new Error("clone failed")
      }),
    ).rejects.toThrow("clone failed")
    await expect(queue.idle()).resolves.toBeUndefined()
  })

  test("a failed start breaks the queue until it is reset", async () => {
    const queue = createQueue()
    await expect(
      queue.enqueue(
        async () => {
          throw new Error("no container")
        },
        { fatal: true },
      ),
    ).rejects.toThrow("no container")
    await expect(queue.idle()).rejects.toThrow("no container")
    await expect(queue.enqueue(async () => 1)).rejects.toThrow("no container")
    queue.reset()
    await expect(queue.enqueue(async () => 2)).resolves.toBe(2)
    await expect(queue.idle()).resolves.toBeUndefined()
  })
})

test("the default image's inner Docker finds ip and sysctl, in /usr/sbin", () => {
  const containerfile = readFileSync(
    path.join(import.meta.dirname, "image", "Containerfile"),
    "utf8",
  )
  const inner = containerfile
    .split("\n")
    .find(l => l.includes("dockerd-rootless.sh --data-root"))
  expect(inner).toMatch(/PATH=[^ ]*\/usr\/sbin[: ]/)
  expect(containerfile).toMatch(/--no-install-recommends[^\n]* iproute2/)
})

test("the default image's runc adds --no-new-keyring, for BuildKit's containers too", () => {
  const containerfile = readFileSync(
    path.join(import.meta.dirname, "image", "Containerfile"),
    "utf8",
  )
  expect(containerfile).toContain("> /usr/local/sbin/runc")
  expect(containerfile).toContain('set -- "$@" --no-new-keyring')
  expect(containerfile).toContain("exec /usr/local/bin/runc")
})
