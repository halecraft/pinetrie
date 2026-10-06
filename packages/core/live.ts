// core/live — what a running turn streams, and the changes it makes to
// `pinetrie:live` (ADR-0014, ADR-0063). `@pinetrie/rules` plans the changes
// (`packages/rules/live.ts`), and `@pinetrie/schema` writes them.

import type { TextEdit } from "./edits.ts"
import type { EntryId, LaneName, RunId } from "./index.ts"

/**
 * What a running turn streams, in pine·trie's own words (ADR-0003: no pi type
 * crosses). `packages/pi` maps pi's harness events onto it. There is no end
 * event: a stream stays until the entry that replaces it is written.
 */
export type StreamEvent =
  /** Text the model is writing, as a delta. */
  | { readonly kind: "text"; readonly lane: LaneName; readonly delta: string }
  | {
      readonly kind: "toolStart"
      readonly lane: LaneName
      readonly callId: string
    }
  /** The tool's output so far: a whole snapshot, not a delta. */
  | {
      readonly kind: "toolOutput"
      readonly lane: LaneName
      readonly callId: string
      readonly text: string
    }

declare const streamIdBrand: unique symbol
/** A stream's key in `pinetrie:live`: a fresh uuidv7 (ADR-0016). */
export type StreamId = string & { readonly [streamIdBrand]: true }
export const streamId = (id: string): StreamId => id as StreamId

/** A stream as stored, without its text. */
export type StreamRecord =
  | {
      readonly id: StreamId
      readonly lane: LaneName
      readonly kind: "reply"
      /** The lane's tip when the reply opened. */
      readonly under: EntryId | null
    }
  | {
      readonly id: StreamId
      readonly lane: LaneName
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
  | { readonly kind: "begin"; readonly lane: LaneName; readonly run: RunId }
  /** The lane is idle: its key is deleted, never set to "". */
  | { readonly kind: "end"; readonly lane: LaneName }
