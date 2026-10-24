// machine/containment — what took effect of the controls each container
// was made with, from what was wanted and what the cgroups say. Docker's
// answer is no proof: a Docker with no cgroup driver (a nested lane's)
// shows every limit asked for and applies none. The OOM priority is not
// read back: the disks role reads cgroups, not processes.

import {
  CONTAINMENT_CONTROLS,
  type Containment,
  type ContainmentControl,
  type ControlsReadBack,
} from "@pinetrie/core"

/** What one running container should read back, and what it does. */
export interface ContainerWanted {
  readonly processesMax: number
  /** The CPU weight its share is read back as; null for the default share, which proves nothing. */
  readonly expectedCpuWeight: number | null
  readonly readBack: ControlsReadBack
}

/**
 * What took effect, from what was wanted and what the cgroups say. Made
 * only here. A lane's default share reads the same applied or not, so it
 * is not judged: lanes are judged by their process limit, the services by
 * both.
 */
export function planContainment(input: {
  readonly wanted: {
    /** Each running container's. */
    readonly containers: readonly ContainerWanted[]
    /** The services' floor, or null where this host keeps none. */
    readonly servicesFloor: number | null
  }
  readonly servicesFloorReadBack: number | null
  /** Docker's `CgroupDriver`; null where it could not be read. */
  readonly cgroupDriver: string | null
}): Containment {
  const { wanted } = input
  if (input.cgroupDriver === "none")
    return {
      kind: "not-contained",
      missing: CONTAINMENT_CONTROLS,
      why: "no-cgroup-driver",
    }
  const missed: Readonly<Record<ContainmentControl, boolean>> = {
    processes: wanted.containers.some(
      c => c.readBack.processesMax !== c.processesMax,
    ),
    "cpu-weight": wanted.containers.some(
      c =>
        c.expectedCpuWeight !== null &&
        c.readBack.cpuWeight !== c.expectedCpuWeight,
    ),
    "services-floor":
      wanted.servicesFloor !== null &&
      input.servicesFloorReadBack !== wanted.servicesFloor,
  }
  const missing = CONTAINMENT_CONTROLS.filter(c => missed[c])
  return missing.length === 0
    ? { kind: "contained" }
    : { kind: "not-contained", missing, why: "not-read-back" }
}
