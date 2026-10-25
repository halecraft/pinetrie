// interface/tool-row — what a tool call's row shows: what the call touched
// (`rowSummary`), its output as lines of runs (`rowOutput`), and how much of
// each the row draws (`rowView`).
//
// An output is read before the view: a terminal tool's SGR becomes a style
// on each run (`@pinetrie/shell`), and the stderr its record names marks the
// runs it covers, both by offset in the text as stored. `rowView` only cuts
// lines, counts only what is visible, and never sees an escape. A client
// draws a style and a mark its own way: the page as CSS and a margin bar, a
// terminal as SGR again.
//
// A row is its summary or its detail. The summary shows the command's first
// SUMMARY_LINES lines and the output's last, so the live output and the result
// that replaces it draw the same height; only the reader opens the detail,
// which shows both whole, and, for a `bash` call whose output verified by
// statement, each statement's output under its lines. In story, a call with
// an intent leads with it (`rowLead`), its command in the detail alone.

import type { ImageRef, TextRange } from "@pinetrie/core"
import type { BashOutputRecord, UndividedWhy } from "@pinetrie/rules"
import {
  PLAIN_STYLE,
  readShell,
  type ShellRole,
  type ShownStatement,
  type StyledRun,
  styledRuns,
  type TerminalStyle,
} from "@pinetrie/shell"
import {
  BASH_TOOL,
  isTerminalOutputTool,
  knownToolId,
  type StreamId,
  streamStart,
  type ToolCall,
  type ToolId,
  type ToolResult,
} from "@pinetrie/threads"
import type { Density } from "./ask-words.ts"
import { elapsed, plural } from "./counts.ts"
import { markedParts } from "./marked-parts.ts"
import { toolWord } from "./tool-words.ts"
import { undividedWords } from "./undivided-words.ts"

// What a client draws an output's styles by; the page does not declare the shell.
export type {
  PaletteIndex,
  TerminalColor,
  TerminalStyle,
} from "@pinetrie/shell"

/** How long a call's output streams before its row is ringed and timed. */
export const REVEAL_MS = 500

/**
 * What a row decides for itself. It outlives the row, kept by its call's id,
 * since a tab shown again mounts its columns anew.
 */
export interface RowMemory {
  /** The call's output streamed for REVEAL_MS while this row was drawn: its ring and time show. */
  readonly revealed: boolean
  /** The reader opened its detail. */
  readonly open: boolean
}

/** A row never drawn before. */
export const NO_MEMORY: RowMemory = { revealed: false, open: false }

/**
 * Whether a result has images, drawn in place of its text, whose caption
 * only says an image was read. `note` is that text: the caption, and pi's
 * note of a resize.
 */
type ToolBody =
  | {
      readonly kind: "images"
      readonly images: readonly ImageRef[]
      readonly note: string
    }
  | { readonly kind: "text" }

export const toolBody = (result: ToolResult | undefined): ToolBody =>
  result !== undefined && result.images.length > 0
    ? { kind: "images", images: result.images, note: result.text }
    : { kind: "text" }

/** Whether a call is still running (or was cut off), failed, or worked. */
type CallStatus = "pending" | "error" | "ok"

export const callStatus = (result: ToolResult | undefined): CallStatus =>
  result === undefined ? "pending" : result.isError ? "error" : "ok"

/** A status as its row's mark. A running call has none: its ring and live lines say it. */
export const callMark = (status: CallStatus): string | undefined =>
  status === "error" ? "✗" : status === "ok" ? "✓" : undefined

/**
 * How long a running call has run, by its stream's start on the host's clock,
 * and when that next changes: the ms from `now` to the next whole second it
 * has run. Undefined for a stream whose id holds no start.
 */
export function runningFor(
  stream: StreamId,
  now: number,
): { readonly words: string; readonly next: number } | undefined {
  const start = streamStart(stream)
  if (start === undefined) return undefined
  const ran = Math.max(0, now - start)
  return { words: elapsed(ran), next: 1000 - (ran % 1000) }
}

/** What a run of a command is, for a client to colour by. Only a shell command has runs other than plain. */
type RunRole = ShellRole

/** Some of a command's text, and what it is. An output's runs are `OutputRun`s. */
export interface Run {
  readonly text: string
  readonly role: RunRole
}

