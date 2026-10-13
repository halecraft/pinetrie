// pi/lane-protocol — the calls between the host and a lane's helper,
// carried by `@pinetrie/channel`.

import type { Recipe } from "@pinetrie/core"

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
      /** Its input; null for none. */
      readonly stdin: string | null
    }
  /** What the helper knows of its runs and tools since the last drain: a `LaneDrain`. */
  | { readonly runs: true }
  /** Which of these paths, relative to the helper's directory, exist: a `string[]`. */
  | { readonly present: readonly string[] }
  /** Content hashes of paths relative to the helper's directory: a `FileHashes`. */
  | { readonly hashes: readonly string[] }
  /**
   * Of these paths, relative to the helper's directory, each that runs
   * through a symlink, and the first symlink on its way: a record.
   */
  | { readonly firstSymlinks: readonly string[] }
  /** Whether each recipe's key still holds on the disk: a `RecipeCheck` each. */
  | { readonly checkRecipes: readonly Recipe[] }
  /**
   * Serve the machine's observer to a host inside the lane, at
   * `OBSERVER_SOCKET`, until aborted: its updates are `RelayRequest`s, each
   * answered by an `observerReply` call.
   */
  | { readonly observerRelay: true }
  | { readonly observerReply: RelayReply }

/**
 * What the helper asks of its host for a connection of the observer's
 * socket: open it, carry one of its calls, abort one, or end it. Calls and
 * their values are the observer's own, unread here.
 */
export type RelayRequest =
  | { readonly connection: number; readonly open: true }
  | {
      readonly connection: number
      readonly call: number
      readonly body: unknown
    }
  | { readonly connection: number; readonly abort: number }
  | { readonly connection: number; readonly closed: true }

/** The host's answer to a `RelayRequest`. */
export type RelayReply =
  | { readonly connection: number; readonly hello: unknown }
  | {
      readonly connection: number
      readonly call: number
      readonly update: unknown
    }
  | {
      readonly connection: number
      readonly call: number
      readonly result: unknown
    }
  | {
      readonly connection: number
      readonly call: number
      readonly thrown: string
    }

/** The helper's hello: its directory, and its shared directories, absolute, as the host registers the lane with them. */
export interface LaneHello {
  readonly cwd: string
  readonly shared: readonly string[]
}
