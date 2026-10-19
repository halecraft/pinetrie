// host/migrations/0004-card-titles — a note column's title moves from its own
// record, `pinetrie.note-column`, to the one every titled card has,
// `pinetrie.card-title` (`CARD_TITLE`), under the same id and with the same
// contents. Each old record is deleted as its new one is written, so over its
// own output it plans nothing.

import { SESSION_TARGET, type ValueWrite } from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { applyRecordWrites, readNamespace, SessionDoc } from "@pinetrie/schema"
import type { RecordMigration } from "./index.ts"

const OLD = "pinetrie.note-column"
const NEW = "pinetrie.card-title"

/** Each stored note column's title written as a card's title, and deleted where it was. */
export function planCardTitles(
  stored: Readonly<Record<string, unknown>>,
): readonly ValueWrite<"session">[] {
  return Object.entries(stored).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? [
          {
            kind: "set",
            target: SESSION_TARGET,
            namespace: NEW,
            key,
            value,
          } as const,
          {
            kind: "delete",
            target: SESSION_TARGET,
            namespace: OLD,
            key,
          } as const,
        ]
      : [
          {
            kind: "delete",
            target: SESSION_TARGET,
            namespace: OLD,
            key,
          } as const,
        ],
  )
}

export const CARD_TITLES: RecordMigration = {
  name: "0004-card-titles",
  async run({ exchange, docIds, hydrated }) {
    if (!docIds.includes(SESSION_DOC_ID)) return null
    const session = exchange.get(SESSION_DOC_ID, SessionDoc)
    await hydrated(SESSION_DOC_ID)
    const writes = planCardTitles(readNamespace(session, OLD))
    if (writes.length === 0) return null
    return async () => applyRecordWrites(session, writes)
  },
}