/** What a call touched, as a row shows it. */
interface RowSummary {
  /** The tool's word (`toolWord`). Absent when the call has no subject: its word is then its command. */
  readonly tag: string | undefined
  /** All of what the call touched: a shell command highlighted, and laid out when it is one long line. */
  readonly whole: readonly Run[]
  /** The lines of `whole`, from 0, that begin a shell command's top-level statement other than its first. */
  readonly starts: readonly number[]
  /** A shell command's top-level statements, each's lines of `whole`, in order; none for any other. */
  readonly statements: readonly ShownStatement[]
  /** What the call is for, in the model's words; absent for a call that says none. */
  readonly intent: string | undefined
}

/** What a tool row leads with: an intent it has, or its command. */
type RowLead =
  | { readonly kind: "intent"; readonly intent: string }
  | { readonly kind: "command" }

/**
 * What a row leads with at `density`: in story, a call's intent, when it has
 * one; else its command, as raw always does.
 */
export const rowLead = (summary: RowSummary, density: Density): RowLead =>
  density === "story" && summary.intent !== undefined
    ? { kind: "intent", intent: summary.intent }
    : { kind: "command" }

/**
 * How many columns a shell command is laid out to. A command has its row's
 * whole width: a 28rem column's row is 26.5rem, 424px, which is 55 characters
 * of the Mac's SF Mono at a row's .8rem (0.6em each). Only its first line runs
 * beside the tag and status, and wraps once when long.
 */
const LAYOUT_WIDTH = 55

/** A subject as its row reads it. */
type Subject = Pick<RowSummary, "whole" | "starts" | "statements">

/** A text read as itself. */
const plainSubject = (text: string): Subject => ({
  whole: [{ text, role: "plain" }],
  starts: [],
  statements: [],
})

/** The tools whose subject reads other than as plain text, by id; any other reads plain. */
const VIEWS: Readonly<Partial<Record<ToolId, (subject: string) => Subject>>> = {
  [BASH_TOOL]: subject => {
    const { source, laidOut } = readShell(subject, LAYOUT_WIDTH)
    const shown = laidOut ?? source
    return {
      whole: shown.spans,
      starts: shown.starts,
      statements: shown.statements,
    }
  },
}

/** What a call's row shows of what it touched; a row keeps it for its call. */
export function rowSummary(call: ToolCall): RowSummary {
  const word = toolWord(call.name)
  const { intent } = call
  if (call.subject === undefined)
    return { tag: undefined, ...plainSubject(word), intent }
  const id = knownToolId(call.name)
  const view = id === undefined ? undefined : VIEWS[id]
  return {
    tag: word,
    ...(view ?? plainSubject)(call.subject),
    intent,
  }
}

/** Lines a summary shows of a command, and of its output. */
const SUMMARY_LINES = 5
/** The most of one line a summary shows. */
export const LINE_LENGTH = 160
/** The most of a result the detail draws: its end. */
export const SHOWN = 20_000
/** The tallest image a summary draws at its own size, in CSS px: 10rem, as `.tool-images[data-thumb]` caps it. */
const THUMB_HEIGHT = 160

/** Some of a command's output: the style it was written in, and whether it came through stderr. */
interface OutputRun {
  readonly text: string
  readonly style: TerminalStyle
  readonly stderr: boolean
}

/** A line of a call's output, its break left out. */
export type OutputLine = readonly OutputRun[]

/** What ends a line cut at LINE_LENGTH, in a command and in an output. */
const COMMAND_ELLIPSIS: Run = { text: "…", role: "plain" }
const OUTPUT_ELLIPSIS: OutputRun = {
  text: "…",
  style: PLAIN_STYLE,
  stderr: false,
}

/** Runs as lines as written; a run across a break is split, each part keeping its look. A final break ends a line, and starts none. */
function linesOf<R extends { readonly text: string }>(
  runs: readonly R[],
): R[][] {
  const lines: R[][] = [[]]
  for (const run of runs) {
    const parts = run.text.split("\n")
    parts.forEach((text, i) => {
      if (i > 0) lines.push([])
      if (text !== "") lines.at(-1)?.push({ ...run, text })
    })
  }
  if (lines.length > 1 && lines.at(-1)?.length === 0) lines.pop()
  return lines.length === 1 && lines[0]?.length === 0 ? [] : lines
}

