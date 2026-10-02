import { writerId } from "@pineta/core"
import type { WireCommand } from "@pineta/protocol/codec"
import { expect, test } from "vitest"
import { type ControlListener, startControl } from "./control.ts"
import { createSerial } from "./queue.ts"

type OnReceive = Parameters<ControlListener["onReceive"]>[0]
type Handle = Parameters<typeof startControl>[0]["handle"]

/** Seat `seat-1`, connected as Ada, sends a `name` command per id to `handle`. */
async function seatSends(handle: Handle, ids: readonly string[]) {
  let receive: OnReceive | undefined
  const peers = new Map([["seat-1", { principal: "ada@example.com" }]])
  startControl({
    exchange: {
      peers: {
        get: (seat: string) => peers.get(seat),
        current: peers,
        subscribe: () => () => {},
      } as never,
    },
    listener: {
      onReceive: cb => {
        receive = cb
        return () => {}
      },
    },
    serial: createSerial(() => {}),
    handle,
  })
  const commands = (async function* () {
    for (const id of ids) yield { id, kind: "name", text: "Ada" } as WireCommand
  })()
  receive?.(
    { peer: "seat-1" } as never,
    commands as never,
    { destroy: () => {} } as never,
  )
  await new Promise(r => setTimeout(r, 10))
}

test("a command's writer is the principal its seat connected as, never the seat", async () => {
  const seen: (string | undefined)[] = []
  await seatSends(
    async (_sender, writer) => {
      seen.push(writer)
    },
    ["c-1"],
  )
  expect(seen).toEqual([writerId("ada@example.com")])
})

test("a failed command does not end its seat's commands", async () => {
  const seen: unknown[] = []
  await seatSends(
    async (_sender, _writer, wire) => {
      seen.push(wire.id)
      if (wire.id === "c-1") throw new Error("the Line went with its seat")
    },
    ["c-1", "c-2"],
  )
  expect(seen).toEqual(["c-1", "c-2"])
})
