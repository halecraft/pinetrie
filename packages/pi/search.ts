// pi/search — the `grep` and `find` tools (ADR-0064): rg and fd, run through
// the tool context's `env`, so in a lane of its own they search the lane and
// not the host. pi-coding-agent's tools of the same names spawn rg and fd on
// the host, and so cannot serve a lane.
//
// A call looks up its program (`ToolContext.programs`), plans the command
// (`grepArgs`, `findArgs`, `shellCommand`), runs it once (`env.exec`), reads
// what came back as a `SearchOutcome` and words it (`searchText`). Only the
// lookup and the run do I/O.

import {
  applyShellOutputUpdate,
  DEFAULT_MAX_BYTES,
  type ExecutionErrorCode,
  formatSize,
  type ShellOutputView,
} from "@earendil-works/pi-agent-core"
import { shellWord } from "@pinetrie/core"
import { Type } from "typebox"
import type { SearchProgram, ToolContext } from "./lanes.ts"

export const GREP_TOOL = "grep"
export const FIND_TOOL = "find"
export type SearchTool = typeof GREP_TOOL | typeof FIND_TOOL

const PROGRAM: Readonly<Record<SearchTool, SearchProgram>> = {
  grep: "rg",
  find: "fd",
}

const GREP_LIMIT = 200
const FIND_LIMIT = 1000
/** rg prints this much of a long line, and marks the rest omitted. */
const MAX_COLUMNS = 500

export interface GrepParams {
  readonly pattern: string
  readonly path?: string
  readonly glob?: string
  readonly ignoreCase?: boolean
  readonly literal?: boolean
  readonly context?: number
  /** Lines of output at most. */
  readonly limit?: number
}

export interface FindParams {
  readonly pattern: string
  readonly path?: string
  /** Results at most. */
  readonly limit?: number
}

const atLeast = (min: number, n: number | undefined, otherwise: number) =>
  n === undefined || !Number.isFinite(n)
    ? otherwise
    : Math.max(min, Math.floor(n))

/** Lines of output a grep call keeps. */
export const grepLimit = (p: GrepParams): number =>
  atLeast(1, p.limit, GREP_LIMIT)
/** Results a find call keeps. */
export const findLimit = (p: FindParams): number =>
  atLeast(1, p.limit, FIND_LIMIT)

/**
 * rg's arguments. No path means the working directory: rg then prints paths
 * without a leading `./`.
 */
export function grepArgs(p: GrepParams): readonly string[] {
  const context = atLeast(0, p.context, 0)
  return [
    "--no-config",
    "-n",
    "--no-heading",
    "--with-filename",
    "--color=never",
    "--hidden",
    "--max-columns",
    String(MAX_COLUMNS),
    "--max-columns-preview",
    ...(p.ignoreCase === true ? ["-i"] : []),
    ...(p.literal === true ? ["-F"] : []),
    ...(p.glob === undefined || p.glob === "" ? [] : ["-g", p.glob]),
    ...(context > 0 ? ["-C", String(context)] : []),
    "--",
    p.pattern,
    ...(p.path === undefined || p.path === "" ? [] : [p.path]),
  ]
}

/**
 * fd's arguments. It is asked for one result more than the limit, so a cut
 * capture means there were more (`searchOutcome`). fd matches a glob against
 * the basename, or with `--full-path` against the absolute path, so a
 * pattern with a `/` needs a leading `**` segment to match anything (S88).
 */
export function findArgs(p: FindParams): readonly string[] {
  const full = p.pattern.includes("/")
  const pattern =
    full && !p.pattern.startsWith("/") && !p.pattern.startsWith("**/")
      ? `**/${p.pattern}`
      : p.pattern
  return [
    "--glob",
    "--color=never",
    "--hidden",
    "--max-results",
    String(findLimit(p) + 1),
    ...(full ? ["--full-path"] : []),
    "--",
    pattern,
    ...(p.path === undefined || p.path === "" ? [] : [p.path]),
  ]
}

/**
 * One POSIX shell command, as `env.exec` takes it. No pipe: it would hide the
 * program's exit status, and `pipefail` is not in every image's `sh`. A word
 * such as `-x` stays bare, which is safe after `--`.
 */
export const shellCommand = (
  program: string,
  args: readonly string[],
): string => [program, ...args].map(shellWord).join(" ")

/** Which limit cut the output, or null when none did. */
export type SearchCut = "lines" | "bytes" | null

/** What a call came to, before it is worded. */
export type SearchOutcome =
  | { readonly kind: "found"; readonly text: string; readonly cut: SearchCut }
  | { readonly kind: "none" }
  | { readonly kind: "failed"; readonly text: string }
  | { readonly kind: "unavailable"; readonly program: SearchProgram }
  | {
      readonly kind: "stopped"
      readonly why: "aborted" | "timeout" | "error"
      readonly message: string
    }

/** A finished `exec`: its exit code and captured text, or why it did not finish. */
export type SearchRun =
  | {
      readonly ok: true
      readonly exit: number
      readonly text: string
      readonly cut: SearchCut
    }
  | {
      readonly ok: false
      readonly code: ExecutionErrorCode
      readonly message: string
    }

/**
 * What a run means. rg exits 1 when nothing matches; fd exits 0 with no
 * output. Any other exit is a failure, with what the program printed.
 */
export function searchOutcome(tool: SearchTool, ran: SearchRun): SearchOutcome {
  if (!ran.ok)
    return {
      kind: "stopped",
      why:
        ran.code === "aborted" || ran.code === "timeout" ? ran.code : "error",
      message: ran.message,
    }
  const text = ran.text.trimEnd()
  if (ran.exit === 0)
    return text === ""
      ? { kind: "none" }
      : { kind: "found", text, cut: ran.cut }
  if (tool === GREP_TOOL && ran.exit === 1) return { kind: "none" }
  return {
    kind: "failed",
    text: text === "" ? `${PROGRAM[tool]} exited with code ${ran.exit}` : text,
  }
}

