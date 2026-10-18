// core/live — what a running turn streams, and the changes it makes to
// `pinetrie:live`. `@pinetrie/rules` plans the changes
// (`packages/rules/live.ts`), and `@pinetrie/schema` writes them.

import type { TextEdit } from "./edits.ts"
import type { EntryId, RunId, ThreadId } from "./ids.ts"

/**
 * What a running turn streams, in pine·trie's own words: no pi type crosses.
 * `packages/pi` maps pi's harness events onto it. There is no end event: a
 * stream stays until the entry that replaces it is written.
 */
export type StreamEvent =
  /** Text the model is writing, as a delta. */
  | { readonly kind: "text"; readonly lane: ThreadId; readonly delta: string }
  | {
      readonly kind: "toolStart"
      readonly lane: ThreadId
      readonly callId: string
    }
  /** The tool's output so far: a whole snapshot, not a delta. */
  | {
      readonly kind: "toolOutput"
      readonly lane: ThreadId
      readonly callId: string
      readonly text: string
    }

declare const streamIdBrand: unique symbol
/** A stream's key in `pinetrie:live`: a fresh uuidv7. */
export type StreamId = string & { readonly [streamIdBrand]: true }
export const streamId = (id: string): StreamId => id as StreamId

/**
 * When a stream opened, in ms since the epoch on the host's clock: a
 * uuidv7's first 48 bits. Undefined for an id that is no uuidv7, as a test's
 * fake ids are.
 */
export function streamStart(id: StreamId): number | undefined {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7/i.test(id)) return undefined
  return Number.parseInt(id.slice(0, 8) + id.slice(9, 13), 16)
}

/** A stream as stored, without its text. */
export type StreamRecord =
  | {
      readonly id: StreamId
      readonly lane: ThreadId
      readonly kind: "reply"
      /** The lane's tip when the reply opened. */
      readonly under: EntryId | null
    }
  | {
      readonly id: StreamId
      readonly lane: ThreadId
      readonly kind: "tool"
      readonly callId: string
    }

/** A stream, with what it has written so far. */
export type Stream = StreamRecord & { readonly text: string }

/** One change to `pinetrie:live`. */
export type LiveOp =
  | { readonly kind: "open"; readonly stream: StreamRecord }
  | {
      readonly kind: "edit"
      readonly id: StreamId
      readonly edits: readonly TextEdit[]
    }
  /** Deletes the stream's record and its text, either of which may be gone. */
  | { readonly kind: "close"; readonly id: StreamId }
  | { readonly kind: "begin"; readonly lane: ThreadId; readonly run: RunId }
  /** The lane is idle: its key is deleted, never set to "". */
  | { readonly kind: "end"; readonly lane: ThreadId }
