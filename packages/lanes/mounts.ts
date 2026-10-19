// lanes/mounts — every host path a lane sees, in one list: the working copy,
// pine·trie's install and runtime, shared directories, and granted host
// paths; and what a host shares into its slot of the lane VM.

import path from "node:path"
import {
  HOST_WORKING_COPY,
  hostPathInLane,
  isWithin,
  WORKSPACE_ROOT,
} from "@pinetrie/core"
import { PINETRIE_MOUNT } from "@pinetrie/install"
import { IGNORE_MOUNT, type SharedDir } from "./shape.ts"
import { type Mount, RUNTIME_MOUNT } from "./spec.ts"

/**
 * Where a folder lane sees its states directory, read-only: `start`, the state
 * its proposed changes are computed against, and each open conflict's versions.
 */
export const STATES_MOUNT = "/pinetrie-states"

/**
 * Every mount a lane gets, in one list:
 * - your working copy, read-only at `/mnt/host-working-copy`;
 * - pinetrie's own install at `/pinetrie` and its runtime at `/pinetrie-runtime`,
 *   and the directory of the lane's ignore file at `/pinetrie-git`, read-only;
 * - links' and grants' mounts, read-only where they say;
 * - shared directories, read-write at their place in `/workspace`;
 * - granted host paths, read-only at `/mnt/host` and their path.
 */
export function planMounts(parts: {
  readonly hostWorkingCopy: string
  readonly pinetrie: string
  readonly runtime: string
  readonly ignoreDir: string
  readonly links: readonly Mount[]
  readonly grants: readonly Mount[]
  readonly shared: readonly SharedDir[]
  readonly hostPaths: readonly string[]
}): readonly Mount[] {
  const at = (source: string, target: string): Mount => ({
    source,
    target,
    readonly: true,
  })
  return [
    at(parts.hostWorkingCopy, HOST_WORKING_COPY),
    at(parts.pinetrie, PINETRIE_MOUNT),
    at(parts.runtime, RUNTIME_MOUNT),
    at(parts.ignoreDir, IGNORE_MOUNT),
    ...parts.links,
    ...parts.grants,
    ...sharedMounts(parts.shared),
    ...parts.hostPaths.map(p => at(p, hostPathInLane(p))),
  ]
}

/** Shared directories, read-write at their place in `/workspace`. */
const sharedMounts = (shared: readonly SharedDir[]): readonly Mount[] =>
  shared.map(d => ({
    source: d.source,
    target: path.posix.join(WORKSPACE_ROOT, d.path),
    readonly: false,
  }))

/**
 * Every host directory a lane of this host may mount, as the Mac's lane VM
 * shares them into its slots: the base lane's mounts, which carry no shared
 * directory, every shared directory any lane may mount, and what a lane's
 * ssh attaches. A lane that mounts one left out cannot be made.
 */
export const slotMounts = (input: {
  readonly base: readonly Mount[]
  readonly shared: readonly SharedDir[]
  readonly attached: readonly Mount[]
}): readonly Mount[] => [
  ...input.base,
  ...sharedMounts(input.shared),
  ...input.attached,
]

/**
 * Which host paths a lane is granted, read-only: the roots a
 * command's files live in. Nested roots collapse into the outermost. A root
 * that is, or holds, your home directory, `/` or one of pine·trie's own
 * directories (`own`: credentials, service keys, sessions) is refused. A
 * root inside one of those, such as a skill folder in pine·trie's config,
 * is not: it lies inside, and does not hold it. A root inside the project
 * (`project`) is left out, neither mounted nor refused: each lane has its
 * own copy of the project.
 */
export function planHostMounts(input: {
  readonly roots: readonly string[]
  /** The project's folder; null for none. */
  readonly project: string | null
  readonly home: string
  readonly own: readonly string[]
}): {
  readonly mounts: readonly string[]
  readonly refused: readonly {
    readonly path: string
    readonly reason: string
  }[]
} {
  const refused: { path: string; reason: string }[] = []
  const allowed: string[] = []
  const { project } = input
  const outside = input.roots
    .map(r => path.resolve(r))
    .filter(r => project === null || !isWithin(r, project))
  for (const root of new Set(outside)) {
    const reason =
      root === "/"
        ? "it is the file system's root"
        : isWithin(input.home, root)
          ? "it is, or holds, your home directory"
          : input.own.some(d => isWithin(d, root))
            ? "it is, or holds, one of pine·trie's own directories"
            : null
    if (reason === null) allowed.push(root)
    else refused.push({ path: root, reason })
  }
  const mounts = allowed
    .filter(r => !allowed.some(o => o !== r && isWithin(r, o)))
    .sort()
  return { mounts, refused }
}
