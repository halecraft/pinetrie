// lanes — what a lane is and what runs in it: its container's shape, its
// mounts and grants, its disk, forks and snapshots, and the ports a kind of
// project implements (`history-port.ts`). It runs on whichever `LaneRuntime`
// the host hands in, and implements none; it runs no jj. jj's side of a lane
// and your repo are `@pinetrie/jj`'s, which builds on this package.

export { refreshBase } from "./base.ts"
export { REGISTRY_FILE } from "./base-facts.ts"
export {
  executeFork,
  executeOrThrow,
  type Forked,
  type LaneRunners,
} from "./execute.ts"
export type { FolderDisks } from "./folder-disks-port.ts"
export { type ForkSteps, OLD_LANE_CONFIG_DIR, planFork } from "./fork.ts"
export {
  type AcceptedNow,
  baseCheckout,
  type Edits,
  type FileAt,
  type Follow,
  forkSetup,
  type LaneHistory,
  type MergedOf,
  type ReadSite,
  recordedStart,
  type StartRecords,
  type TouchedRevision,
  type TurnCommitted,
  type TurnCommittedOf,
} from "./history-port.ts"
export { gatherLinks } from "./host.ts"
export { checkImage, prepareImages, projectContainerfile } from "./image.ts"
export type { ImagePlan } from "./image-plan.ts"
export {
  createQueue,
  helperCommand,
  type LaneHandle,
  type LaneQueue,
  laneHandle,
  laneNote,
  nestedLaneDockerNote,
  type OpenLink,
  removeLane,
} from "./lane.ts"
export {
  configChangeNote,
  configWidenings,
  DEFAULT_VM_SLOTS,
  effectiveLaneConfig,
  isEnvName,
  type LaneAuthority,
  MAX_VM_SLOTS,
  parseMount,
  parsePort,
} from "./lane-config.ts"
export {
  planHostMounts,
  planMounts,
  STATES_MOUNT,
  slotMounts,
} from "./mounts.ts"
export {
  type InnerDockerDataRootSource,
  innerDockerDataRootsAfterClone,
  innerDockerDataRootsAfterRunEnd,
  NO_INNER_DOCKER_DATA_ROOTS,
  planInnerDockerDataRootSource,
} from "./nested-data-root.ts"
export {
  type ProjectDir,
  type ProjectDirRefusal,
  planExclude,
  planProjectDir,
  projectDirWords,
  type RootFacts,
} from "./project-dir.ts"
export {
  describeFailure,
  hostBytesRunner,
  hostRunner,
  lines,
  type Ran,
  type Runner,
  run,
} from "./run.ts"
export { ensureRuntime, RUNTIME_NODE } from "./runtime.ts"
export type {
  ContainerFacts,
  DiskOp,
  ImageBuild,
  LaneDisks,
  LaneRuntime,
  Observer,
  Served,
} from "./runtime-port.ts"
export {
  type LaneFiles,
  type SessionFiles,
  sessionFiles,
} from "./session-files.ts"
export {
  type ContainerShape,
  type DiskBind,
  diskBinds,
  IGNORE_FILE,
  LANE_GITCONFIG,
  laneGitConfig,
  laneIgnores,
  planShape,
  type SharedDir,
  SPEC_LABEL,
  specHash,
} from "./shape.ts"
export {
  normalShared,
  planLinks,
  planShared,
  sharedCandidates,
} from "./shared.ts"
export {
  baseLane,
  LANE_CONFIG_DIR,
  LANE_JJ_CONFIG,
  type LaneAttached,
  type LaneGrants,
  type LaneOwner,
  type LaneSpec,
  laneContainer,
  type Mount,
  NO_GRANTS,
  NOTHING_ATTACHED,
  RUNTIME_BIN,
  RUNTIME_MOUNT,
  RUNTIME_SHELL_PATH,
} from "./spec.ts"
export {
  decideContainerStart,
  type LaneFactReader,
  planContainer,
} from "./start.ts"
export {
  inLane,
  KILL_SSH,
  type LaneStep,
  laneShell,
  planSnapshot,
  type Step,
} from "./steps.ts"
