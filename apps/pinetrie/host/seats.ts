// host/seats — which person each seat is, written down once (ADR-0048).
//
// A text's operations carry their seat's `clientID`. Only the host knows
// which person a seat is, and only while it is connected (ADR-0037), so it
// writes a `pinetrie.seat` record per seat as the seat arrives. Anyone then
// names a text's writers from its `clientID`s, after the seat has gone. A
// person with no seat left can undo nothing, so their stacks of moves are
// unloaded (ADR-0066); the next move loads one again (S91).

import type { Exchange } from "@kyneta/exchange"
import type { WriterId } from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import type { Agent } from "@pinetrie/pi"
import { readSeats } from "@pinetrie/reads"
import { planSeats, SEAT, setRecord } from "@pinetrie/rules"
import { seatOf } from "@pinetrie/schema"
import type { Basics } from "./basics.ts"
import type { MoveHistories } from "./move-history.ts"

/** The writers with stacks of moves loaded and no seat connected. Pure. */
export const idleWriters = (
  loaded: readonly WriterId[],
  connected: readonly WriterId[],
): readonly WriterId[] => loaded.filter(w => !connected.includes(w))

/**
 * Write each connected seat's record, now and on every change to the peers,
 * and unload the stacks of moves of every writer with no seat left.
 * Started after `recover`, as the command channel is: nothing is written
 * before the startup compaction (`packages/schema/TECHNICAL.md`).
 */
export function startSeats(input: {
  readonly exchange: {
    readonly peers: Pick<Exchange["peers"], "current" | "subscribe">
  }
  readonly basics: Pick<Basics, "session" | "now">
  readonly keeper: Keeper
  readonly agent: Pick<Agent, "writeValues">
  readonly histories: Pick<MoveHistories, "loaded" | "unloadWriters">
}): { stop(): void } {
  const { exchange, keeper, agent, histories } = input
  const { session: doc, now } = input.basics
  const step = () =>
    keeper.run(async () => {
      // gather
      const connected = [...exchange.peers.current.values()].flatMap(p => {
        const seat = seatOf(p.peerId, p.principal)
        return seat === null ? [] : [seat]
      })
      // plan, then execute
      const seats = planSeats(connected, readSeats(doc), now())
      const idle = idleWriters(
        histories.loaded(),
        connected.map(s => s.writer),
      )
      await agent.writeValues(seats.map(seat => setRecord(SEAT, seat)))
      await histories.unloadWriters(idle)
    })
  void step()
  const stop = exchange.peers.subscribe(() => void step())
  return { stop }
}
