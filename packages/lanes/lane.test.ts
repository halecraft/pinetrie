import { statSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import {
  createQueue,
  HELPER,
  LANE_NOTE,
  PINETA_INSTALL,
  PINETA_MOUNT,
} from "./index.ts"

test("every Pineta file a lane is pointed at exists", () => {
  for (const inLane of [HELPER, LANE_NOTE]) {
    expect(inLane.startsWith(`${PINETA_MOUNT}/`)).toBe(true)
    const onHost = path.join(PINETA_INSTALL, inLane.slice(PINETA_MOUNT.length))
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
