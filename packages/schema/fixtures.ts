// schema/fixtures — test support: documents written as the host and pi write
// them. Tests use it as `@pinetrie/schema/fixtures`; production code never
// imports it.

import { createDoc } from "@kyneta/schema"
import type { EntryId, LaneName, RunId } from "@pinetrie/core"
import {
  applyLiveOps,
  LANE_TIP,
  type LiveDocHandle,
  physicalKey,
  RootDoc,
  type RootDocHandle,
  SessionDoc,
  type SessionDocHandle,
  type StoredEntryRow,
  type StoredValueRecord,
} from "./index.ts"

/** A root's document with no Exchange. */
export const newRootDoc = (): RootDocHandle => createDoc(RootDoc)

/** The session's document with no Exchange. */
export const newSessionDoc = (): SessionDocHandle => createDoc(SessionDoc)

/**
 * Write one entry row, as pi's storage does. The caller supplies `id`: a
 * same-key write replaces the row, and entry ids are unique (ADR-0009).
 */
export function writeEntry(doc: RootDocHandle, row: StoredEntryRow): void {
  doc.entries.set(row.id, row)
}

/**
 * Record a lane at `tip` as pi does, in its `pi.branch.tip` value: null for a
 * lane with no entry yet.
 */
export function writeLaneTip(
  doc: RootDocHandle,
  lane: LaneName,
  tip: EntryId | null,
): void {
  const record: StoredValueRecord = {
    namespace: LANE_TIP,
    key: lane,
    value: tip,
  }
  doc.values.set(physicalKey(LANE_TIP, lane), record)
}

/** Mark `lane` as running `run`, as a starting run does. */
export const beginRun = (
  live: LiveDocHandle,
  lane: LaneName,
  run: RunId,
): void => applyLiveOps(live, [{ kind: "begin", lane, run }])
