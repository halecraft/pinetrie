import { writerId } from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import type { WireCommand } from "@pinetrie/protocol/codec"
import { expect, test } from "vitest"
import { type ControlListener, startControl } from "./control.ts"

type OnReceive = Parameters<ControlListener["onReceive"]>[0]
type Handle = Parameters<typeof startControl>[0]["handle"]

/** Control over seats `seat-1` (Ada) and `seat-2` (Bea), and a way to have one send. */
function seats(handle: Handle) {
  let receive: OnReceive | undefined
  const peers = new Map([
    ["seat-1", { principal: "ada@example.com" }],
    ["seat-2", { principal: "bea@example.com" }],
  ])
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
    handle,
  })
  return (seat: string, ids: readonly string[]) => {
    const commands = (async function* () {
      for (const id of ids)
        yield { id, kind: "name", text: "Ada" } as WireCommand
    })()
    receive?.(
      { peer: seat } as never,
      commands as never,
      { destroy: () => {} } as never,
    )
  }
}

/** Seat `seat-1`, connected as Ada, sends a `name` command per id to `handle`. */
async function seatSends(handle: Handle, ids: readonly string[]) {
  seats(handle)("seat-1", ids)
  await new Promise(r => setTimeout(r, 30))
}

test("a command's writer is the principal its seat connected as, never the seat", async () => {
  const seen: (string | undefined)[] = []
  await seatSends(
    async (_sender, writer) => {
      seen.push(writer)
    },
    ["c0000000-0000-7000-8000-000000000001"],
  )
  expect(seen).toEqual([writerId("ada@example.com")])
})

test("a seat's second command is queued only after its first replied, so a drain the first queued runs before the second", async () => {
  const order: string[] = []
  const keeper = createKeeper({ onError: () => {} })
  // As `handle` runs a documents command: one step on the keeper.
  await seatSends(
    (_sender, _writer, wire) =>
      keeper.run(async () => {
        order.push(wire.id as string)
        if (wire.id !== "c0000000-0000-7000-8000-000000000001") return
        // Some gathering first, so the seat's next command has long arrived.
        await new Promise(r => setTimeout(r, 2))
        void keeper.run(async () => void order.push("drain"))
      }),
    [
      "c0000000-0000-7000-8000-000000000001",
      "c0000000-0000-7000-8000-000000000002",
    ],
  )
  expect(order).toEqual([
    "c0000000-0000-7000-8000-000000000001",
    "drain",
    "c0000000-0000-7000-8000-000000000002",
  ])
})

test("one seat's command held open holds no other seat's", async () => {
  const done: string[] = []
  const held = Promise.withResolvers<void>()
  const send = seats(async (_sender, writer, wire) => {
    if (wire.id === "slow") await held.promise
    done.push(`${writer} ${wire.id}`)
  })
  send("seat-1", ["slow", "after"])
  send("seat-2", ["chat"])
  await new Promise(r => setTimeout(r, 20))
  expect(done).toEqual(["w-bea@example.com chat"])
  held.resolve()
  await new Promise(r => setTimeout(r, 20))
  expect(done).toEqual([
    "w-bea@example.com chat",
    "w-ada@example.com slow",
    "w-ada@example.com after",
  ])
})

test("a failed command does not end its seat's commands", async () => {
  const seen: unknown[] = []
  await seatSends(
    async (_sender, _writer, wire) => {
      seen.push(wire.id)
      if (wire.id === "c0000000-0000-7000-8000-000000000001")
        throw new Error("the Line went with its seat")
    },
    [
      "c0000000-0000-7000-8000-000000000001",
      "c0000000-0000-7000-8000-000000000002",
    ],
  )
  expect(seen).toEqual([
    "c0000000-0000-7000-8000-000000000001",
    "c0000000-0000-7000-8000-000000000002",
  ])
})
