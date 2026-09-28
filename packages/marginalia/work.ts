// work — where lanes work, the files at each entry, and landings
// (ADR-0032, ADR-0033).
//
// Four host-written records, each a pi value under a `pineta.` namespace.
// `encodeWorkRecord` is the one place their namespaces and keys are chosen;
// each has a total decoder. The decisions a landing needs (`planLand`,
// `planTake`, `landingOutcome`) and what a turn records
// (`planTurnRecord`) are pure, over what the host gathers.

import {
  type CommitId,
  commitId,
  type EntryId,
  ERR,
  type ErrCode,
  entryId,
  isBusy,
  type LandingRecord,
  type LaneName,
  type LaneRecord,
  type LaneView,
  type ProjectRecord,
  type RevisionRecord,
  type WriterId,
} from "@pineta/core"
import { Type } from "typebox"
import { decodeAll, decodeWith } from "./decode.ts"

export const LANE_NAMESPACE = "pineta.lane"
export const REVISION_NAMESPACE = "pineta.revision"
export const LANDING_NAMESPACE = "pineta.landing"
export const PROJECT_NAMESPACE = "pineta.project"
/** The one `pineta.project` value's key: a host has one project. */
export const PROJECT_KEY = "project"

const WorkSettingSchema = Type.Union([
  Type.Object({ kind: Type.Literal("own") }),
  Type.Object({
    kind: Type.Literal("direct"),
    dir: Type.String({ minLength: 1 }),
  }),
])

const LaneRecordSchema = Type.Object({
  lane: Type.String({ minLength: 1 }),
  work: WorkSettingSchema,
  by: Type.String(),
  createdAt: Type.Number(),
})

const RevisionRecordSchema = Type.Object({
  entry: Type.String({ minLength: 1 }),
  lane: Type.String({ minLength: 1 }),
  commit: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
})

const ProjectRecordSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("workspaces"),
    root: Type.String({ minLength: 1 }),
    rootDefault: Type.Union([Type.Literal("own"), Type.Literal("direct")]),
  }),
  Type.Object({
    kind: Type.Literal("direct"),
    root: Type.String({ minLength: 1 }),
    reason: Type.String(),
  }),
])

const LandingRecordSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  lane: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  yours: Type.Array(Type.String({ minLength: 1 })),
  result: Type.String({ minLength: 1 }),
  state: Type.Union([
    Type.Literal("resolved"),
    Type.Literal("needs_you"),
    Type.Literal("taken"),
  ]),
  by: Type.String(),
  at: Type.Number(),
})

export const decodeLaneRecord = (value: unknown): LaneRecord | undefined =>
  decodeWith(LaneRecordSchema, value, r => ({
    lane: r.lane as LaneName,
    work: r.work,
    by: r.by as WriterId,
    createdAt: r.createdAt,
  }))

export const decodeRevisionRecord = (
  value: unknown,
): RevisionRecord | undefined =>
  decodeWith(RevisionRecordSchema, value, r => ({
    entry: entryId(r.entry),
    lane: r.lane as LaneName,
    commit: r.commit === null ? null : commitId(r.commit),
  }))

export const decodeProjectRecord = (
  value: unknown,
): ProjectRecord | undefined => decodeWith(ProjectRecordSchema, value, r => r)

export const decodeLandingRecord = (
  value: unknown,
): LandingRecord | undefined =>
  decodeWith(LandingRecordSchema, value, r => ({
    ...r,
    lane: r.lane as LaneName,
    prompt: entryId(r.prompt),
    yours: r.yours.map(commitId),
    result: commitId(r.result),
    by: r.by as WriterId,
  }))

/** Any of the four, tagged: what the host writes through one method. */
export type WorkRecord =
  | { readonly kind: "lane"; readonly record: LaneRecord }
  | { readonly kind: "revision"; readonly record: RevisionRecord }
  | { readonly kind: "landing"; readonly record: LandingRecord }
  | { readonly kind: "project"; readonly record: ProjectRecord }

