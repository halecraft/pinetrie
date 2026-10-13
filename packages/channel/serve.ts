// channel/serve — the server's side of a held channel, over its own stdin and
// stdout, or over one connection of a server that holds many. Calls are answered concurrently: pi runs a turn's tool calls in
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
 * Serve `handle` on stdin and stdout, or on one connection of a server that
 * holds many (`io`), then say `hello`. A handler that throws answers
 * `{ thrown }` with its message.
 */
export function serve<Hello, Call, Update, Result>(
  hello: Hello,
  handle: (call: Call, context: ServeContext<Update>) => Promise<Result>,
  io: {
    readonly input: NodeJS.ReadableStream
    readonly output: NodeJS.WritableStream
  } = { input: process.stdin, output: process.stdout },
): void {
  const running = new Map<number, AbortController>()
  const send = (reply: Reply<Hello, Update, Result>) =>
    io.output.write(`${encode(reply)}\n`)
  // A client gone mid-reply (its `exec` ended) has no one to tell: unhandled,
  // the write's EPIPE would end every other call the server holds.
  io.output.on("error", () => {})

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
    .createInterface({ input: io.input })
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
