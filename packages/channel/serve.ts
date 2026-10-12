// channel/serve — the server's side of a held channel, over its own stdin and
// stdout. Calls are answered concurrently: pi runs a turn's tool calls in
// parallel. The client closes the channel by ending stdin; killing the
// `exec` process does not reach the server.

import readline from "node:readline"
import { decode, encode, type Reply, type Request } from "./wire.ts"

/** What a handler gets with a call. */
export interface ServeContext<Update> {
  /** Aborted by the client's `{ abort }`, or when the client goes away. */
  readonly signal: AbortSignal
  /** Set when the client asked for updates. */
  readonly update: ((update: Update) => void) | undefined
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Serve `handle` on stdin and stdout, then say `hello`. A handler that throws
 * answers `{ thrown }` with its message.
 */
export function serve<Hello, Call, Update, Result>(
  hello: Hello,
  handle: (call: Call, context: ServeContext<Update>) => Promise<Result>,
): void {
  const running = new Map<number, AbortController>()
  const send = (reply: Reply<Hello, Update, Result>) =>
    process.stdout.write(`${encode(reply)}\n`)

  async function answer(id: number, call: Call, updates: boolean) {
    const control = new AbortController()
    running.set(id, control)
    try {
      const result = await handle(call, {
        signal: control.signal,
        update: updates ? update => send({ id, update }) : undefined,
      })
      send({ id, result })
    } catch (error) {
      send({ id, thrown: messageOf(error) })
    } finally {
      running.delete(id)
    }
  }

  readline
    .createInterface({ input: process.stdin })
    .on("line", line => {
      const request = decode<Request<Call>>(line)
      if ("abort" in request) running.get(request.abort)?.abort()
      else void answer(request.id, request.call, request.updates)
    })
    // The client closed the channel: nothing still running has anyone to answer.
    .on("close", () => {
      for (const control of running.values()) control.abort()
    })
  send({ ready: true, hello })
}
