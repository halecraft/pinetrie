// host/root-trace — an opt-in log of how the host uses roots, one JSON object
// a line: each use of a root and whether it had to load, each lease's end,
// and each upkeep's plan. `PINETRIE_ROOT_TRACE=<file>` turns it on; replayed
// offline, it says what a policy for keeping roots loaded would have cost.

import { createWriteStream } from "node:fs"
import type { RootId } from "@pinetrie/core"

/** What the host did with a root. */
export type RootEvent =
  | {
      readonly kind: "use"
      readonly root: RootId
      /** A step's documents, a lease, or a tab's ask. */
      readonly via: "step" | "lease" | "tab"
      /** Whether this use loaded it. */
      readonly loaded: boolean
      /** The host code that asked, as `file:line`; null when unknown. */
      readonly caller: string | null
    }
  | { readonly kind: "release"; readonly root: RootId }
  | {
      readonly kind: "upkeep"
      readonly loaded: number
      readonly leased: number
      /** The roots a tab holds or is taking, which stay loaded. */
      readonly shown: readonly RootId[]
      readonly compact: readonly string[]
      readonly unload: readonly RootId[]
    }

/** Hears each event; absent when tracing is off, so nothing is computed for it. */
export type RootTrace = (event: RootEvent) => void

/** Frames of the code that keeps roots, which name no caller. */
const KEEPING = /\/(roots|root-trace|records)\.ts:|node:internal|\(native\)/

/**
 * The first frame of `stack` outside the code that keeps roots, as
 * `file:line` from the repo's `apps/` or `packages/`; null when there is none.
 */
export function callerIn(stack: string): string | null {
  for (const line of stack.split("\n").slice(1)) {
    if (KEEPING.test(line)) continue
    const at = /((?:apps|packages)\/[^\s:()]+:\d+)/.exec(line)
    if (at?.[1] !== undefined) return at[1]
  }
  return null
}

/** The caller of the code that keeps roots, from here. */
export const callerNow = (): string | null => callerIn(new Error().stack ?? "")

/**
 * A trace appending to `file`, each event stamped with `now()`, and its
 * close. Writes are queued on a stream, so tracing adds no synchronous I/O.
 */
export function fileTrace(
  file: string,
  now: () => number,
): { readonly trace: RootTrace; close(): Promise<void> } {
  const out = createWriteStream(file, { flags: "a" })
  out.on("error", () => {})
  return {
    trace: event =>
      void out.write(`${JSON.stringify({ at: now(), ...event })}\n`),
    close: () => new Promise(resolve => out.end(resolve)),
  }
}
