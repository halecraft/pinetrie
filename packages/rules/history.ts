// history — the host's own messages in a thread's history: pi
// `CustomMessage`s whose `content` the model reads and whose `details`
// pine·trie reads back.

import { type Static, type TSchema, Type } from "typebox"
import { isWellFormed } from "./decode.ts"

/** A history message as pi stores it. */
export interface HistoryMessage<T extends string, D> {
  readonly role: "custom"
  readonly customType: T
  readonly content: string
  /** Whether pi shows it; a cards entry's marker is drawn by the column. */
  readonly display: boolean
  readonly details: D
  readonly timestamp: number
}

/** One kind of history message: its type, and its details both ways. */
export interface HistorySpec<T extends string, D> {
  readonly customType: T
  readonly encode: (
    details: D,
    content: string,
    timestamp: number,
  ) => HistoryMessage<T, D>
  /** A stored message -> its details, or undefined if it is not this kind. Total. */
  readonly decode: (message: unknown) => D | undefined
}

/**
 * The spec of the history messages of `customType`, whose details `details`
 * describes: encoding stores them as they are, and decoding is the schema's
 * check alone, its branded ids included (`decode.ts`).
 */
export function historyMessage<T extends string, S extends TSchema>(
  customType: T,
  details: S,
  display = true,
): HistorySpec<T, Static<S>> {
  const schema = Type.Object({
    role: Type.Literal("custom"),
    customType: Type.Literal(customType),
    details,
  })
  return {
    customType,
    encode: (d, content, timestamp) => ({
      role: "custom",
      customType,
      content,
      display,
      details: d,
      timestamp,
    }),
    decode: message =>
      isWellFormed(schema, message)
        ? (message as unknown as { readonly details: Static<S> }).details
        : undefined,
  }
}