/** One line, cut at LINE_LENGTH with `ellipsis`. */
function cutLine<R extends { readonly text: string }>(
  line: readonly R[],
  ellipsis: R,
): readonly R[] {
  if (lengthOf(line) <= LINE_LENGTH) return line
  const out: R[] = []
  let left = LINE_LENGTH
  for (const run of line) {
    if (left <= 0) break
    out.push(
      run.text.length <= left ? run : { ...run, text: run.text.slice(0, left) },
    )
    left -= run.text.length
  }
  return [...out, ellipsis]
}

const lengthOf = (line: readonly { readonly text: string }[]) =>
  line.reduce((n, r) => n + r.text.length, 0)

/** Some of a text's lines, and what the cut hides. */
interface Cut<R> {
  readonly lines: readonly (readonly R[])[]
  /** Lines left out. */
  readonly hidden: number
  /** A line shown was cut at LINE_LENGTH. */
  readonly cut: boolean
}

/** Some of `all`'s lines, each cut at LINE_LENGTH, and what the cut leaves out. */
function cutOf<R extends { readonly text: string }>(
  all: readonly (readonly R[])[],
  lines: readonly (readonly R[])[],
  ellipsis: R,
): Cut<R> {
  return {
    lines: lines.map(l => cutLine(l, ellipsis)),
    hidden: all.length - lines.length,
    cut: lines.some(l => lengthOf(l) > LINE_LENGTH),
  }
}

/** The first SUMMARY_LINES lines of a command's runs as written, each cut at LINE_LENGTH. */
export function headLines(runs: readonly Run[]): Cut<Run> {
  const lines = linesOf(runs)
  return cutOf(lines, lines.slice(0, SUMMARY_LINES), COMMAND_ELLIPSIS)
}

/** The last SUMMARY_LINES lines of an output, each cut at LINE_LENGTH. */
export function tailLines(lines: readonly OutputLine[]): Cut<OutputRun> {
  return cutOf(lines, lines.slice(-SUMMARY_LINES), OUTPUT_ELLIPSIS)
}

/** One line of pine·trie's own words among an output's lines. */
const plainLine = (text: string): OutputLine => [
  { text, style: PLAIN_STYLE, stderr: false },
]

/**
 * A run cut at the stderr ranges of the text it was read from: each part
 * marked when it lies in one. `run.at` places it, so a range counts the
 * escape sequences before it as the stored ranges do.
 */
const markedRuns = (
  run: StyledRun,
  stderr: readonly TextRange[],
): readonly OutputRun[] =>
  markedParts(
    run.text,
    stderr
      .filter(r => r.to > run.at && r.from < run.at + run.text.length)
      .map(r => ({ from: r.from - run.at, to: r.to - run.at })),
  ).map(p => ({ text: p.text, style: run.style, stderr: p.marked }))

/**
 * A call's text as lines of runs: styled by its SGR when its tool writes a
 * terminal's output, plain as written otherwise, and marked where `stderr`
 * covers it. A range past the text is clipped: a result's text is its
 * output and then pi's notes, never stderr.
 */
export function outputLines(
  text: string,
  stderr: readonly TextRange[],
  terminal: boolean,
): readonly OutputLine[] {
  const runs: readonly StyledRun[] = terminal
    ? styledRuns(text)
    : [{ text, style: PLAIN_STYLE, at: 0 }]
  return linesOf(runs.flatMap(run => markedRuns(run, stderr)))
}

/**
 * The detail's output: whole, or its last SHOWN characters (a break between
 * lines counts as one) after a line counting the rest, the first line kept
 * cut at its start.
 */
export function detailOutput(
  lines: readonly OutputLine[],
): readonly OutputLine[] {
  const total = lines.reduce((n, l) => n + lengthOf(l), 0) + lines.length - 1
  if (total <= SHOWN) return lines
  let left = total - SHOWN
  const kept: OutputLine[] = []
  for (const line of lines) {
    const length = lengthOf(line)
    if (left > length) left -= length + 1
    else {
      kept.push(left > 0 ? dropStart(line, left) : line)
      left = 0
    }
  }
  return [plainLine(`… ${plural(total - SHOWN, "earlier character")}`), ...kept]
}

/** A line without its first `n` characters. */
function dropStart(line: OutputLine, n: number): OutputLine {
  const out: OutputRun[] = []
  let left = n
  for (const run of line) {
    if (left >= run.text.length) left -= run.text.length
    else {
      out.push(left === 0 ? run : { ...run, text: run.text.slice(left) })
      left = 0
    }
  }
  return out
}

