// lanes/container — Apple's `container` as a lane runtime (ADR-0034).

export { prepareContainerHost } from "./facts.ts"
export { createVolume, type DiskPaths } from "./plan.ts"
export { containerRuntime } from "./runtime.ts"
