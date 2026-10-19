// command — `pinetrie <command> [args]`, the command an install puts on the
// PATH: which of its commands an invocation asks for, as a value. `bin.ts`
// carries it out.

import { PRODUCT_NAME } from "@pinetrie/core"

export type CommandName = "serve" | "sign-in" | "sign-out" | "tidy" | "session"

export type PlannedCommand =
  | {
      readonly kind: "run"
      readonly command: CommandName
      readonly args: readonly string[]
    }
  | { readonly kind: "version" }
  | { readonly kind: "help" }
  | { readonly kind: "refused"; readonly named: string }

const COMMANDS: readonly CommandName[] = [
  "serve",
  "sign-in",
  "sign-out",
  "tidy",
  "session",
]

const isCommandName = (name: string): name is CommandName =>
  (COMMANDS as readonly string[]).includes(name)

/** What `argv`, the arguments after `pinetrie`, asks for. */
export function planCommand(argv: readonly string[]): PlannedCommand {
  const [first, ...args] = argv
  if (first === undefined || first === "help" || first === "--help")
    return { kind: "help" }
  if (first === "--version" || first === "version") return { kind: "version" }
  return isCommandName(first)
    ? { kind: "run", command: first, args }
    : { kind: "refused", named: first }
}

/** The help: each command, one line. */
export const COMMAND_USAGE = `${PRODUCT_NAME}: a collaborative agentic harness

usage: pinetrie <command>
  serve [folder]                       serve the folder, or the current one
  sign-in [provider] [oauth|api-key]   sign in to a model provider
  sign-out <provider>                  forget a provider's credential
  tidy [folder] [--days N] [--dry-run] cut a repo's operation log to a window
  session rename <old> <new>           rename a folder's session
  --version`

/** The words for a refusal. */
export const refusedWords = (named: string): string =>
  `${named}: no such command\n${COMMAND_USAGE}`
