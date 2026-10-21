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
 * What the lane runtime carries into every lane of its own, whatever the
 * image, each a static build in pinetrie's default image, which the runtime
 * is copied out of. A `program` is on the lane's `PATH`; the `shell`,
 * pine·trie's bash, is not: it runs the `bash` tool's calls, and a command's
 * own `bash` stays the image's. Every list of the runtime's contents is
 * this table's, so none can name an entry the copy leaves out.
 */
export const RUNTIME_ENTRIES = [
  { kind: "program", name: "jj" },
  { kind: "program", name: "rg" },
  { kind: "program", name: "fd" },
  { kind: "program", name: "sd" },
  { kind: "shell", name: "bash" },
  { kind: "shell", name: "mkfifo" },
] as const
export type RuntimeEntry = (typeof RUNTIME_ENTRIES)[number]
export type RuntimeProgram = Extract<RuntimeEntry, { kind: "program" }>["name"]

/** The runtime's programs, from `RUNTIME_ENTRIES`. */
export const RUNTIME_PROGRAMS: readonly RuntimeProgram[] =
  RUNTIME_ENTRIES.flatMap(e => (e.kind === "program" ? [e.name] : []))

/**
 * Where an entry is under the runtime: a program in `bin/`, on a lane's
 * `PATH`; what runs a `bash` call in `shell/`, off it.
 */
export const runtimeEntryPath = (entry: RuntimeEntry): string =>
  entry.kind === "program" ? `bin/${entry.name}` : `shell/${entry.name}`

/** The runtime's shell, under the runtime. */
export const RUNTIME_SHELL = runtimeEntryPath({ kind: "shell", name: "bash" })

/** The runtime's `mkfifo`, under the runtime: it makes a `bash` call's output pipes. */
export const RUNTIME_MKFIFO = runtimeEntryPath({
  kind: "shell",
  name: "mkfifo",
})

/**
 * What runs a `bash` call, as the lane sees it: pine·trie's bash, and the
 * `mkfifo` that makes its stdout and stderr pipes, which the observer reads.
 */
export interface RuntimeShell {
  readonly bash: string
  readonly mkfifo: string
}

/**
 * The GNU bash the runtime's shell is built from: a release and how many of
 * GNU's official patches to it, which the default image's build takes as
 * arguments, and the agent is told of.
 */
export const RUNTIME_BASH = { version: "5.3", patches: 20 } as const

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
