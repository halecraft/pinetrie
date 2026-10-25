// statement-output — a `bash` call's output joined to its top-level
// statements, one event at a time: the lane's chunks (bytes per pipe, in
// read order) with the observer's attributions (bytes per pipe, by
// statement, in the pipe's own order). Counts only: the bytes stay with the
// caller, which moves each range `joinStep` attributes into its statement's
// capture. A split is shown or stored only as a `VerifiedSplit`, which
// `joinVerdict` alone makes; every other ending is undivided, for a reason
// the fold found.

import type {
  Attribution,
  OutputEvent,
  OutputFd,
  RootId,
  Settled,
  StatementIndex,
  TextRange,
  ValueWrite,
} from "@pinetrie/core"
import { Type } from "typebox"
import { choiceSchema, List, recordDecoder, textKey } from "./decode.ts"
import { type RecordSpec, setRecord } from "./records.ts"

/** What the join reads of a statement's place in the command: its lines, from 1. */
export interface StatementLines {
  readonly first: number
  readonly last: number
}

export type JoinEvent =
  /** Bytes the lane read from a pipe. */
  | { readonly kind: "chunk"; readonly fd: OutputFd; readonly bytes: number }
  | { readonly kind: "notice"; readonly event: OutputEvent }
  /** The lane stopped sending chunks: the rest of the output never arrives. */
  | { readonly kind: "over-cap" }
  /** The shell's output is not pipes the observer reads, so no byte of it is attributed. */
  | { readonly kind: "no-pipes" }
  /**
   * The call returned, and how the observer's flush after it went: once it
   * answered, every event before it has arrived. Not the run's end, which a
   * background job may outlive.
   */
  | { readonly kind: "done"; readonly flush: CallFlush }

/** How the observer's flush after a call went; anything but settled is the call's reason to be whole. */
export type CallFlush =
  | { readonly kind: "settled"; readonly proof: Settled }
  /** The lane has no observer to flush. */
  | { readonly kind: "no-observer" }
  | { readonly kind: "flush-failed" }

/** Why a call's output is shown whole, one list for the type and the stored schema. */
const UNDIVIDED_WHYS = [
  // The call's lane had no observer.
  "no-observer",
  // The observer's kernel lacks a hook attribution needs.
  "missing-hook",
  // The observer is another version's, which attributes nothing.
  "other-version",
  "over-cap",
  "output-lost",
  // The bytes attributed to a pipe never met the bytes read from it.
  "count-mismatch",
  // A signal or a writer named a statement the command does not have.
  "unknown-statement",
  "line-outside-statement",
  // The helper could not make the call's output pipes: it ran on sockets.
  "no-pipes",
  // The observer's flush after the call did not answer.
  "flush-failed",
] as const

export type UndividedWhy = (typeof UNDIVIDED_WHYS)[number]

/** The bytes of one statement's output, by pipe. */
interface StatementBytes {
  readonly stdout: number
  readonly stderr: number
}

declare const verified: unique symbol
/**
 * A split whose every byte so far is attributed to a statement of the
 * command, in order, by signals each within its statement's lines.
 */
export interface VerifiedSplit {
  readonly [verified]: true
  /** Each statement's bytes, by ordinal from 1 at index 0. */
  readonly statements: readonly StatementBytes[]
  /** The flush's proof, once every event of the call is folded; null while it runs. */
  readonly settled: Settled | null
}

/** A split of a call that has returned: every byte it read is attributed. */
type SettledSplit = VerifiedSplit & { readonly settled: Settled }

export type Verdict =
  | { readonly kind: "split"; readonly split: VerifiedSplit }
  /** Nothing attributed yet. */
  | { readonly kind: "pending" }
  | { readonly kind: "undivided"; readonly why: UndividedWhy }

/** A range of a pipe's bytes, counted from its first, newly attributed to a statement. */
export interface Attributed {
  readonly statement: StatementIndex
  readonly fd: OutputFd
  readonly from: number
  readonly to: number
}

interface Segment {
  readonly statement: StatementIndex
  readonly bytes: number
}

