import { spawn } from "node:child_process"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { type Channel, openChannel } from "./client.ts"
import type { RunResult } from "./run.ts"
import type { TestCall } from "./test-server.ts"

const SERVER = path.join(import.meta.dirname, "test-server.ts")
const open = () =>
  openChannel<{ pid: number }, TestCall, number, unknown>(
    [process.execPath, SERVER],
    "the test server",
  )

let channel: Channel<{ pid: number }, TestCall, number, unknown>
beforeAll(async () => {
  channel = open()
  await channel.ready
})
afterAll(async () => {
  channel.close()
  await channel.closed
})

describe("a held channel", () => {
  test("the server's hello comes first", async () => {
    expect((await channel.ready).pid).toBeGreaterThan(0)
  })
  test("concurrent calls are answered by id, in the order they end", async () => {
    const order: number[] = []
    const slow = channel.call({ wait: 80 }).then(v => order.push(v as number))
    const fast = channel.call({ wait: 5 }).then(v => order.push(v as number))
    await Promise.all([slow, fast])
    expect(order).toEqual([5, 80])
  })
  test("bytes and errors cross inside results", async () => {
    const bytes = new Uint8Array([0, 255, 10])
    const error = Object.assign(new Error("no such file"), { code: "ENOENT" })
    const back = (await channel.call({ echo: { bytes, error } })) as {
      bytes: Uint8Array
      error: Error & { code: string }
    }
    expect(back.bytes).toEqual(bytes)
    expect(back.error).toBeInstanceOf(Error)
    expect([back.error.message, back.error.code]).toEqual([
      "no such file",
      "ENOENT",
    ])
  })
  test("updates reach the caller before the result", async () => {
    const seen: number[] = []
    expect(
      await channel.call({ updates: 3 }, undefined, u => seen.push(u)),
    ).toBe("done")
    expect(seen).toEqual([1, 2, 3])
  })
  test("a call that throws rejects with its message", async () => {
    await expect(channel.call({ throws: "boom" })).rejects.toThrow("boom")
  })
  test("an abort ends a call, and kills a command it runs", async () => {
    const waiting = new AbortController()
    const call = channel.call({ wait: 10_000 }, waiting.signal)
    waiting.abort()
    await expect(call).rejects.toThrow("aborted")
    const running = new AbortController()
    const started = Date.now()
    const ran = channel.call(
      { run: ["sleep", "10"] },
      running.signal,
    ) as Promise<RunResult>
    setTimeout(() => running.abort(), 50)
    expect((await ran).code).not.toBe(0)
    expect(Date.now() - started).toBeLessThan(5000)
  })
  test("a command's stdout comes back as bytes", async () => {
    const ran = (await channel.call({
      run: ["printf", "hi"],
    })) as RunResult
    expect([ran.code, ran.stdout]).toEqual([0, new Uint8Array([104, 105])])
  })
  test("a command that exits before reading its input leaves the server answering", async () => {
    const ran = (await channel.call({
      run: ["true"],
      stdin: "x".repeat(8 << 20),
    })) as RunResult
    expect(ran.code).toBe(0)
    expect(await channel.call({ echo: "still here" })).toBe("still here")
  })
  test("a line on stdout that is no reply is passed over", async () => {
    expect(await channel.call({ noise: "container x is not running" })).toBe(
      "said",
    )
    expect(await channel.call({ echo: 1 })).toBe(1)
  })
  test("a server that exits fails every waiting call with its stderr", async () => {
    const own = open()
    await own.ready
    const waiting = own.call({ wait: 10_000 })
    const exits = own.call({ exit: "gone for good" })
    await expect(waiting).rejects.toThrow(
      "the test server exited (code 3): gone for good",
    )
    await expect(exits).rejects.toThrow("gone for good")
    await own.closed
    await expect(own.call({ echo: 1 })).rejects.toThrow("exited")
  })
})

test("a server whose client stopped reading outlives the write it cannot make", async () => {
  const child = spawn(process.execPath, [SERVER], {
    stdio: ["pipe", "pipe", "inherit"],
  })
  await new Promise(resolve => child.stdout.once("data", resolve))
  child.stdout.destroy()
  child.stdin.write(
    `${JSON.stringify({ id: 1, call: { echo: 1 }, updates: false })}\n`,
  )
  await new Promise(r => setTimeout(r, 300))
  child.stdin.end()
  const code = await new Promise(resolve => child.on("exit", resolve))
  expect(code).toBe(0)
})
