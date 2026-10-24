// docker — Docker as a lane runtime: one code path for the Mac,
// through the lane VM's launcher, and for Linux.

export {
  dockerCgroupDriver,
  dockerRootless,
  gatherDockerHost,
} from "./facts.ts"
export {
  CONTAINER_LIMITS,
  type ContainerKind,
  type ContainerLimits,
  cpuWeightOfShares,
  type DockerHostFacts,
  type DockerRefusal,
  dockerWords,
  HOST_CGROUP,
  INNER_DOCKER_HOST,
  LANEHOST_LABEL,
  NESTED_DISK,
  NESTED_MOUNT,
  planDockerHost,
  projectKey,
  ROOTLESS_UID,
  type RunningLane,
  type RunningService,
  SERVICE_MEMORY,
  SLOT_LABEL,
  servicesFloorBytes,
  wantedControls,
} from "./plan.ts"
export {
  type DockerRuntime,
  dockerRuntime,
  type ServiceKillWatch,
  stopSlot,
} from "./runtime.ts"
export type { DockerTarget } from "./target.ts"
