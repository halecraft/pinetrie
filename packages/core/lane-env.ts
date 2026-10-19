// core/lane-env — what every lane of its own sees: its paths, its home, the
// host paths granted to it, the programs it carries, and the variables its
// shell runs with.

import { isWithin } from "./paths.ts"

/**
 * What stops an editor from opening, for jj and for a lane's shell: a shell
 * with no terminal would wait on one until its timeout. With these, a command
 * that wants one fails at once.
 */
export const NO_EDITOR = {
  JJ_EDITOR: "false",
  VISUAL: "false",
  EDITOR: "false",
} as const

/** Where every lane of its own sees its own directory. */
export const WORKSPACE_ROOT = "/workspace"
/** Where every lane of its own sees your working copy, read-only. */
export const HOST_WORKING_COPY = "/mnt/host-working-copy"

/**
 * A lane's home directory: on its disk, so what tools keep there (caches,
 * config) persists and travels with forks; under `.pinetrie-lane`, so it is
 * pine·trie's own and never committed.
 */
export const LANE_HOME_PATH = ".pinetrie-lane/home"
/** The lane's home, absolute. */
export const LANE_HOME = `${WORKSPACE_ROOT}/${LANE_HOME_PATH}`

/** The variable listing a lane's shared directories, absolute, one per line. */
export const SHARED_ENV = "PINETRIE_SHARED"

/**
 * The programs the lane runtime carries into every lane of its own, on its
 * `PATH` whatever the image. Each must be a static build in pinetrie's default
 * image, which the runtime is copied out of.
 */
export const RUNTIME_PROGRAMS = ["jj", "rg", "fd", "sd"] as const
export type RuntimeProgram = (typeof RUNTIME_PROGRAMS)[number]

/** `s` as one POSIX shell word. */
export const shellWord = (s: string): string =>
  /^[A-Za-z0-9_./:=@+-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`

/**
 * Where every lane of its own sees host paths it is granted: `HOST_MOUNT` and
 * then the host path. One rule, so no granted path can shadow a directory of
 * the image's.
 */
const HOST_MOUNT = "/mnt/host"

/** A host path, as a lane of its own sees it. */
export const hostPathInLane = (hostPath: string): string =>
  `${HOST_MOUNT}${hostPath}`

/**
 * Where a lane reads a skill's file: in its own copy of the project for one
 * inside `project`, else at its host path under `HOST_MOUNT`. A project's
 * skills are never mounted from the host: the lane has them already.
 */
export const laneSkillPath = (file: string, project: string | null): string =>
  project !== null && isWithin(file, project)
    ? `${WORKSPACE_ROOT}${file.slice(project.replace(/\/$/, "").length)}`
    : hostPathInLane(file)
