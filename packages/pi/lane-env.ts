// pi/lane-env — the host side of a lane's channel (ADR-0034, S43).
//
// One helper process per running lane, reached through one long-lived
// stream: `container exec -i` in production, a local process in tests. Over
// it, the host gets:
// - `laneEnv`: an `ExecutionEnv` whose every call runs in the lane, so pi's
//   tools work there unchanged. Each call first waits on the lane's gate, the
//   tail of its queue: the model can think while a turn's disk is cloned, but
//   no tool touches the disk until the clone is done.
// - `laneRunner`: the host's own jj and git in the lane, with exit status,
//   separate stdout and stderr, and bytes. pi's `exec` reports only an exit
//   code, and its output is capped text with stderr mixed in.
// A call takes 0.3–1 ms (S43 item 2).

import { spawn } from "node:child_process"
import readline from "node:readline"
import { type ExecutionEnv, FileError } from "@earendil-works/pi-agent-core"
import {
  decode,
  type EnvMethod,
  encode,
  isEnvMethod,
  type LaneReply,
  type LaneRequest,
  type RunResult,
} from "./lane-protocol.ts"

type Context = { readonly abortSignal: AbortSignal | undefined }

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly onUpdate: ((update: unknown) => void) | undefined
}

/** One open channel to a lane's helper. */
export interface LaneChannel {
  /** The helper's directory, once it has said it is ready. */
  readonly ready: Promise<{ readonly cwd: string }>
  call(
    method: EnvMethod,
    args: readonly unknown[],
    signal: AbortSignal | undefined,
    onUpdate?: (update: unknown) => void,
  ): Promise<unknown>
  run(
    argv: readonly string[],
    bytes: boolean,
    signal?: AbortSignal,
  ): Promise<RunResult>
  /** End the helper's input: it finishes and exits. Never a signal (S43 item 2). */
  close(): void
  /** Settles when the helper has exited. */
  readonly closed: Promise<void>
}

/**
 * Start the helper with `argv` and open a channel to it. A helper that
 * exits fails every call still waiting, with what it wrote to stderr.
 */
export function openChannel(argv: readonly string[]): LaneChannel {
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

  let onReady: (hello: { cwd: string }) => void = () => {}
  let onFail: (error: Error) => void = () => {}
  const ready = new Promise<{ cwd: string }>((resolve, reject) => {
    onReady = resolve
    onFail = reject
  })
  ready.catch(() => {})

  readline.createInterface({ input: child.stdout }).on("line", line => {
    const reply = decode<LaneReply>(line)
    if ("ready" in reply) return onReady({ cwd: reply.cwd })
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
        `the lane's helper ${why}${stderr === "" ? "" : `: ${stderr.trim()}`}`,
      )
      onFail(exited)
      for (const waiting of pending.values()) waiting.reject(exited)
      pending.clear()
      resolve()
    }
    child.on("error", error => fail(`could not start (${error.message})`))
    child.on("exit", code => fail(`exited (code ${code})`))
  })
  // A write to a helper that exited is reported by `closed`, not as a crash.
  child.stdin.on("error", () => {})

  function send(
    request: (id: number) => LaneRequest,
    signal: AbortSignal | undefined,
    onUpdate?: (update: unknown) => void,
  ): Promise<unknown> {
    if (exited !== null) return Promise.reject(exited)
    const id = next++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onUpdate })
      if (signal?.aborted) child.stdin.write(`${encode({ abort: id })}\n`)
      else
        signal?.addEventListener(
          "abort",
          () => {
            if (pending.has(id)) child.stdin.write(`${encode({ abort: id })}\n`)
          },
          { once: true },
        )
      child.stdin.write(`${encode(request(id))}\n`)
    })
  }

  return {
    ready,
    closed,
    call: (method, args, signal, onUpdate) =>
      send(
        id => ({ id, method, args, updates: onUpdate !== undefined }),
        signal,
        onUpdate,
      ),
    run: (run, bytes, signal) =>
      send(id => ({ id, run, cwd: null, bytes }), signal) as Promise<RunResult>,
    close: () => child.stdin.end(),
  }
}

/**
 * pi's `ExecutionEnv`, answered in the lane whose directory is `cwd`. Every
 * method first awaits `gate()`, which settles with the lane's channel once the
 * lane is started and its queue has drained; a gate that fails fails the
 * call. The context's abort sends `{ abort }`; `exec`'s `onUpdate` gets each
 * update. Methods that cannot cross return a `not_supported` error, as pi's
 * environments must never throw.
 */
export function laneEnv(
  cwd: string,
  gate: () => Promise<LaneChannel>,
): ExecutionEnv {
  const target = { cwd }
  return new Proxy(target, {
    get(t, prop) {
      if (prop === "cwd") return t.cwd
      if (prop === "then" || typeof prop !== "string") return undefined
      if (prop === "cleanup") return async () => {}
      if (!isEnvMethod(prop))
        return async () => ({
          ok: false,
          error: new FileError(
            "not_supported",
            `${prop} does not cross into a lane`,
          ),
        })
      return async (...args: unknown[]) => {
        const context = args.at(-1) as Context | undefined
        const rest = args.slice(0, -1)
        let onUpdate: ((update: unknown) => void) | undefined
        if (prop === "exec") {
          const options = rest[1] as
            | { onUpdate?: (u: unknown, c: unknown) => void }
            | undefined
          const given = options?.onUpdate
          if (given !== undefined) {
            onUpdate = update => given(update, context)
            rest[1] = { ...options, onUpdate: undefined }
          }
        }
        const channel = await gate()
        return channel.call(prop, rest, context?.abortSignal, onUpdate)
      }
    },
  }) as unknown as ExecutionEnv
}

/** How a lane command ended; the shape `@pineta/lanes` reads as `Ran`. */
export interface LaneRan<Out = string> {
  readonly ok: boolean
  readonly code: number
  readonly stdout: Out
  readonly stderr: string
}

/**
 * The host's own commands in the lane, over the same channel. It does not
 * wait on the gate: the queue's own steps run through it.
 */
export function laneRunner(channel: LaneChannel): {
  readonly run: (argv: readonly string[]) => Promise<LaneRan>
  readonly bytes: (argv: readonly string[]) => Promise<LaneRan<Uint8Array>>
} {
  const ran = <Out>(r: RunResult, out: Out): LaneRan<Out> => ({
    ok: r.code === 0,
    code: r.code,
    stdout: out,
    stderr: r.stderr,
  })
  return {
    async run(argv) {
      const r = await channel.run(argv, false)
      return ran(r, typeof r.stdout === "string" ? r.stdout : "")
    },
    async bytes(argv) {
      const r = await channel.run(argv, true)
      return ran(
        r,
        r.stdout instanceof Uint8Array ? r.stdout : new Uint8Array(),
      )
    },
  }
}
