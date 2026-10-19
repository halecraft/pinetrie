// The observer relayed to a host inside a lane, whole: the machine role's
// server with a stand-in loader (`@pinetrie/lanehost/fixtures`), the outer
// host's client, the helper's socket and the host's relay joined as a
// lane's channel joins them, and the inner host's own client on the socket.

import { existsSync } from "node:fs"
import path from "node:path"
import type { LaneObservation } from "@pinetrie/core"
import { connectObserver, observerClient } from "@pinetrie/lanehost"
import { scriptCommand, thisInstall } from "@pinetrie/install"
import { standInRole } from "@pinetrie/lanehost/fixtures"
import { type LaneChannel, relayObserver, serveRelay } from "@pinetrie/pi"
import { laneFold } from "@pinetrie/rules"
import { expect, test } from "vitest"

/** `observer-connect` on this Node, as the host builds it. */
const CONNECT = scriptCommand(thisInstall, "observerConnect", [
  process.execPath,
])

/** No lane directory: the stand-in's runs are told apart by their numbers alone. */
const fold = laneFold({ root: "/", shared: [] })
/** The runs a lane's source holds, by number. */
const runsIn = (lane: { drain: LaneObservation["drain"] }) =>
  lane.drain(async traces => ({ traces, result: [...traces.keys()] }))

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 100 && !ok(); i++)
    await new Promise(r => setTimeout(r, 50))
}

test("a host inside a lane registers its lane below the lane, and receives only its own runs", async () => {
  const role = await standInRole()
  const helper = path.join(path.dirname(role.socket), "helper.sock")
  try {
    // The stand-in's lane 40, first process 4, holds lane 50, whose first
    // process is 7 as lane 40 sees it.
    const outer = observerClient({
      open: async () => connectObserver(CONNECT, role.socket),
    })
    const lane = await outer.observe({ pid: async () => 4, remote: [], fold })

    let answer:
      | ((r: Parameters<LaneChannel["observerReply"]>[0]) => void)
      | null = null
    const channel: Pick<LaneChannel, "observerRelay" | "observerReply"> = {
      observerRelay: (signal, onRequest) => {
        answer = serveRelay({ socket: helper, request: onRequest, signal })
        return new Promise(resolve =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        )
      },
      observerReply: async r => answer?.(r),
    }
    const stop = relayObserver(channel, () => lane.relay())
    await until(() => existsSync(helper))

    const inner = observerClient({ open: async () => connectObserver(CONNECT, helper) })
    const below = await inner.observe({ pid: async () => 7, remote: [], fold })
    expect(await runsIn(below)).toEqual(["2"])
    expect(await runsIn(lane)).toEqual(["1"])
    // Lane 40's own first process is pid 1 there: the lane itself, refused.
    await expect(
      inner.observe({ pid: async () => 1, remote: [], fold }),
    ).rejects.toThrow("forwarding lane's own namespace")

    await below.close()
    stop()
    await lane.close()
    inner.reset()
    outer.reset()
  } finally {
    role.close()
  }
})
