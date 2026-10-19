// lanes/project-dir — a project's root and its kind, from what the host
// finds at its folder, or why lanes cannot serve it.

import path from "node:path"
import type { ProjectKind } from "@pinetrie/core"

/** What the file system, jj and git say about a project's folder. */
export interface RootFacts {
  readonly dir: string
  /** Whether `dir` is a directory; jj and git are asked only when it is. */
  readonly isDirectory: boolean
  /** The jj workspace root jj names from `dir`, or null. */
  readonly jjRoot: string | null
  /** git's top level from `dir`, asked only when jj names nothing. */
  readonly gitTop: string | null
  readonly home: string
}

/** Why a folder cannot be a project (`projectDirWords` words it). */
export type ProjectDirRefusal =
  /** Missing, or not a directory. */
  | { readonly kind: "missing"; readonly dir: string }
  /** Your home directory or `/`. */
  | { readonly kind: "unsafe"; readonly root: string }
  /** A jj repo with no git directory beside it, which lanes' history is fetched through. */
  | { readonly kind: "not-colocated"; readonly root: string }

/** A project's root and its kind, or why the folder cannot be one. */
export type ProjectDir =
  | {
      [K in ProjectKind]: { readonly kind: K; readonly root: string }
    }[ProjectKind]
  | { readonly kind: "refused"; readonly refusal: ProjectDirRefusal }

/**
 * The project's root: jj's, else git's, else the folder. Never your home
 * directory or `/`: a home directory that is a dotfiles repo is what git
 * names for any project below it with no repo of its own.
 */
export function planProjectDir(f: RootFacts): ProjectDir {
  if (!f.isDirectory)
    return { kind: "refused", refusal: { kind: "missing", dir: f.dir } }
  const root = f.jjRoot ?? f.gitTop ?? f.dir
  if (
    path.resolve(root) === path.resolve(f.home) ||
    path.resolve(root) === path.parse(root).root
  )
    return { kind: "refused", refusal: { kind: "unsafe", root } }
  return { kind: f.jjRoot !== null ? "jj" : "folder", root }
}

/** A refusal's words, for the log, `ProjectRecord.reason` and the command line. */
export function projectDirWords(r: ProjectDirRefusal): string {
  switch (r.kind) {
    case "missing":
      return `${r.dir} is not a directory`
    case "unsafe":
      return `${r.root} is your home directory or the file system's root`
    case "not-colocated":
      return `${r.root} has no git directory beside its jj repo, and lanes' work reaches your repo through git: \`jj git init --colocate\` makes one`
  }
}

/**
 * Your repo's exclude file with each of `lines` in it, appended in order, or
 * null when they are all there already. Shared directories are added as
 * `/<path>/`.
 */
export function planExclude(
  current: string,
  lines: readonly string[],
): string | null {
  const have = new Set(current.split("\n").map(l => l.trim()))
  const missing = lines.filter(l => !have.has(l))
  if (missing.length === 0) return null
  const base =
    current === "" || current.endsWith("\n") ? current : `${current}\n`
  return `${base}${missing.map(l => `${l}\n`).join("")}`
}
