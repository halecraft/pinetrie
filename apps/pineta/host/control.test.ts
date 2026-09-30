import { writerId } from "@pineta/core"
import type { WireCommand } from "@pineta/protocol/codec"
import { expect, test } from "vitest"
import { type ControlListener, startControl } from "./control.ts"
import { createSerial } from "./queue.ts"

type OnReceive = Parameters<ControlListener["onReceive"]>[0]

test("a command's writer is the principal its seat connected as, never the seat", async () => {
  let receive: OnReceive | undefined
  const peers = new Map([["seat-1", { principal: "ada@example.com" }]])
  const seen: (string | undefined)[] = []
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
    serial: createSerial(),
    handle: async (_sender, writer) => {
      seen.push(writer)
    },
  })
  const commands = (async function* () {
    yield { id: "c-1", kind: "name", text: "Ada" } as WireCommand
  })()
  receive?.(
    { peer: "seat-1" } as never,
    commands as never,
    {
      destroy: () => {},
    } as never,
  )
  await new Promise(r => setTimeout(r, 10))
  expect(seen).toEqual([writerId("ada@example.com")])
})
