// lanes/project-dir — a project's root and its kind, from what the host
// finds at its folder, or why lanes cannot serve it. Version control is
// served through jj: a folder under jj or git needs jj, and git beside it;
// a folder under neither runs with no jj installed.

import path from "node:path"
import { PRODUCT_NAME, type ProjectKind } from "@pinetrie/core"
import { lines, type Ran } from "./run.ts"

/** What jj said, asked from a folder where its workspace's root is. */
type JjRootAnswer =
  | { readonly kind: "root"; readonly root: string }
  | { readonly kind: "no-repo" }
  | { readonly kind: "failed"; readonly said: string }

/** What the file system, jj and git say about a project's folder. */
export interface RootFacts {
  readonly dir: string
  /** Whether `dir` is a directory; jj and git are asked only when it is. */
  readonly isDirectory: boolean
  readonly home: string
  /** The host jj's version, or null when jj does not run. */
  readonly jjVersion: string | null
  /** jj's answer from `dir`; null when jj does not run. */
  readonly jj: JjRootAnswer | null
  /** Whether git runs (`git --version`). */
  readonly git: boolean
  /** git's top level from `dir`, asked only when jj names no root. */
  readonly gitTop: string | null
  /** Whether a git directory is found from jj's root, asked only when jj names one. */
  readonly gitBesideJj: boolean
  /**
   * The nearest `.jj` or `.git` in `dir` or above it, looked for only when
   * jj or git does not run. It says only that version control is there:
   * where its root is, only jj and git say.
   */
  readonly vcsMarker: string | null
}

/** Why a folder cannot be a project (`projectDirWords` words it). */
export type ProjectDirRefusal =
  /** Missing, or not a directory. */
  | { readonly kind: "missing"; readonly dir: string }
  /** Your home directory or `/`. */
  | { readonly kind: "unsafe"; readonly root: string }
  /** A jj repo with no git directory beside it, which lanes' history is fetched through. */
  | { readonly kind: "not-colocated"; readonly root: string }
  /** Under version control (`marker`), and jj does not run. */
  | { readonly kind: "jj-missing"; readonly marker: string }
  /** jj could not say where the folder's repo is. */
  | { readonly kind: "jj-failed"; readonly dir: string; readonly said: string }
  /** A jj or git project, and git does not run. */
  | { readonly kind: "git-missing"; readonly root: string }
  /** A git repo `jj git init --colocate` refused, a git worktree among them. */
  | {
      readonly kind: "colocate-failed"
      readonly root: string
      readonly said: string
    }

/** A project's root and its kind, or why the folder cannot be one. */
export type ProjectDir =
  | {
      [K in ProjectKind]: { readonly kind: K; readonly root: string }
    }[ProjectKind]
  | { readonly kind: "refused"; readonly refusal: ProjectDirRefusal }

/**
 * What a start does with its project's folder: a `ProjectDir`, with what
 * must happen before it is one. A git repo with no jj is made colocated
 * (`colocate`); a folder project on a host with no jj is said so
 * (`jjMissing`).
 */
export type ProjectPlan =
  | { readonly kind: "jj"; readonly root: string; readonly colocate: boolean }
  | {
      readonly kind: "folder"
      readonly root: string
      readonly jjMissing: boolean
    }
  | Extract<ProjectDir, { readonly kind: "refused" }>

/** The version in jj's answer to `--version`, or null when jj did not run. */
export function parsedJjVersion(ran: Ran): string | null {
  const m = /jj (\d+\.\d+\.\d+)/.exec(ran.stdout)
  return ran.ok && m?.[1] !== undefined ? m[1] : null
}

/**
 * jj's answer to `jj workspace root`. "No repo" is exit 1, as a config
 * error is too, so it is read from jj's message: should jj reword it, a
 * folder in no repo is refused in jj's words rather than read as one.
 */
export function jjRootAnswer(ran: Ran): JjRootAnswer {
  if (ran.ok) return { kind: "root", root: ran.stdout.trim() }
  if (ran.code === 1 && ran.stderr.startsWith("Error: There is no jj repo in"))
    return { kind: "no-repo" }
  return { kind: "failed", said: lines(ran.stderr)[0] ?? `exit ${ran.code}` }
}

/**
 * The project's root: jj's, else git's, else the folder; never your home
 * directory or `/`, since a home directory that is a dotfiles repo is what
 * git names for any project below it with no repo of its own. Without
 * tools, the root alone matters: nothing is refused for jj or git, and
 * nothing is made colocated.
 */
export function planProjectDir(
  f: RootFacts,
  { tools }: { readonly tools: boolean },
): ProjectPlan {
  if (!f.isDirectory)
    return { kind: "refused", refusal: { kind: "missing", dir: f.dir } }
  const jjRoot = f.jj?.kind === "root" ? f.jj.root : null
  if (tools && f.jjVersion === null && f.vcsMarker !== null)
    return {
      kind: "refused",
      refusal: { kind: "jj-missing", marker: f.vcsMarker },
    }
  if (tools && f.jj?.kind === "failed")
    return {
      kind: "refused",
      refusal: { kind: "jj-failed", dir: f.dir, said: f.jj.said },
    }
  const root = jjRoot ?? f.gitTop ?? f.dir
  if (
    path.resolve(root) === path.resolve(f.home) ||
    path.resolve(root) === path.parse(root).root
  )
    return { kind: "refused", refusal: { kind: "unsafe", root } }
  const folder = {
    kind: "folder",
    root,
    jjMissing: f.jjVersion === null,
  } as const
  if (!tools)
    return jjRoot === null ? folder : { kind: "jj", root, colocate: false }
  if (!f.git && (jjRoot !== null || f.gitTop !== null || f.vcsMarker !== null))
    return { kind: "refused", refusal: { kind: "git-missing", root } }
  if (jjRoot !== null)
    return f.gitBesideJj
      ? { kind: "jj", root, colocate: false }
      : { kind: "refused", refusal: { kind: "not-colocated", root } }
  if (f.gitTop !== null) return { kind: "jj", root, colocate: true }
  return folder
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
    case "jj-missing":
      return `${r.marker} puts this folder under version control, which ${PRODUCT_NAME} serves through jj, and jj does not run: install jj (${JJ_INSTALL})`
    case "jj-failed":
      return `jj could not say where ${r.dir}'s repo is: ${r.said}`
    case "git-missing":
      return `${r.root} is under version control, and git does not run: lanes' work reaches your repo through git, so install it (on the Mac, \`xcode-select --install\`)`
    case "colocate-failed":
      return `${r.root} is a git repo jj could not set itself up beside (\`jj git init --colocate\`): ${r.said}`
  }
}

/** What a start says of its project's plan before acting on it, or null. */
export function projectPlanLine(p: ProjectPlan): string | null {
  if (p.kind === "jj" && p.colocate)
    return `${p.root} is a git repo: jj is set up beside git (\`jj git init --colocate\`), and git works as before`
  if (p.kind === "folder" && p.jjMissing)
    return `jj does not run: ${p.root} is served as a folder, and a jj or git repo would be refused until jj is installed (${JJ_INSTALL})`
  return null
}

const JJ_INSTALL = "https://jj-vcs.github.io/jj/latest/install-and-setup/"

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
