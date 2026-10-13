// pi/lane-env — the host side of a lane's channel.
//
// One helper process per running lane, reached through one long-lived
// stream: the lane runtime's `exec -i` in production, a local process in tests. Over
// it, the host gets:
// - `laneEnv`: an `ExecutionEnv` whose every call runs in the lane, so pi's
//   tools work there unchanged. Each call first waits on the lane's gate, the
//   tail of its queue: the model can think while a turn's disk is cloned, but
//   no tool touches the disk until the clone is done.
// - `laneRunner`: the host's own jj and git in the lane, with exit status,
//   separate stdout and stderr, and bytes. pi's `exec` reports only an exit
//   code, and its output is capped text with stderr mixed in.
// A call takes 0.3–1 ms.

import { type ExecutionEnv, FileError } from "@earendil-works/pi-agent-core"
import { openChannel as open, type RunResult } from "@pinetrie/channel"
import type { FileHashes, LaneDrain, Recipe, RecipeCheck } from "@pinetrie/core"
import {
  type EnvMethod,
  isEnvMethod,
  type LaneCall,
  type LaneHello,
  type RelayReply,
  type RelayRequest,
} from "./lane-protocol.ts"

type Context = { readonly abortSignal: AbortSignal | undefined }

/**
 * The key of a channel's environment calls: this module's alone, so only
 * `laneEnv`, pi's tools, makes them. The helper records the tools' writes,
 * and their accesses of shared files, from these calls; the host's own
 * writes go on a `run`'s input instead, and can never be counted as the
 * agent's.
 */
const toolCall: unique symbol = Symbol("toolCall")

/** One open channel to a lane's helper. */
export interface LaneChannel {
  /** The helper's hello, once it has said it is ready. */
  readonly ready: Promise<LaneHello>
  [toolCall](
    method: EnvMethod,
    args: readonly unknown[],
    signal: AbortSignal | undefined,
    onUpdate?: (update: unknown) => void,
  ): Promise<unknown>
  run(
    argv: readonly string[],
    bytes: boolean,
    signal?: AbortSignal,
    stdin?: string,
  ): Promise<RunResult>
  /** What the helper knows of its runs and tools since the last drain. */
  runs(): Promise<LaneDrain>
  /** Which of `paths`, relative to the lane's directory, exist. */
  present(paths: readonly string[]): Promise<readonly string[]>
  /** sha256 of each path, relative to the lane's directory. */
  hashes(paths: readonly string[]): Promise<FileHashes>
  /** Whether each recipe's key, but its image, still holds on the disk. */
  checkRecipes(recipes: readonly Recipe[]): Promise<readonly RecipeCheck[]>
  /**
   * Serve the observer to a host inside the lane until `signal` aborts:
   * each request is answered by `observerReply` (`relayObserver`).
   */
  observerRelay(
    signal: AbortSignal,
    onRequest: (request: RelayRequest) => void,
  ): Promise<void>
  observerReply(reply: RelayReply): Promise<void>
  /**
   * End the helper's input: it finishes and exits. Never a signal: killing
   * the `exec` process does not reach the helper.
   */
  close(): void
  /** Settles when the helper has exited. */
  readonly closed: Promise<void>
}

/**
 * Start the helper with `argv` and open a channel to it. A helper that
 * exits fails every call still waiting, with what it wrote to stderr.
 */
export function openChannel(argv: readonly string[]): LaneChannel {
  const channel = open<LaneHello, LaneCall, unknown, unknown>(
    argv,
    "the lane's helper",
  )
  return {
    ready: channel.ready,
    closed: channel.closed,
    [toolCall]: (method, args, signal, onUpdate) =>
      channel.call({ method, args }, signal, onUpdate),
    run: (run, bytes, signal, stdin) =>
      channel.call(
        { run, cwd: null, bytes, stdin: stdin ?? null },
        signal,
      ) as Promise<RunResult>,
    runs: () => channel.call({ runs: true }) as Promise<LaneDrain>,
    present: paths =>
      channel.call({ present: paths }) as Promise<readonly string[]>,
    hashes: paths => channel.call({ hashes: paths }) as Promise<FileHashes>,
    checkRecipes: recipes =>
      channel.call({ checkRecipes: recipes }) as Promise<
        readonly RecipeCheck[]
      >,
    observerRelay: async (signal, onRequest) => {
      await channel.call({ observerRelay: true }, signal, update =>
        onRequest(update as RelayRequest),
      )
    },
    observerReply: async reply => {
      await channel.call({ observerReply: reply })
    },
    close: channel.close,
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
        return channel[toolCall](prop, rest, context?.abortSignal, onUpdate)
      }
    },
  }) as unknown as ExecutionEnv
}

/**
 * pi's `ExecutionEnv` for an agent with no lane: every method answers a
 * `not_supported` error naming `why`, as pi's environments must never throw.
 */
export function refusingEnv(cwd: string, why: string): ExecutionEnv {
  return new Proxy(
    { cwd },
    {
      get(t, prop) {
        if (prop === "cwd") return t.cwd
        if (prop === "then" || typeof prop !== "string") return undefined
        if (prop === "cleanup") return async () => {}
        return async () => ({
          ok: false,
          error: new FileError("not_supported", why),
        })
      },
    },
  ) as unknown as ExecutionEnv
}

/** How a lane command ended; the shape `@pinetrie/lanes` reads as `Ran`. */
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