interface Pipe {
  readonly received: number
  /** Bytes both received and attributed: the ranges handed out so far. */
  readonly placed: number
  /** Attributions past `placed`, oldest first, for bytes not yet received. */
  readonly ahead: readonly Segment[]
}

export interface JoinState {
  readonly lines: readonly StatementLines[]
  readonly why: UndividedWhy | null
  readonly pipes: Readonly<Record<OutputFd, Pipe>>
  readonly statements: readonly StatementBytes[]
  /** How the call's flush went, once `done` was folded; null while it runs. An ended call takes no more events. */
  readonly end: CallFlush | null
}

const NO_PIPE: Pipe = { received: 0, placed: 0, ahead: [] }
const NO_BYTES: StatementBytes = { stdout: 0, stderr: 0 }

/** A call's join before any event: undivided from the start where attribution is off. */
export function joinStart(
  lines: readonly StatementLines[],
  attribution: Attribution | null,
): JoinState {
  return {
    lines,
    why:
      attribution === null
        ? "no-observer"
        : attribution.on
          ? null
          : attribution.why,
    pipes: { stdout: NO_PIPE, stderr: NO_PIPE },
    statements: lines.map(() => NO_BYTES),
    end: null,
  }
}

interface JoinStep {
  readonly state: JoinState
  /** Ranges newly attributed, adjacent ones of a statement merged. */
  readonly attributed: readonly Attributed[]
}

/** `event` folded into `state`; a call that has ended takes no more. */
export function joinStep(state: JoinState, event: JoinEvent): JoinStep {
  if (state.end !== null) return { state, attributed: [] }
  switch (event.kind) {
    case "over-cap":
      return unchanged(broken(state, "over-cap"))
    case "no-pipes":
      return unchanged(broken(state, "no-pipes"))
    case "done":
      return unchanged(endedState(state, event.flush))
    case "chunk": {
      if (state.why !== null) return unchanged(state)
      const pipe = state.pipes[event.fd]
      return advance(
        withPipe(state, event.fd, {
          ...pipe,
          received: pipe.received + event.bytes,
        }),
        event.fd,
      )
    }
    case "notice":
      return noticeStep(state, event.event)
  }
}

function noticeStep(state: JoinState, event: OutputEvent): JoinStep {
  switch (event.kind) {
    case "output-lost":
      return unchanged(broken(state, "output-lost"))
    case "statement": {
      if (state.why !== null) return unchanged(state)
      const span = state.lines[event.statement - 1]
      if (span === undefined)
        return unchanged(broken(state, "unknown-statement"))
      return event.line < span.first || event.line > span.last
        ? unchanged(broken(state, "line-outside-statement"))
        : unchanged(state)
    }
    case "output": {
      if (state.why !== null) return unchanged(state)
      const { statement } = event
      if (statement === null || state.lines[statement - 1] === undefined)
        return unchanged(broken(state, "unknown-statement"))
      if (event.bytes === 0) return unchanged(state)
      const pipe = state.pipes[event.fd]
      const last = pipe.ahead.at(-1)
      const ahead =
        last?.statement === statement
          ? [
              ...pipe.ahead.slice(0, -1),
              { statement, bytes: last.bytes + event.bytes },
            ]
          : [...pipe.ahead, { statement, bytes: event.bytes }]
      return advance(withPipe(state, event.fd, { ...pipe, ahead }), event.fd)
    }
  }
}

