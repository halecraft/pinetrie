// channel/client — the host's side of a held channel: one server process,
// reached through one long-lived stream (a runtime's `exec -i`, or a local
// process in tests). A call takes 0.2–1 ms (S43 item 2, S147).

import { spawn } from "node:child_process"
import readline from "node:readline"
import { decode, encode, type Reply, type Request } from "./wire.ts"

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly onUpdate: ((update: unknown) => void) | undefined
}

/** One open channel to a server. */
export interface Channel<Hello, Call, Update, Result> {
  /** The server's hello, once it has said it is ready. */
  readonly ready: Promise<Hello>
  call(
    call: Call,
    signal?: AbortSignal,
    onUpdate?: (update: Update) => void,
  ): Promise<Result>
  /** End the server's input: it finishes and exits. Never a signal (S43 item 2). */
  close(): void
  /** Settles when the server has exited. */
  readonly closed: Promise<void>
}

/**
 * Start the server with `argv` and open a channel to it. A server that exits
 * fails every call still waiting, with what it wrote to stderr; `name` says
 * whose server in that error.
 */
export function openChannel<Hello, Call, Update, Result>(
  argv: readonly string[],
  name = "the server",
): Channel<Hello, Call, Update, Result> {
  const child = spawn(argv[0] ?? "", argv.slice(1), {
    stdio: ["pipe", "pipe", "pipe"],
  })
  const pending = new Map<number, Pending>()
  let next = 1
  let stderr = ""
  let exited: Error | null = null
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000)
  })

  let onReady: (hello: Hello) => void = () => {}
  let onFail: (error: Error) => void = () => {}
  const ready = new Promise<Hello>((resolve, reject) => {
    onReady = resolve
    onFail = reject
  })
  ready.catch(() => {})

  readline.createInterface({ input: child.stdout }).on("line", line => {
    const reply = decode<Reply<Hello, Update, Result>>(line)
    if ("ready" in reply) return onReady(reply.hello)
    const waiting = pending.get(reply.id)
    if (waiting === undefined) return
    if ("update" in reply) return waiting.onUpdate?.(reply.update)
    pending.delete(reply.id)
    if ("thrown" in reply) waiting.reject(new Error(reply.thrown))
    else waiting.resolve(reply.result)
  })

  const closed = new Promise<void>(resolve => {
    const fail = (why: string) => {
      exited = new Error(
        `${name} ${why}${stderr === "" ? "" : `: ${stderr.trim()}`}`,
      )
      onFail(exited)
      for (const waiting of pending.values()) waiting.reject(exited)
      pending.clear()
      resolve()
    }
    child.on("error", error => fail(`could not start (${error.message})`))
    child.on("exit", code => fail(`exited (code ${code})`))
  })
  // A write to a server that exited is reported by `closed`, not as a crash.
  child.stdin.on("error", () => {})

  const write = (request: Request<Call>) =>
    child.stdin.write(`${encode(request)}\n`)

  function call(
    body: Call,
    signal?: AbortSignal,
    onUpdate?: (update: Update) => void,
  ): Promise<Result> {
    if (exited !== null) return Promise.reject(exited)
    const id = next++
    return new Promise<Result>((resolve, reject) => {
      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        onUpdate: onUpdate as ((update: unknown) => void) | undefined,
      })
      // The request first: the server ignores an abort for an id it has not
      // been sent, so a call aborted while it waited would run.
      write({ id, call: body, updates: onUpdate !== undefined })
      if (signal?.aborted) write({ abort: id })
      else
        signal?.addEventListener(
          "abort",
          () => {
            if (pending.has(id)) write({ abort: id })
          },
          { once: true },
        )
    })
  }

  return { ready, closed, call, close: () => child.stdin.end() }
}
