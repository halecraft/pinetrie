// pi/lane-protocol — the calls between the host and a lane's helper,
// carried by `@pinetrie/channel`.

/**
 * The environment methods a lane forwards: those whose arguments and result
 * are data. `openTextLineReader` returns an object with methods, and
 * `cleanup` is the host's own, so neither crosses. pi's four tools use eight
 * of these, and the search tools `exec` alone.
 */
export const ENV_METHODS = [
  "absolutePath",
  "joinPath",
  "readTextFile",
  "readTextLines",
  "readBinaryFile",
  "writeFile",
  "appendFile",
  "renameFile",
  "fileInfo",
  "listDir",
  "canonicalPath",
  "exists",
  "createDir",
  "remove",
  "createTempDir",
  "createTempFile",
  "exec",
] as const

export type EnvMethod = (typeof ENV_METHODS)[number]

const METHODS: ReadonlySet<string> = new Set(ENV_METHODS)
export const isEnvMethod = (name: string): name is EnvMethod =>
  METHODS.has(name)

export type LaneCall =
  /** An environment call; its `Context` is the helper's own. */
  | { readonly method: EnvMethod; readonly args: readonly unknown[] }
  /** A command with no shell, for the host's own jj and git (`laneRunner`). */
  | {
      readonly run: readonly string[]
      /** Defaults to the helper's directory, `/workspace`. */
      readonly cwd: string | null
      /** stdout as bytes, for a bundle; else text. */
      readonly bytes: boolean
    }

/** The helper's hello: its directory. */
export interface LaneHello {
  readonly cwd: string
}