/** Hands out the bytes of `fd` both received and attributed, oldest first. */
function advance(state: JoinState, fd: OutputFd): JoinStep {
  const pipe = state.pipes[fd]
  let { placed } = pipe
  let ahead = pipe.ahead
  const statements = [...state.statements]
  const attributed: Attributed[] = []
  while (placed < pipe.received) {
    const next = ahead[0]
    if (next === undefined) break
    const take = Math.min(next.bytes, pipe.received - placed)
    // Consecutive attributions of a statement are one segment, so no two
    // ranges handed out together are adjacent and of one statement.
    attributed.push({
      statement: next.statement,
      fd,
      from: placed,
      to: placed + take,
    })
    const counted = statements[next.statement - 1] ?? NO_BYTES
    statements[next.statement - 1] = {
      ...counted,
      [fd]: counted[fd] + take,
    }
    placed += take
    ahead =
      take === next.bytes
        ? ahead.slice(1)
        : [
            { statement: next.statement, bytes: next.bytes - take },
            ...ahead.slice(1),
          ]
  }
  if (attributed.length === 0) return unchanged(state)
  return {
    state: { ...withPipe(state, fd, { ...pipe, placed, ahead }), statements },
    attributed,
  }
}

/**
 * The call returned. Once its flush has answered, every event is in, and
 * the bytes attributed to each pipe must be exactly those read from it, or
 * the split cannot be trusted. A flush that failed leaves no proof.
 */
function endedState(state: JoinState, flush: CallFlush): JoinState {
  if (flush.kind !== "settled")
    return { ...broken(state, flush.kind), end: flush }
  const met = (pipe: Pipe) =>
    pipe.placed === pipe.received && pipe.ahead.length === 0
  const checked =
    state.why === null && !(met(state.pipes.stdout) && met(state.pipes.stderr))
      ? broken(state, "count-mismatch")
      : state
  return { ...checked, end: flush }
}

/**
 * Over the cap and lost output say the observer or the lane saw less than
 * there was, so either wins over any reason found before it; otherwise the
 * first reason found stands.
 */
const WHY_RANK: Readonly<Record<UndividedWhy, number>> = {
  "over-cap": 0,
  "output-lost": 1,
  "no-observer": 2,
  "missing-hook": 2,
  "other-version": 2,
  "count-mismatch": 2,
  "unknown-statement": 2,
  "line-outside-statement": 2,
  "no-pipes": 2,
  "flush-failed": 2,
}

function broken(state: JoinState, why: UndividedWhy): JoinState {
  if (state.why !== null && WHY_RANK[state.why] <= WHY_RANK[why]) return state
  return { ...state, why }
}

const withPipe = (state: JoinState, fd: OutputFd, pipe: Pipe): JoinState => ({
  ...state,
  pipes: { ...state.pipes, [fd]: pipe },
})

const unchanged = (state: JoinState): JoinStep => ({ state, attributed: [] })

/** What the join's state says of the call's output now. */
export function joinVerdict(state: JoinState): Verdict {
  if (state.why !== null) return { kind: "undivided", why: state.why }
  const settled = state.end?.kind === "settled" ? state.end.proof : null
  const placed = state.pipes.stdout.placed + state.pipes.stderr.placed
  if (settled === null && placed === 0) return { kind: "pending" }
  return {
    kind: "split",
    split: { statements: state.statements, settled } as VerifiedSplit,
  }
}

/** A split's proof that its call has returned, or null while it runs. */
export const settledSplit = (split: VerifiedSplit): SettledSplit | null =>
  split.settled === null ? null : (split as SettledSplit)

/** An ended call's verdict: a split with its flush's proof, or why it is undivided. */
type EndedVerdict =
  | { readonly kind: "split"; readonly split: SettledSplit }
  | { readonly kind: "undivided"; readonly why: UndividedWhy }

/** The verdict of a call that has ended; null while it runs. */
export function endedVerdict(state: JoinState): EndedVerdict | null {
  const { end, why } = state
  if (end === null) return null
  if (why !== null) return { kind: "undivided", why }
  if (end.kind !== "settled") return { kind: "undivided", why: end.kind }
  return {
    kind: "split",
    split: { statements: state.statements, settled: end.proof } as SettledSplit,
  }
}

/** What a change of verdict asks of the call's shell. */
type VerdictStep = {
  /** The statements' live streams were shown: close them, so the row shows the whole output. */
  readonly kind: "close-statements"
}

export function planVerdictChange(
  before: Verdict,
  after: Verdict,
): readonly VerdictStep[] {
  return before.kind === "split" && after.kind === "undivided"
    ? [{ kind: "close-statements" }]
    : []
}

