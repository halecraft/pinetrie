// pi/lane-protocol — the messages between the host and a lane's helper
// (ADR-0034, S43, S44).
//
// One JSON line per message, over one `container exec -i` stream. It imports
// nothing: the helper runs it from Pineta's read-only install, on whatever
// Node the lane runtime brings, with its types stripped.
//
// Values cross with three things JSON cannot carry:
// - bytes: `Uint8Array`, and so `Buffer`, as base64;
// - errors: as `{ name, code, message, path }`, rebuilt as `Error`s with those
//   fields, which is what pi's tools read. `NodeExecutionEnv`'s methods never
//   throw: their errors are values inside results (S44 item 5), so this
//   applies at any depth;
// - `undefined` inside arrays stays JSON's `null`; pi's tools pass none.

/**
 * The environment methods a lane forwards: those whose arguments and result
 * are data. `openTextLineReader` returns an object with methods, and
 * `cleanup` is the host's own, so neither crosses. pi's four tools use eight
 * of these (S43 item 1).
 */
export const ENV_METHODS = [
  "absolutePath",
  "joinPath",
  "readTextFile",
  "readTextLines",
  "readBinaryFile",
  "writeFile",
  "appendFile",
  "renameFile",
  "fileInfo",
  "listDir",
  "canonicalPath",
  "exists",
  "createDir",
  "remove",
  "createTempDir",
  "createTempFile",
  "exec",
] as const

export type EnvMethod = (typeof ENV_METHODS)[number]

const METHODS: ReadonlySet<string> = new Set(ENV_METHODS)
export const isEnvMethod = (name: string): name is EnvMethod =>
  METHODS.has(name)

export type LaneRequest =
  /** An environment call; its `Context` is the helper's own. */
  | {
      readonly id: number
      readonly method: EnvMethod
      readonly args: readonly unknown[]
      /** `exec` wants its `onUpdate` called: replies carry `update`. */
      readonly updates: boolean
    }
  /** A command with no shell, for the host's own jj and git (`laneRunner`). */
  | {
      readonly id: number
      readonly run: readonly string[]
      /** Defaults to the helper's directory, `/project`. */
      readonly cwd: string | null
      /** stdout as bytes, for a bundle; else text. */
      readonly bytes: boolean
    }
  | { readonly abort: number }

export type LaneReply =
  | { readonly ready: true; readonly cwd: string }
  | { readonly id: number; readonly result: unknown }
  | { readonly id: number; readonly update: unknown }
  /** The call threw, which pi's environment should never do: its message. */
  | { readonly id: number; readonly thrown: string }

/** What a `run` request's reply carries. */
export interface RunResult {
  /** The exit code; -1 when the program could not be started. */
  readonly code: number
  readonly stdout: string | Uint8Array
  readonly stderr: string
}

const BYTES = "$pineta.bytes"
const ERROR = "$pineta.error"

interface WireError {
  readonly name: string
  readonly code?: string
  readonly message: string
  readonly path?: string
}

const toBase64 = (b: Uint8Array): string =>
  Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("base64")

/**
 * The replacer reads `this[key]`, the value before its `toJSON`: `Buffer`'s
 * own `toJSON` runs first and would hand it `{ type: "Buffer", data: [...] }`
 * (S43 item 2).
 */
function replacer(this: unknown, key: string, value: unknown): unknown {
  const raw = (this as Record<string, unknown>)[key]
  if (raw instanceof Uint8Array) return { [BYTES]: toBase64(raw) }
  if (raw instanceof Error) {
    const e = raw as Error & { code?: unknown; path?: unknown }
    const wire: WireError = {
      name: e.name,
      message: e.message,
      ...(typeof e.code === "string" ? { code: e.code } : {}),
      ...(typeof e.path === "string" ? { path: e.path } : {}),
    }
    return { [ERROR]: wire }
  }
  return value
}

function reviver(_key: string, value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value
  const v = value as Record<string, unknown>
  const bytes = v[BYTES]
  if (typeof bytes === "string")
    return new Uint8Array(Buffer.from(bytes, "base64"))
  const error = v[ERROR] as WireError | undefined
  if (error !== undefined && typeof error === "object") {
    const e = new Error(error.message) as Error & {
      code?: string
      path?: string
    }
    e.name = error.name
    if (error.code !== undefined) e.code = error.code
    if (error.path !== undefined) e.path = error.path
    return e
  }
  return value
}

/** One message as one line, without its newline. */
export const encode = (message: LaneRequest | LaneReply): string =>
  JSON.stringify(message, replacer)

/** One line back into a message. Throws on a line that is not JSON. */
export const decode = <T extends LaneRequest | LaneReply>(line: string): T =>
  JSON.parse(line, reviver) as T
