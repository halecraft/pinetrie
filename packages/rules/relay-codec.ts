// relay-codec — a relay's shape, and an ask card's relay as the places
// document stores it. The card's record decodes it, so this imports none of
// the relay's rules, which load the card's record.

import type { RelayDetails } from "@pinetrie/core"
import { Type } from "typebox"
import {
  EntryIdSchema,
  isWellFormed,
  ThreadIdSchema,
  WriterIdSchema,
} from "./decode.ts"

const AskerSchema = Type.Union([
  Type.Object({ kind: Type.Literal("person"), writer: WriterIdSchema }),
  Type.Object({ kind: Type.Literal("agent"), thread: ThreadIdSchema }),
])

export const RelaySchema = Type.Object({
  from: ThreadIdSchema,
  fromName: Type.String(),
  source: EntryIdSchema,
  asker: AskerSchema,
  askerName: Type.String(),
  text: Type.String(),
  budget: EntryIdSchema,
  by: WriterIdSchema,
})

/** An ask card's relay, in the places document's flat strings. */
export const encodeRelay = (relay: RelayDetails): string =>
  JSON.stringify(relay)

/** An ask card's stored relay -> the relay; undefined for one malformed. Total. */
export function decodeStoredRelay(stored: string): RelayDetails | undefined {
  try {
    const relay: unknown = JSON.parse(stored)
    return isWellFormed(RelaySchema, relay) ? relay : undefined
  } catch {
    return undefined
  }
}
