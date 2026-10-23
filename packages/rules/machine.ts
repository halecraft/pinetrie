// machine — the health of the machine lanes run on, as the host last planned
// it: the one `pinetrie.machine` value, written when it changes, at the
// host's start and at its stop, so no tab reads a stopped host's.

import {
  MACHINE_SERVICES,
  MACHINE_STATES,
  type MachineCause,
  type MachineHealth,
  UNSAMPLED_REASONS,
} from "@pinetrie/core"
import { Type } from "typebox"
import {
  choiceSchema,
  decodeRecord,
  fixedKey,
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
  Type.Object({ kind: Type.Literal("memory-stalls"), fullAvg10: Bytes }),
  Type.Object({ kind: Type.Literal("lane-oom-killed"), lane: ThreadIdSchema }),
  Type.Object({
    kind: Type.Literal("service-oom-killed"),
    service: choiceSchema(MACHINE_SERVICES),
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
  }),
  Type.Object({
    kind: Type.Literal("unsampled"),
    reason: choiceSchema(UNSAMPLED_REASONS),
    error: Type.Union([Type.String(), Type.Null()]),
  }),
])

const HealthSchema = Type.Object({
  state: choiceSchema(MACHINE_STATES),
  causes: Type.Array(CauseSchema),
})

export const MACHINE: RecordSpec<MachineHealth, typeof MACHINE_KEY, "session"> =
  {
    namespace: "pinetrie.machine",
    home: "session",
    keyOf: () => MACHINE_KEY,
    encode: h => ({ state: h.state, causes: h.causes.map(c => ({ ...c })) }),
    decode: (contents, key) =>
      decodeRecord(HealthSchema, contents, fixedKey(MACHINE_KEY, key), h => ({
        state: h.state,
        causes: h.causes as readonly MachineCause[],
      })),
  }
