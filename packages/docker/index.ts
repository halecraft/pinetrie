// docker — Docker as a lane runtime (ADR-0103): one code path for the Mac,
// through the lane VM's launcher, and for Linux.

export { gatherDockerHost } from "./facts.ts"
export {
  DISKS_CONTAINER,
  type DockerHostFacts,
  type DockerRefusal,
  dockerWords,
  INNER_DOCKER_HOST,
  NESTED_MOUNT,
  planDockerHost,
  projectDisks,
  projectKey,
  ROOTLESS_UID,
  SLOT_LABEL,
} from "./plan.ts"
export { type DockerRuntime, dockerRuntime, sweepSlot } from "./runtime.ts"
export type { DockerTarget } from "./target.ts"
