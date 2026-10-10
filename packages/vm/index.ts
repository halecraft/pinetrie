// vm — a Linux machine on the Mac for lanes' Docker (ADR-0130): its image,
// the launcher that runs it, and a host's lease on a slot of it. It knows
// nothing of lanes.

export {
  buildVmImage,
  checkImageDir,
  planBuild,
  type Ran,
  type RunInImage,
  readImageSources,
} from "./build.ts"
export {
  ensureGvproxy,
  type GvproxyPin,
  gvproxyPath,
  readGvproxyPin,
} from "./gvproxy.ts"
export { type Endable, type Kept, keepLease } from "./keep.ts"
export { buildLauncher, gatherLauncher, launcherName } from "./launcher.ts"
export {
  type Lease,
  launcherWords,
  leaseVm,
  VmRefused,
  vmProblem,
} from "./lease.ts"
export {
  GVPROXY_HOST_ADDRESS,
  IMAGE_FILES,
  IMAGE_OUTPUTS,
  type ImageSources,
  imageDir,
  imageKey,
  imageRefusal,
  parseSums,
  planShares,
  planVm,
  planVmVersion,
  SHARES_ROOT,
  staleVmWords,
  type VmFacts,
  type VmPlan,
  type VmRefusal,
  type VmVersion,
  vmMemory,
  vmStateDir,
  vmWords,
} from "./plan.ts"
export * from "./protocol.ts"