/** What a row's body draws: its output's lines, or its images. */
type RowBody =
  | { readonly kind: "text"; readonly lines: readonly OutputLine[] }
  | {
      readonly kind: "images"
      readonly images: readonly ImageRef[]
      readonly note: string
      /** Drawn THUMB_HEIGHT tall at most, not at its own size. */
      readonly thumb: boolean
    }

/** A line of a command as its row draws it. */
export interface CommandLine {
  readonly runs: readonly Run[]
  /** It begins a top-level statement other than the command's first: the row sets it apart. */
  readonly startsStatement: boolean
  /**
   * The output of each statement that ends on it, in order, each by line,
   * drawn under it: in the detail of a call split by statement alone. A
   * statement that printed nothing has none.
   */
  readonly outputs: readonly (readonly OutputLine[])[]
}

/** A statement's output, as a split call's row reads it: its SGR and stderr read. */
interface StatementOutput {
  readonly lines: readonly OutputLine[]
  /** Lines were left out of its start. */
  readonly truncated: boolean
}

/**
 * A `bash` call's output by statement, at its ordinal from 1 at index 0:
 * made only from what the host wrote of a verified split, its record or its
 * live statement streams.
 */
export type RowSplit = readonly StatementOutput[]

/** A call's output as its row reads it. */
interface RowOutput {
  /** The result's text, or the live stream's, as lines; stderr marked once the call has returned. */
  readonly lines: readonly OutputLine[]
  readonly split: RowSplit | null
  /** Why its stored record says it is shown whole; null otherwise. */
  readonly whyUndivided: UndividedWhy | null
}

/**
 * A call's output, from its result and its stored record once it has a
 * result, else from its live streams: `streamed` is its own, `liveTexts`
 * its statements' by ordinal, for a command of `statementCount`. Read here,
 * once, before any cut (`outputLines`), so a style set above a cut line
 * still holds below it.
 */
export function rowOutput(
  call: ToolCall,
  streamed: string,
  stored: BashOutputRecord | undefined,
  liveTexts: Readonly<Record<number, string>>,
  statementCount: number,
): RowOutput {
  const terminal = isTerminalOutputTool(call.name)
  if (call.result === undefined)
    return {
      lines: outputLines(streamed, [], terminal),
      split: liveRowSplit(liveTexts, statementCount),
      whyUndivided: null,
    }
  const verdict = stored?.verdict
  return {
    lines: outputLines(call.result.text, stored?.stderr ?? [], terminal),
    split:
      verdict?.kind === "split"
        ? verdict.statements.map(s => ({
            lines: outputLines(s.text, s.stderr, true),
            truncated: s.truncated,
          }))
        : null,
    whyUndivided: verdict?.kind === "undivided" ? verdict.why : null,
  }
}

/** Output with nothing known of it but its text: a call that is not `bash`, or has no record. */
export const plainRowOutput = (text: string): RowOutput => ({
  lines: outputLines(text, [], false),
  split: null,
  whyUndivided: null,
})

/**
 * A message's own calls' stored records, by call id: plain data, so a
 * message compared by value redraws only when one of its own calls' changes.
 */
export function callBashOutputs(
  calls: readonly ToolCall[] | undefined,
  outputs: ReadonlyMap<string, BashOutputRecord>,
): Readonly<Record<string, BashOutputRecord>> {
  const out: Record<string, BashOutputRecord> = {}
  for (const call of calls ?? []) {
    const record = outputs.get(call.id)
    if (record !== undefined) out[call.id] = record
  }
  return out
}

/** A command a row can show by statement: a shell command of two or more. */
const isSplittable = (summary: RowSummary): boolean =>
  summary.statements.length > 1

/**
 * A running call's split from its statements' live texts, by ordinal, for a
 * command of `count` statements; null before any statement has printed, or
 * for an ordinal the command does not have.
 */
export function liveRowSplit(
  texts: Readonly<Record<number, string>>,
  count: number,
): RowSplit | null {
  const ordinals = Object.keys(texts).map(Number)
  if (ordinals.length === 0 || ordinals.some(n => !(n >= 1 && n <= count)))
    return null
  return Array.from({ length: count }, (_, i) => ({
    lines: outputLines(texts[i + 1] ?? "", [], true),
    truncated: false,
  }))
}

/** The words above a statement's output whose start was left out. */
export const EARLIER_LINES = "… earlier lines left out"

