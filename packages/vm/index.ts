// vm — a Linux machine on the Mac for lanes' Docker: its image,
// the launcher that runs it, and a host's lease on a slot of it. It knows
// nothing of lanes.

export { apkFiles, KERNEL_ENTRY, pinnedKernel, zbootImage } from "./apk.ts"
export {
  buildVmImageInVm,
  checkImageDir,
  gatherBuildFirst,
  readBuilderPins,
  readImageSources,
} from "./build.ts"
export {
  ensureGvproxy,
  type GvproxyPin,
  gvproxyPath,
  readGvproxyPin,
} from "./gvproxy.ts"
export { type Endable, type Kept, keepLease } from "./keep.ts"
export {
  type ExtraLease,
  type Lease,
  launcherWords,
  leaseExtra,
  leaseVm,
  VmRefused,
  vmProblem,
} from "./lease.ts"
export { ensurePinned, type Pin } from "./pinned.ts"
export {
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
  NOTHING_HELD,
  parseSums,
  planShares,
  planVm,
  planVmBuild,
  planVmVersion,
  planWidening,
  type ShareDir,
  sharePath,
  slotRoot,
  staleVmWords,
  type VmBuildFacts,
  type VmBuildPlan,
  type VmFacts,
  type VmHostRefusal,
  type VmPlan,
  type VmRefusal,
  type VmVersion,
  vmBuildWords,
  vmHostRefusal,
  vmMemory,
  vmStateDir,
  vmWords,
} from "./plan.ts"
export * from "./protocol.ts"
export { pruneVmState } from "./prune.ts"
export {
  BUILDER,
  binaryName,
  buildBinary,
  gatherBinary,
  LAUNCHER,
  type SwiftBinary,
} from "./swift.ts"
