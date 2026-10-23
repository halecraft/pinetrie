// machine — every decision about the machine lanes run on, and none of its
// I/O: the host hands it ports (`TECHNICAL.md`).

export {
  type Capabilities,
  planCapabilities,
  type StoreTarget,
} from "./capabilities.ts"
export {
  createMachineManager,
  MANAGE_MODES,
  type ManageMode,
  type ManagerNews,
} from "./manager.ts"
export type { HealthSink, MachineManager, MachineSensor } from "./ports.ts"
export type {
  LaneSample,
  MachineSample,
  SensedSample,
  UpkeepHeard,
} from "./sample.ts"
export {
  type Reservation,
  ROW_STATES,
  type RowState,
  type SnapshotIndex,
  type SnapshotRow,
  type SnapshotTaking,
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
  type StoreSettings,
} from "./store-settings.ts"
export {
  planStoreSize,
  type StoreSize,
  type StoreSizeFacts,
} from "./store-size.ts"
