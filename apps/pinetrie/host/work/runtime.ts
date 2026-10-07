// host/work/runtime — the one place that picks the runtime lanes run on
// (ADR-0103): what the host found where it runs, and the `LaneRuntime` that
// lanes of their own get. Everything after it takes the runtime as given.

import type { ProjectRecord } from "@pinetrie/core"
import {
  containerRuntime,
  type LaneRuntime,
  prepareContainerHost,
} from "@pinetrie/lanes"

/** What the host found where it runs: the project, and its lanes' runtime when they have their own. */
export interface Found {
  readonly project: ProjectRecord
  readonly runtime: LaneRuntime | null
  /**
   * Give the runtime pinetrie's default image, once built: `container` trims
   * a stopped lane's disk with it. Called once, by setup.
   */
  readonly defaultImage: (tag: Promise<string>) => void
}

/**
 * The project as the host keeps it. `PINETRIE_LANES=0` (`defaultDirect`)
 * changes a new root lane's default, never whether a lane may have its own
 * copy. Pure.
 */
export function projectOf(
  found: Pick<Found, "project"> | null,
  defaultDirect: boolean,
): ProjectRecord | null {
  if (found === null) return null
  const { project } = found
  return project.kind === "lanes" && defaultDirect
    ? { ...project, rootDefault: "direct" }
    : project
}

/**
 * Find the project in `dir`, and whether its lanes can have their own copies:
 * `prepareContainerHost` asks `container`, unless containers are off. Null
 * with no tools (`dir` null). Read before pi's setup, which loads from its
 * root.
 */
export async function findProject(input: {
  /** The project's folder, whose root is found from it; null with no tools. */
  readonly dir: string | null
  /** `PINETRIE_LANES=0`: a new root lane works directly by default. */
  readonly defaultDirect: boolean
  /** False: lanes never get containers here, and `container` is not asked. */
  readonly containers: boolean
}): Promise<Found | null> {
  if (input.dir === null) return null
  const found: Found = input.containers
    ? await containerFound(input.dir)
    : {
        project: {
          kind: "direct",
          root: input.dir,
          reason: "lanes of their own are off for this host",
        },
        runtime: null,
        defaultImage: () => {},
      }
  const project = projectOf(found, input.defaultDirect)
  return project === null ? null : { ...found, project }
}

async function containerFound(dir: string): Promise<Found> {
  const { project, paths } = await prepareContainerHost(dir)
  if (paths === null) return { project, runtime: null, defaultImage: () => {} }
  const tools = Promise.withResolvers<string>()
  // A failed build is reported where setup awaits it; trimming then fails too.
  tools.promise.catch(() => {})
  return {
    project,
    runtime: containerRuntime({ paths, trimImage: () => tools.promise }),
    defaultImage: tag => {
      tag.then(tools.resolve, tools.reject)
    },
  }
}