/** A statement's output as drawn: its end, after a line saying its start was left out. */
const statementLines = (o: StatementOutput): readonly OutputLine[] =>
  detailOutput(o.truncated ? [plainLine(EARLIER_LINES), ...o.lines] : o.lines)

/** Everything a row draws but its tag and status. */
interface RowView {
  /** The intent it leads with, beside its tag (`rowLead`); null when it leads with its command. */
  readonly head: string | null
  /** Its intent, as a caption under its command, when it leads with the command; null for none. */
  readonly caption: string | null
  /** What the call touched, by line: its first lines, all of it in the detail, none in a summary led by its intent. */
  readonly command: readonly CommandLine[]
  readonly body: RowBody
  /** Why the detail shows a command's output whole, not by statement; null when it does not say. */
  readonly undividedNote: string | null
  /** The toggle's words; undefined when the summary hides nothing. */
  readonly more: string | undefined
}

/** What a summary hides, which its toggle names. */
interface Hidden {
  /** The command's lines left out; "all" when its intent stands for it. */
  readonly command: number | "all"
  /** The output's lines left out. */
  readonly output: number
  /** A line shown, of either, was cut at LINE_LENGTH. */
  readonly cut: boolean
  /** An image is drawn as a thumbnail. */
  readonly image: boolean
}

/** The toggle's words: what the summary hides, or "less" in the detail; undefined when it hides nothing. */
export function moreWords(hidden: Hidden, open: boolean): string | undefined {
  const lines = [
    ...(hidden.command === "all"
      ? ["command"]
      : hidden.command > 0
        ? [`+${plural(hidden.command, "line")}`]
        : []),
    ...(hidden.output > 0
      ? [`+${plural(hidden.output, "line")} of output`]
      : []),
  ]
  const parts = [
    ...lines,
    ...(hidden.cut && lines.length === 0 ? ["whole lines"] : []),
    ...(hidden.image ? ["full size"] : []),
  ]
  if (parts.length === 0) return undefined
  return open ? "less" : parts.join(" · ")
}

/**
 * What a row draws, from what its call touched (`rowSummary`), what it leads
 * with (`rowLead`), its output (`rowOutput`), its body, and whether the
 * reader opened its detail. Led by its intent, its summary shows no
 * command, and the output's last lines still, so a row draws the same
 * height before and after its result. Only the detail shows a split, and
 * only the detail says why there is none.
 */
export function rowView(
  summary: RowSummary,
  lead: RowLead,
  output: RowOutput,
  body: ToolBody,
  open: boolean,
): RowView {
  const byIntent = lead.kind === "intent"
  const { split } = output
  const inDetail = open && body.kind === "text" && isSplittable(summary)
  // A split for another count of statements is not this command's.
  const byStatement =
    inDetail && split !== null && split.length === summary.statements.length
  const outputsOf = (line: number): readonly (readonly OutputLine[])[] =>
    byStatement
      ? summary.statements.flatMap((st, i) => {
          const own = split[i]
          return st.last === line && own !== undefined && own.lines.length > 0
            ? [statementLines(own)]
            : []
        })
      : []
  const head = headLines(summary.whole)
  const tail: Cut<OutputRun> =
    body.kind === "text"
      ? tailLines(output.lines)
      : { lines: [], hidden: 0, cut: false }
  const tall =
    body.kind === "images" && body.images.some(i => i.height > THUMB_HEIGHT)
  const hidden: Hidden = {
    command: byIntent ? "all" : head.hidden,
    output: tail.hidden,
    cut: (!byIntent && head.cut) || tail.cut,
    image: tall,
  }
  return {
    head: byIntent ? lead.intent : null,
    caption: byIntent ? null : (summary.intent ?? null),
    command: (open ? linesOf(summary.whole) : byIntent ? [] : head.lines).map(
      (runs, i) => ({
        runs,
        startsStatement: summary.starts.includes(i),
        outputs: outputsOf(i),
      }),
    ),
    body:
      body.kind === "images"
        ? { ...body, thumb: !open && tall }
        : {
            kind: "text",
            // Split by statement, the output is under its statements.
            lines: byStatement
              ? []
              : open
                ? detailOutput(output.lines)
                : tail.lines,
          },
    undividedNote:
      inDetail && output.whyUndivided !== null
        ? undividedWords(output.whyUndivided)
        : null,
    more: moreWords(hidden, open),
  }
}
