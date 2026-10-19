// schema/fixtures — test support: documents written as the host and pi write
// them. Tests use it as `@pinetrie/schema/fixtures`; production code never
// imports it.

import { createDoc } from "@kyneta/schema"
import type { EntryId, RunId, ThreadId } from "@pinetrie/core"
import {
  applyLiveOps,
  LANE_TIP,
  LiveDoc,
  type LiveDocHandle,
  OpenDoc,
  type OpenDocHandle,
  PlacesDoc,
  type PlacesDocHandle,
  PresenceDoc,
  type PresenceDocHandle,
  physicalKey,
  RootDoc,
  type RootDocHandle,
  ScratchDoc,
  type ScratchDocHandle,
  SessionDoc,
  type SessionDocHandle,
  type StoredEntryRow,
  type StoredValueRecord,
} from "./index.ts"

/** A root's document with no Exchange. */
export const newRootDoc = (): RootDocHandle => createDoc(RootDoc)

/** A root's scratch document with no Exchange. */
export const newScratchDoc = (): ScratchDocHandle => createDoc(ScratchDoc)

/** The session's document with no Exchange. */
export const newSessionDoc = (): SessionDocHandle => createDoc(SessionDoc)

/** A person's open-tasks document with no Exchange. */
export const newOpenDoc = (): OpenDocHandle => createDoc(OpenDoc)

/** The live document with no Exchange. */
export const newLiveDoc = (): LiveDocHandle => createDoc(LiveDoc)

/** The places document with no Exchange. */
export const newPlacesDoc = (): PlacesDocHandle => createDoc(PlacesDoc)

/** The presence document with no Exchange. */
export const newPresenceDoc = (): PresenceDocHandle => createDoc(PresenceDoc)

/**
 * Write one entry row, as pi's storage does. The caller supplies `id`: a
 * same-key write replaces the row, and entry ids are unique.
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
  lane: ThreadId,
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
  lane: ThreadId,
  run: RunId,
): void => applyLiveOps(live, [{ kind: "begin", lane, run }])
