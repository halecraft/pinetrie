// host/invocation — `pnpm dev [folder]` and `pnpm serve [folder]`: which
// project a host serves, where its session is kept, and the words for a
// refusal.

import path from "node:path"
import { TIDY_DAYS } from "@pinetrie/jj"
import { type ProjectDirRefusal, projectDirWords } from "@pinetrie/lanes"

/** Why the host does not start. */
export type Refusal =
  | { readonly kind: "flag"; readonly arg: string }
  | { readonly kind: "extra"; readonly args: readonly string[] }
  | { readonly kind: "project"; readonly refusal: ProjectDirRefusal }

type Invocation =
  | { readonly kind: "start"; readonly folder: string }
  | { readonly kind: "refused"; readonly refusal: Refusal }

/**
 * The folder the host serves: `base` without an argument, else the one
 * named, a relative one read from `base`. `args` are the command's own;
 * `base` is `INIT_CWD`, else the working directory. pnpm sets `INIT_CWD` to
 * the directory pnpm was started in, and runs the app's scripts from the
 * app's own.
 */
export function planInvocation(
  args: readonly string[],
  base: string,
): Invocation {
  const flag = args.find(a => a.startsWith("-"))
  if (flag !== undefined)
    return { kind: "refused", refusal: { kind: "flag", arg: flag } }
  const [folder, ...extra] = args
  if (extra.length > 0)
    return { kind: "refused", refusal: { kind: "extra", args } }
  return { kind: "start", folder: invokedFolder(folder, base) }
}

/** The folder a command names: `base` without one, else the one named, a relative one read from `base`. */
const invokedFolder = (arg: string | undefined, base: string): string =>
  arg === undefined ? base : path.resolve(base, arg)

/** `pnpm tidy [folder] [--days N] [--dry-run]`: what to tidy, and how. */
type TidyInvocation =
  | {
      readonly kind: "tidy"
      readonly folder: string
      /** The window kept: the last `days` days of operations. */
      readonly days: number
      /** Say what would be done, and do nothing. */
      readonly dryRun: boolean
    }
  | { readonly kind: "refused"; readonly why: string }

/** `pnpm tidy`'s arguments, its folder read as `planInvocation` reads one. */
export function planTidyInvocation(
  args: readonly string[],
  base: string,
): TidyInvocation {
  const folders: string[] = []
  let days = TIDY_DAYS
  let dryRun = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? ""
    if (arg === "--dry-run") dryRun = true
    else if (arg === "--days") {
      const n = Number(args[i + 1])
      if (!Number.isInteger(n) || n < 1)
        return {
          kind: "refused",
          why: "--days takes a whole number of days, 1 or more",
        }
      days = n
      i += 1
    } else if (arg.startsWith("-"))
      return { kind: "refused", why: `${arg}: not an option of tidy` }
    else folders.push(arg)
  }
  if (folders.length > 1)
    return {
      kind: "refused",
      why: `one folder, not ${folders.length}: ${folders.join(" ")}`,
    }
  return {
    kind: "tidy",
    folder: invokedFolder(folders[0], base),
    days,
    dryRun,
  }
}

/** `tidy`'s usage line. */
export const TIDY_USAGE =
  "usage: pinetrie tidy [folder] [--days N] [--dry-run]  (the current folder when none is named)"

/** The session's SQLite file, and what named it. */
export interface StoreChoice {
  readonly file: string
  readonly from: "PINETRIE_STORE" | "session"
}

/**
 * The session's SQLite file: `PINETRIE_STORE` when set, else `own`, the one
 * in the session's data directory (`sessionFiles`).
 */
export function storeChoice(
  own: string,
  env: Readonly<Record<string, string | undefined>>,
): StoreChoice {
  const given = env.PINETRIE_STORE
  return given === undefined
    ? { file: own, from: "session" }
    : { file: given, from: "PINETRIE_STORE" }
}

/** The command that starts a host: through Vite, or serving the built page. */
export type HostCommand = "dev" | "serve"

const usage = (command: HostCommand) =>
  `usage: ${command === "dev" ? "pnpm dev" : "pinetrie serve"} [folder]  (the current folder when none is named)`

/** A refusal's words, with `command`'s usage line. */
export function refusalText(r: Refusal, command: HostCommand): string {
  switch (r.kind) {
    case "flag":
      return `${r.arg}: the host takes no options; its settings are PINETRIE_* variables\n${usage(command)}`
    case "extra":
      return `one folder, not ${r.args.length}: ${r.args.join(" ")}\n${usage(command)}`
    case "project":
      return `${projectDirWords(r.refusal)}\n${usage(command)}`
  }
}
