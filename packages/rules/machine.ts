// machine — the health of the machine lanes run on, as the host last planned
// it: the one `pinetrie.machine` value, written when it changes, at the
// host's start and at its stop, so no tab reads a stopped host's.

import {
  LANE_TREATMENTS,
  MACHINE_SERVICES,
  MACHINE_STATES,
  type MachineHealth,
  UNSAMPLED_REASONS,
} from "@pinetrie/core"
import { Type } from "typebox"
import {
  choiceSchema,
  fixedKey,
  List,
  recordDecoder,
  ThreadIdSchema,
} from "./decode.ts"
import type { RecordSpec } from "./records.ts"

/** The one `pinetrie.machine` value's key. */
export const MACHINE_KEY = "machine"

const Bytes = Type.Number({ minimum: 0 })

const CauseSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("room-low"),
    unallocated: Bytes,
    minimum: Bytes,
    grows: Type.Boolean(),
  }),
  Type.Object({ kind: Type.Literal("room-spent"), unallocated: Bytes }),
  Type.Object({
    kind: Type.Literal("metadata-full"),
    used: Bytes,
    total: Bytes,
  }),
  Type.Object({
    kind: Type.Literal("filesystem-low"),
    free: Bytes,
    leaveFree: Bytes,
  }),
  Type.Object({
    kind: Type.Literal("memory-short"),
    rung: Type.Integer({ minimum: 2, maximum: 5 }),
    isHolding: Type.Boolean(),
  }),
  Type.Object({ kind: Type.Literal("lane-oom-killed"), lane: ThreadIdSchema }),
  Type.Object({
    kind: Type.Literal("service-oom-killed"),
    service: choiceSchema(MACHINE_SERVICES),
  }),
  Type.Object({
    kind: Type.Literal("cgroup-at-limit"),
    subject: Type.Union([
      Type.Object({ kind: Type.Literal("lane"), lane: ThreadIdSchema }),
      Type.Object({
        kind: Type.Literal("service"),
        service: choiceSchema(MACHINE_SERVICES),
      }),
    ]),
  }),
  Type.Object({ kind: Type.Literal("host-stalls"), stalledMs: Bytes }),
  Type.Object({
    kind: Type.Literal("snapshot-skipped"),
    count: Type.Integer({ minimum: 1 }),
  }),
  Type.Object({ kind: Type.Literal("freeing-room") }),
  Type.Object({
    kind: Type.Literal("room-unrecoverable"),
    unallocated: Bytes,
    minimum: Bytes,
    isRepaired: Type.Boolean(),
  }),
  Type.Object({
    kind: Type.Literal("disk-being-repaired"),
    step: Type.Union([
      Type.Literal("detected"),
      Type.Literal("stopping-vm"),
      Type.Literal("booting-repair"),
    ]),
    progress: Type.Union([Type.String(), Type.Null()]),
  }),
  Type.Object({ kind: Type.Literal("disk-repair-failed"), why: Type.String() }),
  Type.Object({
    kind: Type.Literal("unsampled"),
    reason: choiceSchema(UNSAMPLED_REASONS),
    error: Type.Union([Type.String(), Type.Null()]),
  }),
])

const HealthSchema = Type.Object({
  state: choiceSchema(MACHINE_STATES),
  causes: List(CauseSchema),
  treatments: List(
    Type.Object({
      lane: ThreadIdSchema,
      treatment: Type.Object({ kind: choiceSchema(LANE_TREATMENTS) }),
    }),
  ),
})

/**
 * The machine's health, at `MACHINE_KEY`. A cause added to core fails the
 * type check here until `CauseSchema` stores it: one stored without it would
 * not decode, and every tab would read no health at all.
 */
export const MACHINE: RecordSpec<
  MachineHealth,
  typeof MACHINE_KEY,
  "session",
  typeof HealthSchema
> = {
  namespace: "pinetrie.machine",
  home: "session",
  keyOf: () => MACHINE_KEY,
  encode: h => ({
    state: h.state,
    causes: h.causes.map(c => ({ ...c })),
    treatments: h.treatments.map(t => ({
      lane: t.lane,
      treatment: { ...t.treatment },
    })),
  }),
  decode: recordDecoder(
    HealthSchema,
    key => fixedKey(MACHINE_KEY, key),
    h => ({
      state: h.state,
      causes: h.causes,
      treatments: h.treatments,
    }),
  ),
}
