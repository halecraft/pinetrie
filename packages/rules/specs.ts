// specs — every host record's spec, in one list.

import type {
  AcceptedRecord,
  BaseRecord,
  HostNamespace,
  OfferRecord,
  ProjectKind,
  Target,
  ThreadId,
  ValueWrite,
} from "@pinetrie/core"

import { ACCEPTED, ACCEPTED_KEY } from "./accepted.ts"
import { ACCESS } from "./access.ts"
import { BANNER, ICONS } from "./banner.ts"
import { BASE } from "./base.ts"
import { WORKFLOW } from "./board.ts"
import { BUDGET } from "./budget.ts"
import { CARD_HISTORY, TRACE } from "./card-history.ts"
import { COMMANDS } from "./commands.ts"
import { DIGEST } from "./digest.ts"
import { CONFLICT, STATE } from "./folder-records.ts"
import { MARK } from "./mark.ts"
import { NAME } from "./names.ts"
import { NOTE_COLUMN } from "./note-column.ts"
import { OFFER } from "./offer.ts"
import { PARTICIPANT, PICTURE } from "./participant.ts"
import { QUEUE_HOLD } from "./queue-hold.ts"
import { deleteRecord, type RecordSpec } from "./records.ts"
import { ROOT } from "./roots.ts"
import { SEAT } from "./seat.ts"
import { SETUP } from "./setup.ts"
import { SHARED_LINEAGE } from "./shared.ts"
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
  ACCESS,
  BANNER,
  BASE,
  BUDGET,
  CARD_HISTORY,
  COMMANDS,
  CONFLICT,
  ICONS,
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
  SETUP,
  SHARED_LINEAGE,
  STATE,
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
 * Deletes for every record whose namespace no spec declares, or
 * that is stored outside its spec's home: a renamed, retired or rehomed
 * record type (a mark, once a root's, now a task's in the session)
 * leaves nothing behind once a host starts.
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

/**
 * Deletes for every offer, accepted-work and base record of another kind
 * than the project's: caches of a project that was the other kind before,
 * which no reader of this one reads. A folder's `STATE` and `CONFLICT`
 * records are never among them, so your folder's line outlives a jj period.
 */
export const planKindSweep = (
  records: {
    readonly offers: ReadonlyMap<ThreadId, OfferRecord>
    readonly accepted: AcceptedRecord | null
    readonly bases: ReadonlyMap<ThreadId, BaseRecord>
  },
  kind: ProjectKind,
): ValueWrite[] => [
  ...[...records.offers.values()]
    .filter(r => r.kind !== kind)
    .map(r => deleteRecord(OFFER, r.lane)),
  ...(records.accepted !== null && records.accepted.kind !== kind
    ? [deleteRecord(ACCEPTED, ACCEPTED_KEY)]
    : []),
  ...[...records.bases.values()]
    .filter(r => r.kind !== kind)
    .map(r => deleteRecord(BASE, r.lane)),
]
