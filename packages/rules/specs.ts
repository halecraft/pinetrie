// specs — every host record's spec (ADR-0062), in one list: what a check
// over every record reads, as a migration's verification does (ADR-0096),
// and what a starting host keeps of the records it finds (ADR-0100).

import type { HostNamespace, Target, ValueWrite } from "@pinetrie/core"

import { ACCEPTED, BASE } from "./accepted.ts"
import { BANNER } from "./banner.ts"
import { BOARD, WORKFLOW } from "./board.ts"
import { CARD_HISTORY, TRACE } from "./card-history.ts"
import { COMMANDS } from "./commands.ts"
import { DIGEST } from "./digest.ts"
import { MARK } from "./mark.ts"
import { NAME } from "./names.ts"
import { OFFER } from "./offer.ts"
import { PARTICIPANT, PICTURE } from "./participant.ts"
import { QUEUE_HOLD } from "./queue-hold.ts"
import type { RecordSpec } from "./records.ts"
import { ROOT } from "./roots.ts"
import { SEAT } from "./seat.ts"
import { STOP } from "./stop.ts"
import { VERDICT } from "./verdict.ts"
import { LANE, PROJECT, REVISION } from "./work.ts"

/** What a check over every record reads of a spec: its address and its decoder. */
export type AnyRecordSpec = Pick<
  RecordSpec<unknown, string>,
  "namespace" | "home" | "decode"
>

/** Every record's spec. */
export const RECORD_SPECS: readonly AnyRecordSpec[] = [
  BANNER,
  BASE,
  BOARD,
  CARD_HISTORY,
  COMMANDS,
  DIGEST,
  LANE,
  ACCEPTED,
  MARK,
  NAME,
  OFFER,
  PARTICIPANT,
  PICTURE,
  PROJECT,
  QUEUE_HOLD,
  REVISION,
  ROOT,
  SEAT,
  STOP,
  TRACE,
  VERDICT,
  WORKFLOW,
]

const DECLARED: ReadonlySet<string> = new Set(
  RECORD_SPECS.map(spec => spec.namespace),
)

/** The namespaces a document holds, with each one's keys, where it is. */
export interface StoredRecords {
  readonly target: Target
  readonly namespaces: ReadonlyMap<string, readonly string[]>
}

/**
 * Deletes for every record whose namespace no spec declares (ADR-0100): a
 * renamed or retired record type leaves nothing behind once a host starts.
 * Pure.
 */
export const planUndeclaredSweep = (
  stored: readonly StoredRecords[],
): ValueWrite[] =>
  stored.flatMap(({ target, namespaces }) =>
    [...namespaces].flatMap(([namespace, keys]) =>
      DECLARED.has(namespace)
        ? []
        : keys.map(key => ({
            kind: "delete" as const,
            target,
            namespace: namespace as HostNamespace,
            key,
          })),
    ),
  )