/** The result's text, and whether it is a tool error. */
export function searchText(
  tool: SearchTool,
  outcome: SearchOutcome,
  limit: number,
): { readonly ok: boolean; readonly text: string } {
  switch (outcome.kind) {
    case "found": {
      const notice =
        outcome.cut === "lines"
          ? `\n\n[limit of ${limit} ${tool === GREP_TOOL ? "lines" : "results"} reached: narrow the pattern or raise limit]`
          : outcome.cut === "bytes"
            ? `\n\n[output cut at ${formatSize(DEFAULT_MAX_BYTES)}: narrow the pattern]`
            : ""
      return { ok: true, text: `${outcome.text}${notice}` }
    }
    case "none":
      return {
        ok: true,
        text: tool === GREP_TOOL ? "No matches found" : "No files found",
      }
    case "failed":
      return { ok: false, text: outcome.text }
    case "unavailable":
      return {
        ok: false,
        text: `${outcome.program} is not available on this host and could not be fetched; search with bash.`,
      }
    case "stopped":
      return {
        ok: false,
        text:
          outcome.why === "aborted"
            ? "Search aborted"
            : outcome.why === "timeout"
              ? "Search timed out"
              : outcome.message,
      }
  }
}

type ExecContext = Parameters<ToolContext["env"]["exec"]>[2]

/** Gather, plan, run once, word: the one shell both tools share. */
function searchExecute<P>(
  tool: SearchTool,
  plan: (params: P) => {
    readonly args: readonly string[]
    readonly limit: number
  },
) {
  return async (
    _id: string,
    params: P,
    _onUpdate: unknown,
    toolContext: ToolContext,
    _invocation: unknown,
    context: ExecContext,
  ) => {
    const { args, limit } = plan(params)
    const program = await toolContext.programs(PROGRAM[tool])
    const outcome =
      program === null
        ? ({ kind: "unavailable", program: PROGRAM[tool] } as const)
        : searchOutcome(
            tool,
            await run(toolContext, shellCommand(program, args), limit, context),
          )
    const { ok, text } = searchText(tool, outcome, limit)
    if (!ok) throw new Error(text)
    return { content: [{ type: "text" as const, text }], details: undefined }
  }
}

/** One `exec`, keeping the first `limit` lines. */
async function run(
  toolContext: ToolContext,
  command: string,
  limit: number,
  context: ExecContext,
): Promise<SearchRun> {
  let view: ShellOutputView | undefined
  const result = await toolContext.env.exec(
    command,
    {
      capture: {
        limits: {
          maxBytes: DEFAULT_MAX_BYTES,
          maxLines: limit,
          retain: "head",
        },
      },
      onUpdate: update => {
        view = applyShellOutputUpdate(view, update)
      },
    },
    context,
  )
  if (!result.ok)
    return { ok: false, code: result.error.code, message: result.error.message }
  const { truncation } = result.value
  return {
    ok: true,
    exit: result.value.exitCode,
    text: view?.text ?? "",
    cut: truncation.truncatedBy,
  }
}

const IGNORED =
  "Respects .gitignore: an ignored directory, such as node_modules or a shared .plans, is searched only when named as path."

/** `grep`: rg in the tool context's environment. */
export function grepTool() {
  return {
    name: GREP_TOOL,
    label: GREP_TOOL,
    description: `Search file contents for a regex (ripgrep syntax) or a literal string. Returns matching lines as path:line:text, and context lines as path-line-text. Prefer this to grep or rg in bash. ${IGNORED} Output stops at limit lines (default ${GREP_LIMIT}) or ${formatSize(DEFAULT_MAX_BYTES)}; lines past ${MAX_COLUMNS} characters are shortened.`,
    parameters: Type.Object({
      pattern: Type.String({
        description: "Search pattern (regex or literal string)",
      }),
      path: Type.Optional(
        Type.String({
          description:
            "Directory or file to search (default: current directory)",
        }),
      ),
      glob: Type.Optional(
        Type.String({
          description:
            "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'",
        }),
      ),
      ignoreCase: Type.Optional(
        Type.Boolean({
          description: "Case-insensitive search (default: false)",
        }),
      ),
      literal: Type.Optional(
        Type.Boolean({
          description:
            "Treat pattern as literal string instead of regex (default: false)",
        }),
      ),
      context: Type.Optional(
        Type.Number({
          description:
            "Number of lines to show before and after each match (default: 0)",
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: `Maximum lines of output, context lines included (default: ${GREP_LIMIT})`,
        }),
      ),
    }),
    execute: searchExecute<GrepParams>(GREP_TOOL, p => ({
      args: grepArgs(p),
      limit: grepLimit(p),
    })),
  }
}

/** `find`: fd in the tool context's environment. */
export function findTool() {
  return {
    name: FIND_TOOL,
    label: FIND_TOOL,
    description: `Find files and directories by glob pattern, matched against the file name, or against the path when the pattern has a /. Returns one path a line, under path when one is given. Prefer this to find or fd in bash. ${IGNORED}`,
    parameters: Type.Object({
      pattern: Type.String({
        description:
          "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
      }),
      path: Type.Optional(
        Type.String({
          description: "Directory to search in (default: current directory)",
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: `Maximum number of results (default: ${FIND_LIMIT})`,
        }),
      ),
    }),
    execute: searchExecute<FindParams>(FIND_TOOL, p => ({
      args: findArgs(p),
      limit: findLimit(p),
    })),
  }
}
