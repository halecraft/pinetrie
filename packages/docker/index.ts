// docker — Docker as a lane runtime (ADR-0130): one code path for the Mac,
// through the lane VM's launcher, and for Linux.

export { projectDisks, ROOTLESS_UID } from "@pinetrie/lanehost"
export { gatherDockerHost } from "./facts.ts"
export {
  type DockerHostFacts,
  type DockerRefusal,
  dockerWords,
  INNER_DOCKER_HOST,
  LANEHOST_LABEL,
  NESTED_MOUNT,
  planDockerHost,
  projectKey,
  SLOT_LABEL,
} from "./plan.ts"
export { type DockerRuntime, dockerRuntime, sweepSlot } from "./runtime.ts"
export type { DockerTarget } from "./target.ts"