/** A record -> where it is stored and the plain value stored there. */
export function encodeWorkRecord(r: WorkRecord): {
  readonly namespace: string
  readonly key: string
  readonly value: unknown
} {
  switch (r.kind) {
    case "lane":
      return {
        namespace: LANE_NAMESPACE,
        key: r.record.lane,
        value: { ...r.record },
      }
    case "revision":
      return {
        namespace: REVISION_NAMESPACE,
        key: r.record.entry,
        value: { ...r.record },
      }
    case "landing":
      return {
        namespace: LANDING_NAMESPACE,
        key: r.record.id,
        value: { ...r.record },
      }
    case "project":
      return {
        namespace: PROJECT_NAMESPACE,
        key: PROJECT_KEY,
        value: { ...r.record },
      }
  }
}

type Stored = Iterable<{ readonly value: unknown }>

/** Stored `pineta.lane` values -> each lane's record, by lane. */
export const laneRecords = (values: Stored): ReadonlyMap<string, LaneRecord> =>
  new Map(decodeAll(values, decodeLaneRecord).map(r => [r.lane, r]))

/** Stored `pineta.revision` values -> each record, by the entry it is at. */
export const revisionRecords = (
  values: Stored,
): ReadonlyMap<string, RevisionRecord> =>
  new Map(decodeAll(values, decodeRevisionRecord).map(r => [r.entry, r]))

/** Stored `pineta.landing` values -> every landing, oldest first (ids are uuidv7). */
export const landingRecords = (values: Stored): readonly LandingRecord[] =>
  decodeAll(values, decodeLandingRecord).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )

/** The stored `pineta.project` value, or null before a host with tools wrote one. */
export const projectRecord = (values: Stored): ProjectRecord | null =>
  decodeAll(values, decodeProjectRecord)[0] ?? null

// ── landing ────────────────────────────────────────────────────────────────

/**
 * What a `land` does. Only a lane with its own copy lands; a busy lane holds
 * it, as it would a message, which also covers a landing already running.
 */
export function planLand(input: {
  readonly record: LaneRecord | undefined
  readonly view: LaneView | undefined
}):
  | { readonly kind: "start" }
  | { readonly kind: "hold"; readonly position: number }
  | { readonly kind: "refused"; readonly code: ErrCode } {
  const { record, view } = input
  if (record === undefined || view === undefined || record.work.kind !== "own")
    return { kind: "refused", code: ERR.NOT_OWN_COPY }
  return isBusy(view)
    ? { kind: "hold", position: view.waiting }
    : { kind: "start" }
}

/**
 * What a `take` does: only a resolved landing, and only while your `@-` is
 * the one it merged. `jj rebase -r @` moves only `@`, so a commit you made
 * after landing would drop out of `@`'s ancestry.
 */
export function planTake(input: {
  readonly landing: LandingRecord | undefined
  readonly yoursNow: readonly CommitId[]
}):
  | { readonly kind: "take"; readonly result: CommitId }
  | { readonly kind: "refused"; readonly code: ErrCode } {
  const { landing, yoursNow } = input
  if (landing === undefined || landing.state !== "resolved")
    return { kind: "refused", code: ERR.REFUSED }
  const same =
    landing.yours.length === yoursNow.length &&
    landing.yours.every(c => yoursNow.includes(c))
  return same
    ? { kind: "take", result: landing.result }
    : { kind: "refused", code: ERR.MOVED }
}

/**
 * How a landing ended. The agent can always stop by asking; it can never
 * claim a success the repository contradicts (ADR-0033).
 */
export const landingOutcome = (input: {
  readonly askedForGuidance: boolean
  readonly conflictsLeft: number
}): "resolved" | "needs_you" =>
  input.askedForGuidance || input.conflictsLeft > 0 ? "needs_you" : "resolved"

// ── turns ──────────────────────────────────────────────────────────────────

/**
 * What a turn records. A run's prompt always gets a record: the files the run
 * starts with (a commit of edits made between runs, else the lane's newest
 * revision), or no commit for a lane that works directly. An assistant
 * message gets one only when its tool calls changed files.
 */
export function planTurnRecord(input: {
  readonly entry: EntryId
  readonly lane: LaneName
  readonly isPrompt: boolean
  readonly own: boolean
  /** What `commitTurn` committed, or null when nothing changed. */
  readonly committed: CommitId | null
  /** The lane's newest revision before this turn. */
  readonly newest: CommitId | null
}): RevisionRecord | null {
  const { entry, lane } = input
  if (!input.own) return input.isPrompt ? { entry, lane, commit: null } : null
  if (input.committed !== null) return { entry, lane, commit: input.committed }
  return input.isPrompt && input.newest !== null
    ? { entry, lane, commit: input.newest }
    : null
}