// ── the stored split ─────────────────────────────────────────────────────

/** The fewest lines each statement keeps, where it has them, before any statement gets more. */
export const STATEMENT_FLOOR_LINES = 3

/** The limits a call's whole output is cut to, as plain values: pi's. */
interface OutputLimits {
  readonly maxLines: number
  readonly maxBytes: number
}

/** A statement's output as its capture shows it. */
interface StatementView {
  readonly text: string
  /** Its capture already dropped lines from its start. */
  readonly truncated: boolean
  /** What it wrote to stderr, in `text`. */
  readonly stderr: readonly TextRange[]
}

/** A statement's output as stored: a tail of its view. */
interface StoredStatement {
  readonly text: string
  /** Lines were dropped from its start, by its capture or to fit the record. */
  readonly truncated: boolean
  /** What it wrote to stderr, in `text`. */
  readonly stderr: readonly TextRange[]
}

/**
 * Each statement's view cut so the whole fits `limits`, as a call's result
 * does: every statement first keeps its last `STATEMENT_FLOOR_LINES` lines,
 * from the last statement backwards while they fit, then each grows
 * backwards from the last statement while the rest of the budget lasts. A
 * line counts its bytes and one for its newline; a last line too long for
 * what is left keeps its tail.
 */
export function storedSplit(
  views: readonly StatementView[],
  limits: OutputLimits,
): readonly StoredStatement[] {
  const lines = views.map(v => (v.text === "" ? [] : v.text.split("\n")))
  const kept = lines.map(() => 0)
  const tails: (string | null)[] = lines.map(() => null)
  let linesLeft = limits.maxLines
  let bytesLeft = limits.maxBytes
  // Takes statement i's next line from its end, whole or by its tail; false once none fits.
  const take = (i: number): boolean => {
    const own = lines[i] ?? []
    const line = own[own.length - 1 - (kept[i] ?? 0)]
    if (line === undefined || linesLeft === 0 || tails[i] !== null) return false
    const cost = utf8Length(line) + 1
    if (cost <= bytesLeft) {
      kept[i] = (kept[i] ?? 0) + 1
      linesLeft -= 1
      bytesLeft -= cost
      return true
    }
    if ((kept[i] ?? 0) > 0 || bytesLeft <= 1) return false
    tails[i] = utf8Tail(line, bytesLeft - 1)
    kept[i] = 1
    linesLeft -= 1
    bytesLeft = 0
    return true
  }
  for (let i = lines.length - 1; i >= 0; i--)
    for (let n = 0; n < STATEMENT_FLOOR_LINES && take(i); n++);
  for (let i = lines.length - 1; i >= 0; i--) while (take(i));
  return views.map((view, i) => {
    const own = lines[i] ?? []
    const n = kept[i] ?? 0
    const tail = tails[i]
    const text =
      tail === null
        ? own.slice(own.length - n).join("\n")
        : [tail, ...own.slice(own.length - n + 1)].join("\n")
    return {
      text,
      truncated: view.truncated || n < own.length || tail !== null,
      stderr: shiftedRanges(view.stderr, text.length - view.text.length),
    }
  })
}

/**
 * `ranges` moved by `by` code units and clipped at 0. A stored text is a
 * suffix of its view (its last lines, or the tail of its last), so its
 * ranges are the view's moved back by what was cut from the front.
 */
function shiftedRanges(
  ranges: readonly TextRange[],
  by: number,
): readonly TextRange[] {
  if (by === 0) return ranges
  return ranges.flatMap(r => {
    const from = Math.max(0, r.from + by)
    const to = r.to + by
    return to > from ? [{ from, to }] : []
  })
}

/** UTF-8 bytes of `s`, a lone surrogate counted as the replacement it encodes to. */
function utf8Length(s: string): number {
  let n = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
  }
  return n
}

