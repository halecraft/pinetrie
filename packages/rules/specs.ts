// specs — every host record's spec (ADR-0062), in one list: what a check
// over every record reads, as a migration's verification does (ADR-0096),
// and what a starting host keeps of the records it finds (ADR-0100).

import type { HostNamespace, Target, ValueWrite } from "@pinetrie/core"

import { ACCEPTED } from "./accepted.ts"
import { BANNER } from "./banner.ts"
import { BASE } from "./base.ts"
import { BOARD, WORKFLOW } from "./board.ts"
import { CARD_HISTORY, TRACE } from "./card-history.ts"
import { COMMANDS } from "./commands.ts"
import { DIGEST } from "./digest.ts"
import { MARK } from "./mark.ts"
import { NAME } from "./names.ts"
import { NOTE_COLUMN } from "./note-column.ts"
import { OFFER } from "./offer.ts"
import { PARTICIPANT, PICTURE } from "./participant.ts"
import { QUEUE_HOLD } from "./queue-hold.ts"
import type { RecordSpec } from "./records.ts"
import { ROOT } from "./roots.ts"
import { SEAT } from "./seat.ts"
import { STOP } from "./stop.ts"
import { TASK } from "./task.ts"
import { THREAD } from "./thread.ts"
import { VERDICT } from "./verdict.ts"
import { FILES_LOST, LANE, PROJECT, REVISION } from "./work.ts"

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
  FILES_LOST,
  LANE,
  ACCEPTED,
  MARK,
  NAME,
  NOTE_COLUMN,
  OFFER,
  PARTICIPANT,
  PICTURE,
  PROJECT,
  QUEUE_HOLD,
  THREAD,
  REVISION,
  ROOT,
  SEAT,
  STOP,
  TASK,
  TRACE,
  VERDICT,
  WORKFLOW,
]

/** Each declared namespace's home. */
const DECLARED: ReadonlyMap<string, AnyRecordSpec["home"]> = new Map(
  RECORD_SPECS.map(spec => [spec.namespace, spec.home]),
)

/** The namespaces a document holds, with each one's keys, where it is. */
export interface StoredRecords {
  readonly target: Target
  readonly namespaces: ReadonlyMap<string, readonly string[]>
}

/**
 * Deletes for every record whose namespace no spec declares (ADR-0100), or
 * that is stored outside its spec's home: a renamed, retired or rehomed
 * record type (a mark, once a root's, now a task's in the session)
 * leaves nothing behind once a host starts. Pure.
 */
export const planUndeclaredSweep = (
  stored: readonly StoredRecords[],
): ValueWrite[] =>
  stored.flatMap(({ target, namespaces }) =>
    [...namespaces].flatMap(([namespace, keys]) =>
      DECLARED.get(namespace) === target.kind
        ? []
        : keys.map(key => ({
            kind: "delete" as const,
            target,
            namespace: namespace as HostNamespace,
            key,
          })),
    ),
  )
