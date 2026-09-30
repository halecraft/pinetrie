// host/seats — which person each seat is, written down once (ADR-0048).
//
// A text's operations carry their seat's `clientID`. Only the host knows
// which person a seat is, and only while it is connected (ADR-0037), so it
// writes a `pineta.seat` record per seat as the seat arrives. Anyone then
// names a text's writers from its `clientID`s, after the seat has gone.

import type { Exchange } from "@kyneta/exchange"
import { planSeats } from "@pineta/marginalia"
import type { Agent } from "@pineta/pi"
import { readSeats } from "@pineta/reads"
import { seatOf } from "@pineta/schema"
import type { Basics } from "./basics.ts"
import type { Serial } from "./queue.ts"

/**
 * Write each connected seat's record, now and on every change to the peers.
 * Started after `recover`, as the command channel is: nothing is written
 * before the startup compaction (`packages/schema/TECHNICAL.md`).
 */
export function startSeats(input: {
  readonly exchange: {
    readonly peers: Pick<Exchange["peers"], "current" | "subscribe">
  }
  readonly basics: Pick<Basics, "doc" | "now">
  readonly serial: Serial
  readonly agent: Pick<Agent, "setSeat">
}): { stop(): void } {
  const { exchange, serial, agent } = input
  const { doc, now } = input.basics
  const step = () =>
    serial.run(async () => {
      // gather
      const connected = [...exchange.peers.current.values()].flatMap(p => {
        const seat = seatOf(p.peerId, p.principal)
        return seat === null ? [] : [seat]
      })
      // plan, then execute
      for (const seat of planSeats(connected, readSeats(doc), now()))
        await agent.setSeat(seat)
    })
  void step()
  const stop = exchange.peers.subscribe(() => void step())
  return { stop }
}