/** The longest tail of `s` within `bytes` UTF-8 bytes, never splitting a character. */
function utf8Tail(s: string, bytes: number): string {
  const chars = [...s]
  let n = 0
  let i = chars.length
  while (i > 0) {
    const size = utf8Length(chars[i - 1] ?? "")
    if (n + size > bytes) break
    n += size
    i--
  }
  return chars.slice(i).join("")
}

declare const recorded: unique symbol

/** How a `bash` call's output is stored: by statement, or whole and why. */
type StoredVerdict =
  | {
      readonly kind: "split"
      /** Each statement's output, by ordinal from 1 at index 0. */
      readonly statements: readonly StoredStatement[]
    }
  | { readonly kind: "undivided"; readonly why: UndividedWhy }

/**
 * How a `bash` call's output reads, as stored in its root at the call's id:
 * made only from an ended call's verdict (`bashOutputRecord`), or decoded.
 */
export interface BashOutputRecord {
  readonly [recorded]: true
  readonly call: string
  readonly verdict: StoredVerdict
  /**
   * What it wrote to stderr, in its whole output: ranges of its result's
   * text from its start, which begins with the output.
   */
  readonly stderr: readonly TextRange[]
}

/**
 * The record of an ended call: for a split, each statement's view, from
 * `view`, for a statement that printed, the whole cut to `limits`; for an
 * undivided call, its reason. `stderr` is the whole output's.
 */
export function bashOutputRecord(
  call: string,
  verdict: EndedVerdict,
  view: (statement: StatementIndex) => StatementView,
  stderr: readonly TextRange[],
  limits: OutputLimits,
): BashOutputRecord {
  if (verdict.kind === "undivided") return recordedOutput(call, verdict, stderr)
  const views = verdict.split.statements.map((bytes, i) =>
    bytes.stdout + bytes.stderr === 0
      ? NO_VIEW
      : view((i + 1) as StatementIndex),
  )
  return recordedOutput(
    call,
    { kind: "split", statements: storedSplit(views, limits) },
    stderr,
  )
}

const NO_VIEW: StatementView = { text: "", truncated: false, stderr: [] }

/** The one place a `BashOutputRecord` is branded, for an ended call's record and a decoded one. */
const recordedOutput = (
  call: string,
  verdict: StoredVerdict,
  stderr: readonly TextRange[],
): BashOutputRecord => ({ call, verdict, stderr }) as BashOutputRecord

const RangesSchema = List(
  Type.Object({ from: Type.Integer(), to: Type.Integer() }),
)

const BashOutputSchema = Type.Object({
  verdict: Type.Union([
    Type.Object({
      kind: Type.Literal("split"),
      statements: List(
        Type.Object({
          text: Type.String(),
          truncated: Type.Boolean(),
          stderr: RangesSchema,
        }),
      ),
    }),
    Type.Object({
      kind: Type.Literal("undivided"),
      why: choiceSchema(UNDIVIDED_WHYS),
    }),
  ]),
  stderr: RangesSchema,
})

const ranges = (rs: readonly TextRange[]): TextRange[] =>
  rs.map(r => ({ from: r.from, to: r.to }))

/** Each `bash` call's output as it reads, at its call's id. */
export const BASH_OUTPUT: RecordSpec<
  BashOutputRecord,
  string,
  "root",
  typeof BashOutputSchema
> = {
  namespace: "pinetrie.bash-output",
  home: "root",
  keyOf: r => r.call,
  encode: r => ({
    verdict:
      r.verdict.kind === "undivided"
        ? { kind: "undivided", why: r.verdict.why }
        : {
            kind: "split",
            statements: r.verdict.statements.map(s => ({
              text: s.text,
              truncated: s.truncated,
              stderr: ranges(s.stderr),
            })),
          },
    stderr: ranges(r.stderr),
  }),
  decode: recordDecoder(BashOutputSchema, textKey, (r, call) =>
    recordedOutput(call, r.verdict, r.stderr),
  ),
}

/** The write that stores `record` in `root`. */
export const bashOutputWrite = (
  record: BashOutputRecord,
  root: RootId,
): ValueWrite<"root"> => setRecord(BASH_OUTPUT, record, root)
