import { describe, expect, test } from "vitest"
import { type LanehostChannel, lanehostClient } from "./client.ts"
import type { LanehostCall } from "./protocol.ts"
import type { Role } from "./roles.ts"

/** A channel that answers each call with its kind, until `end`. */
function fakeChannel(role: Role) {
  let end: () => void = () => {}
  const closed = new Promise<void>(r => {
    end = r
  })
  const calls: LanehostCall[] = []
  const channel: LanehostChannel = {
    ready: Promise.resolve({ role }),
    closed,
    async call(c) {
      calls.push(c)
      return c.kind
    },
    close: () => end(),
  }
  return { channel, calls, end }
}

describe("lanehostClient", () => {
  test("one channel per role, opened at its first call, every call logged", async () => {
    const opened: Role[] = []
    const lines: string[] = []
    const client = lanehostClient({
      open: async role => {
        opened.push(role)
        return fakeChannel(role).channel
      },
      facts: async () => ({ rootless: false }),
      log: l => lines.push(l),
    })
    expect(opened).toEqual([])
    await client.call({ kind: "projects" })
    await client.call({ kind: "disk-exists", project: "k", lane: "l" })
    expect(opened).toEqual(["disks"])
    expect(lines[0]).toMatch(/^\[lanehost\] disks projects [\d.]+ ms$/)
  })
  test("a channel that ends is opened again at the next call; a reset closes them all", async () => {
    const made: ReturnType<typeof fakeChannel>[] = []
    const client = lanehostClient({
      open: async role => {
        const c = fakeChannel(role)
        made.push(c)
        return c.channel
      },
      facts: async () => ({ rootless: false }),
    })
    await client.call({ kind: "projects" })
    made[0]?.end()
    await new Promise(r => setTimeout(r, 0))
    await client.call({ kind: "projects" })
    expect(made).toHaveLength(2)
    client.reset()
    await new Promise(r => setTimeout(r, 0))
    await client.call({ kind: "projects" })
    expect(made).toHaveLength(3)
  })
  test("a failed open is tried again at the next call", async () => {
    let tries = 0
    const client = lanehostClient({
      open: async role => {
        tries += 1
        if (tries === 1) throw new Error("no container yet")
        return fakeChannel(role).channel
      },
      facts: async () => ({ rootless: false }),
    })
    await expect(client.call({ kind: "projects" })).rejects.toThrow(
      "no container yet",
    )
    expect(await client.call({ kind: "projects" })).toBe("projects")
  })
})
