// machine — every decision about the machine lanes run on, and none of its
// I/O: the host hands it ports (`TECHNICAL.md`).

export {
  planStoreCapabilities,
  type StoreCapabilities,
  type StoreTarget,
} from "./capabilities.ts"
export { ROOM_SPENT, WAITING } from "./health.ts"
export { type LaneImportance, rankLanes } from "./importance.ts"
export {
  createMachineManager,
  MANAGE_MODES,
  type ManageMode,
  type ManagerNews,
} from "./manager.ts"
export {
  causeEvents,
  commandProgram,
  type DecisionMeasured,
  type LaneMeasured,
  type SampleMeasured,
} from "./measurements.ts"
export type {
  HealthSink,
  HostLaneFacts,
  MachineManager,
  MachineMeasurements,
  MachineSensor,
  RepairControls,
} from "./ports.ts"
export {
  encodeRepairState,
  isRepairRunning,
  type RepairOutcome,
  type RepairRead,
  type RepairState,
  repairFacts,
  repairStateNow,
} from "./repair.ts"
export { runRepairSteps } from "./repair-steps.ts"
export type {
  LaneSample,
  MachineReading,
  MachineSample,
  ReadingPlanned,
  SensedSample,
  UpkeepHeard,
} from "./sample.ts"
export {
  type Reservation,
  ROW_STATES,
  type RowState,
  type SnapshotIndex,
  type SnapshotReads,
  type SnapshotRow,
  type SnapshotTaking,
  snapshotsByLane,
} from "./snapshot-index.ts"
export type {
  RecordedSnapshot,
  StoreControls,
  StoreListed,
  StoreRecords,
} from "./store.ts"
export {
  LEAVE_FREE_DEFAULT,
  type LeaveFree,
  leaveFreeBytes,
  minimumUnallocated,
  type StoreSettings,
} from "./store-settings.ts"
export {
  planStoreSize,
  type StoreSize,
  type StoreSizeFacts,
} from "./store-size.ts"
export type { LaneActivity } from "./treatments.ts"
