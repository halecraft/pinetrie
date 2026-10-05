// host/invocation — `pnpm host [folder]` (ADR-0086): which project a host
// serves, where its session is kept, and the words for a refusal.

import path from "node:path"
import { PRODUCT_NAME } from "@pinetrie/core"
import {
  type ProjectDirRefusal,
  pinetrieDir,
  projectDirWords,
} from "@pinetrie/lanes"

/** Why the host does not start. */
export type Refusal =
  | { readonly kind: "flag"; readonly arg: string }
  | { readonly kind: "extra"; readonly args: readonly string[] }
  | { readonly kind: "project"; readonly refusal: ProjectDirRefusal }

export type Invocation =
  | { readonly kind: "start"; readonly folder: string }
  | { readonly kind: "refused"; readonly refusal: Refusal }

/**
 * The folder the host serves: pinetrie's own repo without an argument, else
 * the one named, a relative one read from `base`. `args` is
 * `process.argv.slice(2)`; `base` is `INIT_CWD`, else the working directory.
 * pnpm sets `INIT_CWD` to pinetrie's root, not the shell's directory (S108).
 */
export function planInvocation(
  args: readonly string[],
  base: string,
  pinetrieRoot: string,
): Invocation {
  const flag = args.find(a => a.startsWith("-"))
  if (flag !== undefined)
    return { kind: "refused", refusal: { kind: "flag", arg: flag } }
  const [folder, ...extra] = args
  if (extra.length > 0)
    return { kind: "refused", refusal: { kind: "extra", args } }
  return {
    kind: "start",
    folder: folder === undefined ? pinetrieRoot : path.resolve(base, folder),
  }
}

/** The session's SQLite file: `PINETRIE_STORE` when set, else in the project. */
export function storeFile(
  root: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  return env.PINETRIE_STORE ?? pinetrieDir(root).store
}

const USAGE = `usage: pnpm host [folder]  (a relative folder is read from ${PRODUCT_NAME}'s root)`

/** A refusal's words, with the usage line. */
export function refusalText(r: Refusal): string {
  switch (r.kind) {
    case "flag":
      return `${r.arg}: the host takes no options; its settings are PINETRIE_* variables\n${USAGE}`
    case "extra":
      return `one folder, not ${r.args.length}: ${r.args.join(" ")}\n${USAGE}`
    case "project":
      return `${projectDirWords(r.refusal)}\n${USAGE}`
  }
}
