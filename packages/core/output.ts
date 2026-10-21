// core/output — a `bash` call's output as pine·trie keeps it, apart from the
// disk's events (`runs.ts`): which pipe a piece of it came through, and which
// statement of the command wrote it. Its events never share a type, a ring or
// a route with `RunEvent`, so output volume cannot cost a file event.

/** The pipe a piece of a `bash` call's output came through. */
export type OutputFd = "stdout" | "stderr"

declare const statementIndexBrand: unique symbol
/** A statement's ordinal among a command's top-level statements, from 1. */
export type StatementIndex = number & {
  readonly [statementIndexBrand]: true
}

/** `n` as a statement's ordinal, or null for anything that cannot be one. */
export const statementIndex = (n: number): StatementIndex | null =>
  Number.isSafeInteger(n) && n >= 1 ? (n as StatementIndex) : null

/**
 * The `prctl` option by which pine·trie's bash says which top-level
 * statement of its `-c` string it starts: no kernel implements it, so it
 * fails as any unknown option does, after the observer has seen it. Its
 * second argument is the statement's ordinal, its third the statement's
 * line. C cannot import it: `packages/lanes/image/bash/apply.py` and the
 * observer's `observe.h` spell it, and a test checks they spell this.
 */
export const STATEMENT_SIGNAL = 0x50540001

/**
 * What the observer saw of a run's output, in its pipes' own order.
 * - `statement`: the run's shell signalled that it starts a statement.
 * - `output`: `bytes` entered the run's pipe `fd`, written by a task of
 *   `statement`; null for a writer no statement of this run tagged (another
 *   run's, or none), so it can never index a statement.
 * - `output-lost`: pieces of output the observer could not attribute, so
 *   the run's split cannot be trusted.
 */
export type OutputEvent =
  | {
      readonly kind: "statement"
      /** `CLOCK_MONOTONIC` in µs, as a `RunEvent`'s. */
      readonly at: number
      readonly statement: StatementIndex
      readonly line: number
    }
  | {
      readonly kind: "output"
      readonly fd: OutputFd
      readonly statement: StatementIndex | null
      readonly bytes: number
    }
  | { readonly kind: "output-lost"; readonly count: number }

const FD_LETTERS: Readonly<Record<OutputFd, string>> = {
  stdout: "1",
  stderr: "2",
}

const count = (s: string | undefined): number | null => {
  if (s === undefined || !/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}

/**
 * An `OutputEvent` as one line, tab-separated: `statement at n line`,
 * `output fd n bytes` (fd `1` or `2`, n `0` for no statement),
 * `output-lost count`. The form the observer's loader writes, in C.
 */
export function encodeOutputEvent(e: OutputEvent): string {
  switch (e.kind) {
    case "statement":
      return `statement\t${e.at}\t${e.statement}\t${e.line}`
    case "output":
      return `output\t${FD_LETTERS[e.fd]}\t${e.statement ?? 0}\t${e.bytes}`
    case "output-lost":
      return `output-lost\t${e.count}`
  }
}

/** A line `encodeOutputEvent` writes, or null for any other. */
export function decodeOutputEvent(line: string): OutputEvent | null {
  const f = line.split("\t")
  switch (f[0]) {
    case "statement": {
      const at = count(f[1])
      const n = count(f[2])
      const statement = n === null ? null : statementIndex(n)
      const lineNo = count(f[3])
      return f.length !== 4 ||
        at === null ||
        statement === null ||
        lineNo === null
        ? null
        : { kind: "statement", at, statement, line: lineNo }
    }
    case "output": {
      const fd = f[1] === "1" ? "stdout" : f[1] === "2" ? "stderr" : null
      const n = count(f[2])
      const bytes = count(f[3])
      if (f.length !== 4 || fd === null || n === null || bytes === null)
        return null
      return { kind: "output", fd, statement: statementIndex(n), bytes }
    }
    case "output-lost": {
      const lost = count(f[1])
      return f.length !== 2 || lost === null
        ? null
        : { kind: "output-lost", count: lost }
    }
    default:
      return null
  }
}

/**
 * Whether the observer can attribute a `bash` call's output to its
 * statements on this machine, as its machine role found when its loader
 * started: every hook it needs attached, or the first that did not. A role
 * of another version, whose hello holds no attribution this host reads, is
 * `other-version`: a host inside a lane is often newer than the role its
 * outer host relays.
 */
export type Attribution =
  | { readonly on: true }
  | { readonly on: false; readonly why: "missing-hook"; readonly hook: string }
  | {
      readonly on: false
      readonly why: "other-version"
      /** The role's, from its hello. */
      readonly version: string
    }

declare const settledBrand: unique symbol
/**
 * Proof that every observer event of a lane before a moment has arrived.
 * Only a lane observation's `settle` makes one, so what needs it (a
 * call's join, folding its `done`) cannot act before the flush.
 */
export type Settled = { readonly [settledBrand]: true }
