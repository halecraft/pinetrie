// client/host-line — requests to the host, each answered by the reply that
// carries its id. Runs in a browser and in Node alike: it is given the
// Line's two ends, and touches nothing else.

import type { Intent } from "@pineta/core"
import {
  decodeReply,
  encodeIntent,
  type Outcome,
  revOfReply,
} from "@pineta/protocol/codec"
import type { Command, Reply } from "@pineta/protocol/messages"

/** The host's answer: its outcome, and the places document's `rev` it carried. */
export interface Answered {
  readonly outcome: Outcome
  readonly rev: number | null
}

export interface HostLine {
  /**
   * Send `intent` under `id`, and resolve with the host's answer. The id
   * must be unique among every message stored: a chat's request id is
   * stored as its message's `sendId`. A UUID is the default.
   */
  request(intent: Intent, id?: string): Promise<Answered>
  /**
   * Answer every request still waiting as `failed`, with `message`: the host
   * left, or this client closed. Failed, not refused, since the host may
   * have acted on it.
   */
  settleAll(message: string): void
}

export function hostLine(ports: {
  readonly send: (command: Command) => void
  readonly replies: AsyncIterable<Reply>
}): HostLine {
  const waiting = new Map<string, (answered: Answered) => void>()
  void (async () => {
    for await (const reply of ports.replies) {
      waiting.get(reply.id)?.({
        outcome: decodeReply(reply),
        rev: revOfReply(reply),
      })
      waiting.delete(reply.id)
    }
  })()
  return {
    request(intent, id = crypto.randomUUID()) {
      const answered = new Promise<Answered>(resolve =>
        waiting.set(id, resolve),
      )
      ports.send(encodeIntent(id, intent))
      return answered
    },
    settleAll(message) {
      const settle = [...waiting.values()]
      waiting.clear()
      for (const resolve of settle)
        resolve({ outcome: { kind: "failed", message }, rev: null })
    },
  }
}
