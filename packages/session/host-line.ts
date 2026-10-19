// session/host-line — requests to the host, each answered by the reply that
// carries its id.

import {
  decodeReply,
  encodeIntent,
  type Outcome,
  revOfReply,
} from "@pinetrie/protocol/codec"
import type { Command, Reply } from "@pinetrie/protocol/messages"
import type { Intent } from "@pinetrie/threads"

/** The host's answer: its outcome, and the places document's `rev` it carried. */
export interface Answered {
  readonly outcome: Outcome
  readonly rev: number | null
}

interface HostLine {
  /**
   * Send `intent` under `id`, and resolve with the host's answer. The id
   * must be unique among every message stored: a chat's request id is
   * stored as its message's `sendId`. A UUID is the default.
   */
  request(intent: Intent, id?: string): Promise<Answered>
  /**
   * Answer every request still waiting as `failed`, with `message`, and
   * every later one at once with the first message given, sending nothing:
   * the host left, or this client closed, and a client does not reconnect.
   * Failed, not refused, since the host may have acted on one waiting.
   */
  close(message: string): void
}

const failed = (message: string): Answered => ({
  outcome: { kind: "failed", message },
  rev: null,
})

export function hostLine(ports: {
  readonly send: (command: Command) => void
  readonly replies: AsyncIterable<Reply>
}): HostLine {
  const waiting = new Map<string, (answered: Answered) => void>()
  /** Why the line closed; null while it is open. */
  let closed: string | null = null
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
      if (closed !== null) return Promise.resolve(failed(closed))
      const answered = new Promise<Answered>(resolve =>
        waiting.set(id, resolve),
      )
      ports.send(encodeIntent(id, intent))
      return answered
    },
    close(message) {
      closed ??= message
      const settle = [...waiting.values()]
      waiting.clear()
      for (const resolve of settle) resolve(failed(message))
    },
  }
}
