// channel/wire — one message as one JSON line, over a held `exec -i` stream
// (S43, S44).
//
// Values cross with three things JSON cannot carry:
// - bytes: `Uint8Array`, and so `Buffer`, as base64;
// - errors: as `{ name, code, message, path }`, rebuilt as `Error`s with those
//   fields. pi's `NodeExecutionEnv` returns its errors inside results (S44
//   item 5), so this applies at any depth;
// - `undefined` inside arrays stays JSON's `null`.

/** What the client sends: a call by id, or the abort of one. */
export type Request<Call> =
  | {
      readonly id: number
      readonly call: Call
      /** The caller wants updates: `ServeContext.update` is set. */
      readonly updates: boolean
    }
  | { readonly abort: number }

/** What the server sends: its hello once, then each call's updates and end. */
export type Reply<Hello, Update, Result> =
  | { readonly ready: true; readonly hello: Hello }
  | { readonly id: number; readonly result: Result }
  | { readonly id: number; readonly update: Update }
  /** The call threw: its message. */
  | { readonly id: number; readonly thrown: string }

const BYTES = "$pinetrie.bytes"
const ERROR = "$pinetrie.error"

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
export const encode = (message: unknown): string =>
  JSON.stringify(message, replacer)

/** One line back into a message. Throws on a line that is not JSON. */
export const decode = <T>(line: string): T => JSON.parse(line, reviver) as T
