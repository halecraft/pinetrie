// core/config — pine·trie's config as other packages read it: its layers, a
// file's state, what a file wrote that was not taken, and where a settled
// value came from. What a setting is, is `@pinetrie/config`'s.

/**
 * What a project's folder is to lanes: a jj workspace, whose repo is
 * accepted work, or any other folder (a git repo included).
 */
export type ProjectKind = "jj" | "folder"

/**
 * Where a setting can be written, broadest first: the machine's file, the
 * person's, the project's `pinetrie.json`, the person's for one project,
 * and the environment.
 */
export type ConfigLayer = "system" | "user" | "project" | "local" | "env"

export const CONFIG_LAYERS: readonly ConfigLayer[] = [
  "system",
  "user",
  "project",
  "local",
  "env",
]

/**
 * How pine·trie uses your repo: accepted work's bookmark, the WIP bookmarks'
 * prefix, the bookmark publishing moves to accepted work, and whether a
 * publish catches the working copy up and accepts your commits first.
 */
export interface RepoConfig {
  readonly acceptedBookmark: string
  readonly wipPrefix: string
  readonly publish: string
  readonly publishCatchesUp: boolean
}

/** A layer's file: read, absent, or refused whole. */
export const CONFIG_FILE_STATES = ["read", "missing", "broken"] as const
export type ConfigFileState = (typeof CONFIG_FILE_STATES)[number]

/** Why a key a file wrote was not taken. */
export const REFUSAL_REASONS = [
  "unknown",
  "not-here",
  "malformed",
  "broken",
] as const

/** A key a layer's file wrote that was not taken, and why. */
export interface ConfigRefusal {
  readonly layer: ConfigLayer
  /** The file, or for `env` the variable. */
  readonly file: string
  /** The dotted key; empty for a file refused whole. */
  readonly key: string
  readonly why: (typeof REFUSAL_REASONS)[number]
  /** What the setting's kind said, or why the file could not be read or parsed. */
  readonly detail: string
}

/** Where a settled value came from. */
export type ConfigOrigin =
  | { readonly kind: "fallback" }
  | {
      readonly kind: "file"
      readonly layer: ConfigLayer
      readonly file: string
    }
  | { readonly kind: "env"; readonly name: string }

/** A project's config, at its repo's root. */
export const PROJECT_CONFIG_FILE = "pinetrie.json"
