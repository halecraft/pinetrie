// machine — every decision about the machine lanes run on, and none of its
// I/O: the host hands it ports (`TECHNICAL.md`).

export { createMachineManager, type ManagerNews } from "./manager.ts"
export type { HealthSink, MachineManager, MachineSensor } from "./ports.ts"
export type { LaneSample, MachineSample, SensedSample } from "./sample.ts"
export {
  type Reservation,
  ROW_STATES,
  type RowState,
  type SnapshotIndex,
  type SnapshotReads,
  type SnapshotRow,
  type SnapshotTaking,
} from "./snapshot-index.ts"
export {
  LEAVE_FREE_DEFAULT,
  type LeaveFree,
  type StoreSettings,
} from "./store-settings.ts"
