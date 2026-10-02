// host/fakes — test support for the shell's unit tests: ports that record
// their calls, a lane whose run a test finishes, and writers that put entries
// and values in a document as the host would. Production code never imports
// it.

import type { LaneName } from "@pineta/core"
import type { ThreadLaneHandle, WriteOutcome } from "@pineta/pi"
import {
  newCardsDoc,
  newSessionDoc,
  physicalKey,
  type SessionDocHandle,
  type StoredEntryRow,
} from "@pineta/schema"
import type { Basics } from "./basics.ts"

export interface Call {
  readonly method: string
  readonly args: readonly unknown[]
}

/**
 * A port of type `T` built from `impl`, recording every call. A method not in
 * `impl` throws when called, naming itself, so a test fails where a module
 * touches a port it did not declare.
 */
export function record<T extends object>(
  impl: Partial<T> = {},
): { readonly port: T; readonly calls: Call[] } {
  const calls: Call[] = []
  const given = impl as Record<string, unknown>
  const port = new Proxy({} as T, {
    get(_, key) {
      // Awaiting a port, or printing one, reads these: they are not calls.
      if (typeof key === "symbol" || key === "then") return undefined
      const value = given[key]
      if (value === undefined)
        return () => {
          throw new Error(`${key} is not in this port`)
        }
      if (typeof value !== "function") return value
      return (...args: unknown[]) => {
        calls.push({ method: key, args })
        return value(...args)
      }
    },
  })
  return { port, calls }
}

/** The methods called, in order. */
export const methods = (calls: readonly Call[]): string[] =>
  calls.map(c => c.method)

/** A promise and the functions that settle it. */
export function deferred<T>(): {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
} {
  let resolve: (value: T) => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * A lane whose `run` and `resume` wait for `finish`, so a test sees the run in
 * progress for as long as it needs.
 */
export function fakeLane(
  name: LaneName,
  impl: Partial<ThreadLaneHandle> = {},
): {
  readonly lane: ThreadLaneHandle
  readonly calls: Call[]
  readonly finish: (outcome: WriteOutcome) => void
} {
  const ran = deferred<WriteOutcome>()
  const { port, calls } = record<ThreadLaneHandle>({
    name,
    run: async () => ran.promise,
    resume: async () => ran.promise,
    withGuidance: async () => {},
    ...impl,
  })
  return { lane: port, calls, finish: ran.resolve }
}

/** A stored entry row, as `packages/reads/index.test.ts` writes them. */
export const row = (
  id: string,
  parentId: string | null,
  message: unknown = { role: "user", content: id },
): StoredEntryRow => ({
  id,
  parentId,
  type: "message",
  timestamp: 0,
  fromId: null,
  payload: { message },
})

/**
 * One pi value, as pi stores it: `encodeWorkRecord`'s result, or an archive
 * record with its namespace and key.
 */
export function putValue(
  doc: SessionDocHandle,
  stored: {
    readonly namespace: string
    readonly key: string
    readonly value: unknown
  },
): void {
  doc.values.set(physicalKey(stored.namespace, stored.key), stored)
}

/** A fresh document, ids from a counter, a fixed clock, and the log's lines. */
export function basics(
  doc = newSessionDoc(),
  cards = newCardsDoc(),
): Basics & {
  readonly lines: string[]
} {
  let n = 0
  const lines: string[] = []
  return {
    doc,
    cards,
    log: m => lines.push(m),
    newId: () => `id-${String(++n).padStart(4, "0")}`,
    now: () => 1_000,
    lines,
  }
}
