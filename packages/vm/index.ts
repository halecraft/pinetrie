// vm — a Linux machine on the Mac for lanes' Docker: its image,
// the launcher that runs it, and a host's lease on a slot of it. It knows
// nothing of lanes.

export { apkFiles, KERNEL_ENTRY, pinnedKernel, zbootImage } from "./apk.ts"
export {
  buildVmImageInVm,
  checkImageDir,
  gatherBuildFirst,
  gatherChangedFiles,
  readBuilderPins,
  readImageSources,
} from "./build.ts"
export {
  type DataDiskFacts,
  type DataDiskPlan,
  gatherDataDisk,
  growDataDisk,
} from "./grow.ts"
export {
  ensureGvproxy,
  type GvproxyPin,
  gvproxyPath,
  readGvproxyPin,
} from "./gvproxy.ts"
export { type Endable, type Kept, keepLease } from "./keep.ts"
export {
  DiskFullAtBoot,
  type ExtraLease,
  gatherRunningVm,
  type Lease,
  launcherWords,
  leaseExtra,
  leaseVm,
  readVmLogTail,
  stopVmForRepair,
  type VmBuild,
  type VmLog,
  VmRefused,
  vmProblem,
} from "./lease.ts"
export { ensurePinned, type Pin } from "./pinned.ts"
export {
  DATA_DISK_FULL_LINE,
  type Fill,
  GVPROXY_HOST_ADDRESS,
  type Held,
  type Holdings,
  holdFill,
  IMAGE_FILES,
  IMAGE_OUTPUTS,
  type ImageSources,
  imageDir,
  imageKey,
  imageRefusal,
  LAUNCHER_DISKS,
  type LauncherDisks,
  type LauncherFacts,
  launcherArgs,
  NOTHING_HELD,
  otherHolders,
  parseSums,
  planShares,
  planVm,
  planVmBuild,
  planVmVersion,
  planWidening,
  type ShareDir,
  sharePath,
  slotRoot,
  type VmBuildFacts,
  type VmBuildPlan,
  type VmFacts,
  type VmHostRefusal,
  type VmPlan,
  type VmRefusal,
  type VmVersion,
  vmBuildWords,
  vmHostRefusal,
  vmMemoryCeiling,
  vmNoneRunningWords,
  vmStateDir,
  vmVersionWords,
  vmWords,
} from "./plan.ts"
export * from "./protocol.ts"
export { pruneVmState } from "./prune.ts"
export {
  ensureRepairBoot,
  type RepairReport,
  repairBootMissing,
  repairDataDisk,
} from "./repair.ts"
export {
  awaitLauncherGone,
  type LauncherLockHeld,
  type RepairLockHeld,
  readRepairFacts,
  takeRepairLock,
  writeRepairState,
} from "./repair-lock.ts"
export {
  BUILDER,
  binaryName,
  buildBinary,
  gatherBinary,
  LAUNCHER,
  type SwiftBinary,
} from "./swift.ts"
