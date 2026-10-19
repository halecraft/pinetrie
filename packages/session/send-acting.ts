// session/send-acting — one tracked command, sent: its state in the session's
// store before it goes and once it is answered (`actingAfter` decides each).

import type { Outcome } from "@pinetrie/protocol/codec"
import { type ActingCommand, type ActingState, actingAfter } from "./acting.ts"
import type { SnapshotStore } from "./store.ts"

/** Mark `command` sent in `store`, send it, and record the answer when it comes. */
export function sendActing(
  store: SnapshotStore<ActingState>,
  command: ActingCommand,
  send: () => Promise<Outcome>,
  id: string,
): Promise<Outcome> {
  store.set(actingAfter(store.current(), command, { kind: "sent", id }))
  return send().then(outcome => {
    store.set(
      actingAfter(store.current(), command, { kind: "answered", id, outcome }),
    )
    return outcome
  })
}
