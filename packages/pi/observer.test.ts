import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { openChannel } from "@pinetrie/channel"
import type { ObserverRelay } from "@pinetrie/core"
import { describe, expect, test } from "vitest"
import type { LaneChannel } from "./lane-env.ts"
import { relayObserver, serveRelay } from "./observer.ts"

// The helper's half and the host's, joined as a lane's channel joins them;
// the inner host is a channel to the socket, as `observerClient` opens one.
describe("the observer, relayed to a host inside a lane", () => {
  const connect = path.join(
    import.meta.dirname,
    "../lanehost/observer-connect.ts",
  )

  test("the inner host's calls and updates cross the relay, and its end closes the outer connection", async () => {
    const socket = path.join(
      mkdtempSync(path.join(tmpdir(), "relay-")),
      "observer.sock",
    )
    const seen: unknown[] = []
    let closed = 0
    const relay = async (): Promise<ObserverRelay> => ({
      hello: { version: "v" },
      async call(body, signal, onUpdate) {
        seen.push(body)
        if ((body as { kind: string }).kind !== "subscribe") return "answered"
        onUpdate("a notice")
        await new Promise(r =>
          signal.addEventListener("abort", r, { once: true }),
        )
        return null
      },
      close: () => {
        closed++
      },
    })
    let reply:
      | ((r: Parameters<LaneChannel["observerReply"]>[0]) => void)
      | null = null
    const channel: Pick<LaneChannel, "observerRelay" | "observerReply"> = {
      observerRelay: (signal, onRequest) => {
        reply = serveRelay({ socket, request: onRequest, signal })
        return new Promise(resolve =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        )
      },
      observerReply: async r => reply?.(r),
    }
    const stop = relayObserver(channel, relay)
    for (let i = 0; i < 50 && !existsSync(socket); i++)
      await new Promise(r => setTimeout(r, 20))

    const inner = openChannel<unknown, unknown, unknown, unknown>([
      "node",
      connect,
      socket,
    ])
    expect(await inner.ready).toEqual({ version: "v" })
    const updates: unknown[] = []
    // It answers only when the connection ends.
    inner
      .call({ kind: "subscribe" }, undefined, u => updates.push(u))
      .catch(() => {})
    expect(await inner.call({ kind: "register", pid: 7 })).toBe("answered")
    expect(updates).toEqual(["a notice"])
    expect(seen).toEqual([{ kind: "subscribe" }, { kind: "register", pid: 7 }])
    inner.close()
    await inner.closed
    for (let i = 0; i < 50 && closed === 0; i++)
      await new Promise(r => setTimeout(r, 20))
    expect(closed).toBe(1)
    stop()
    expect(existsSync(socket)).toBe(false)
  })
})
