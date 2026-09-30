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
import type { Serial } from "./queue.ts"

export type ControlListener = ReturnType<typeof Control.listen>
export type ControlSender = Parameters<
  Parameters<ControlListener["onReceive"]>[0]
>[0]

/** Run each command from each seat in a serial step; a departed seat's Line goes. */
export function startControl(input: {
  readonly exchange: Exchange
  readonly listener: ControlListener
  readonly serial: Serial
  readonly handle: (
    sender: ControlSender,
    writer: WriterId | undefined,
    wire: WireCommand,
  ) => Promise<void>
}): { stop(): void } {
  const { exchange, listener, serial } = input
  const lines = new Map<string, { destroy(): void }>()
  listener.onReceive((sender, receiver, manager) => {
    lines.set(sender.peer, manager)
    const writer = writerOfPrincipal(exchange.peers.get(sender.peer)?.principal)
    void (async () => {
      for await (const cmd of receiver)
        await serial.run(() => input.handle(sender, writer, cmd))
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
