// host/migrations/0007-thread-origin — each stored thread record's `fork`
// as its `origin` (ADR-0117): a record with no fork was started by its first
// message. No copy was made before this build, so every stored fork is null;
// one that is not is left as it is, its source unknown here, and stops
// decoding. One-time: delete this file once Duane's store has run it.

import { SESSION_TARGET } from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { THREAD } from "@pinetrie/rules"
import { applyRecordWrites, readNamespace, SessionDoc } from "@pinetrie/schema"
import type { RecordMigration } from "./index.ts"

/** What a stored thread record becomes: its contents with `origin`, or why it is left. */
export type ThreadOriginStep =
  | { readonly kind: "set"; readonly key: string; readonly value: unknown }
  | { readonly kind: "left"; readonly key: string }

/**
 * The stored thread records in the old shape, each with `fork` replaced by
 * its `origin`; one with a fork is left, since its source cannot be known
 * here. Empty when every record has its origin already. Pure.
 */
export function planThreadOrigin(
  stored: Readonly<Record<string, unknown>>,
): readonly ThreadOriginStep[] {
  return Object.entries(stored).flatMap(([key, value]): ThreadOriginStep[] => {
    if (value === null || typeof value !== "object" || !("fork" in value))
      return []
    const { fork, ...rest } = value as Record<string, unknown>
    return fork === null
      ? [{ kind: "set", key, value: { ...rest, origin: { kind: "started" } } }]
      : [{ kind: "left", key }]
  })
}

export const threadOrigin: RecordMigration = {
  name: "0007-thread-origin",
  async run({ exchange, docIds, hydrated }) {
    if (!docIds.includes(SESSION_DOC_ID)) return null
    const session = exchange.get(SESSION_DOC_ID, SessionDoc)
    await hydrated(SESSION_DOC_ID)
    const steps = planThreadOrigin(readNamespace(session, THREAD.namespace))
    if (steps.length === 0) return null
    return async () =>
      applyRecordWrites(
        session,
        steps.flatMap(s =>
          s.kind === "set"
            ? [
                {
                  kind: "set" as const,
                  target: SESSION_TARGET,
                  namespace: THREAD.namespace,
                  key: s.key,
                  value: s.value,
                },
              ]
            : [],
        ),
      )
  },
}
