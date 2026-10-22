// specs — every host record's spec, in one list.

import type {
  HostNamespace,
  ProjectKind,
  ProposedChangesRecord,
  Target,
  ThreadId,
  ValueWrite,
} from "@pinetrie/core"

import { ACCEPTED, ACCEPTED_KEY, type AcceptedRecord } from "./accepted.ts"
import { ACCESS } from "./access.ts"
import { ALLOWANCE } from "./allowance.ts"
import { BANNER, ICONS } from "./banner.ts"
import { BASE, type BaseRecord } from "./base.ts"
import { WORKFLOW } from "./board.ts"
import { CARD_HISTORY, TRACE } from "./card-history.ts"
import { CARD_TITLE } from "./card-title.ts"
import { COMMANDS } from "./commands.ts"
import { CONFLICT_ASK } from "./conflict-ask.ts"
import { DIGEST } from "./digest.ts"
import { FOCUS } from "./focus.ts"
import { CONFLICT, FOLDER_WRITE_JOURNAL, STATE } from "./folder-records.ts"
import { MACHINE } from "./machine.ts"
import { MARK } from "./mark.ts"
import { NAME } from "./names.ts"
import { PARTICIPANT, PICTURE } from "./participant.ts"
import { PROPOSED_CHANGES } from "./proposed.ts"
import { QUEUE_HOLD } from "./queue-hold.ts"
import { deleteRecord, type RecordSpec } from "./records.ts"
import { ROOT } from "./roots.ts"
import { RUN_END_REPORT } from "./run-end-report.ts"
import { SEAT } from "./seat.ts"
import { SETUP } from "./setup.ts"
import { SHARED_LINEAGE } from "./shared.ts"
import { OUTPUT_SPLIT } from "./statement-output.ts"
import { THREAD } from "./thread.ts"
import { LANE, LANE_FORK, PROJECT, REVISION } from "./work.ts"

/** What a check over every record reads of a spec: its address and its decoder. */
type AnyRecordSpec = Pick<
  RecordSpec<unknown, string>,
  "namespace" | "home" | "decode"
>

/** Every record's spec. */
export const RECORD_SPECS: readonly AnyRecordSpec[] = [
  FOLDER_WRITE_JOURNAL,
  ACCESS,
  BANNER,
  BASE,
  ALLOWANCE,
  CARD_HISTORY,
  CARD_TITLE,
  COMMANDS,
  CONFLICT,
  ICONS,
  DIGEST,
  LANE,
  LANE_FORK,
  ACCEPTED,
  MACHINE,
  MARK,
  NAME,
  OUTPUT_SPLIT,
  PROPOSED_CHANGES,
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
  RUN_END_REPORT,
  FOCUS,
  CONFLICT_ASK,
  WORKFLOW,
]

/** Each declared namespace's home. */
const DECLARED: ReadonlyMap<string, AnyRecordSpec["home"]> = new Map(
  RECORD_SPECS.map(spec => [spec.namespace, spec.home]),
)

/** The namespaces a document holds, with each one's keys, where it is. */
interface StoredRecords {
  readonly target: Target
  readonly namespaces: ReadonlyMap<string, readonly string[]>
}

/**
 * Deletes for every record whose namespace no spec declares, or
 * that is stored outside its spec's home: a renamed, retired or rehomed
 * record type (a mark, once a root's, now a canvas's in the session)
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
 * Deletes for every proposed changes, accepted-work and base record of another
 * kind than the project's: caches of a project that was the other kind before,
 * which no reader of this one reads. A folder's `STATE` and `CONFLICT` records
 * are never among them, so accepted work's line outlives a jj period.
 */
export const planKindSweep = (
  records: {
    readonly proposedByLane: ReadonlyMap<ThreadId, ProposedChangesRecord>
    readonly accepted: AcceptedRecord | null
    readonly bases: ReadonlyMap<ThreadId, BaseRecord>
  },
  kind: ProjectKind,
): ValueWrite<"session">[] => [
  ...[...records.proposedByLane.values()]
    .filter(r => r.kind !== kind)
    .map(r => deleteRecord(PROPOSED_CHANGES, r.lane)),
  ...(records.accepted !== null && records.accepted.kind !== kind
    ? [deleteRecord(ACCEPTED, ACCEPTED_KEY)]
    : []),
  ...[...records.bases.values()]
    .filter(r => r.kind !== kind)
    .map(r => deleteRecord(BASE, r.lane)),
]
