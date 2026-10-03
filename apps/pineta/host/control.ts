// host/control — the command channel (ADR-0007): one Line per client seat.
//
// Identity comes from the TRANSPORT, never the message: `sender.peer` is the
// client's seat, and the principal its connection named is who they are
// (ADR-0037), so no command field can claim to be someone else. A principal
// that is not an email names nobody, and every command from it is refused.

import type { Exchange } from "@kyneta/exchange"
import { type WriterId, writerOfPrincipal } from "@pineta/core"
import type { WireCommand } from "@pineta/protocol/codec"
import type { Control } from "@pineta/protocol/line"
import { departedSeats } from "./lines.ts"

export type ControlListener = ReturnType<typeof Control.listen>
export type ControlSender = Parameters<
  Parameters<ControlListener["onReceive"]>[0]
>[0]

/**
 * Hand each command from each seat to `handle`, which runs it where it runs
 * (`placeOfCommand`): one seat's in the order sent, each handed over only
 * once the one before it has replied, so what that one queued (a drain, say)
 * is ahead of it. Different seats' commands go in the order they arrive, and
 * an offer command of one never holds another's chat. A failed command does
 * not end its seat's commands. A departed seat's Line goes.
 */
export function startControl(input: {
  /** Only the peers: who each seat is, and when one leaves. */
  readonly exchange: {
    readonly peers: Pick<Exchange["peers"], "get" | "current" | "subscribe">
  }
  readonly listener: Pick<ControlListener, "onReceive">
  readonly handle: (
    sender: ControlSender,
    writer: WriterId | undefined,
    wire: WireCommand,
  ) => Promise<void>
}): { stop(): void } {
  const { exchange, listener } = input
  const lines = new Map<string, { destroy(): void }>()
  listener.onReceive((sender, receiver, manager) => {
    lines.set(sender.peer, manager)
    const writer = writerOfPrincipal(exchange.peers.get(sender.peer)?.principal)
    void (async () => {
      // The seat's chain: never awaited here, so reading goes on while a
      // command runs. `handle` answers a failed command and logs it; one that
      // throws all the same is caught on the chain, so it neither ends the
      // seat's commands nor rejects unhandled.
      let previous: Promise<void> = Promise.resolve()
      for await (const cmd of receiver)
        previous = previous
          .then(() => input.handle(sender, writer, cmd))
          .catch(() => {})
    })()
  })
  // A seat that has left never returns, so its Line goes (host/lines.ts).
  const stop = exchange.peers.subscribe(() => {
    for (const seat of departedSeats(lines.keys(), exchange.peers.current)) {
      lines.get(seat)?.destroy()
      lines.delete(seat)
    }
  })
  return { stop }
}
