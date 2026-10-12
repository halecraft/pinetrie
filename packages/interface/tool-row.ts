// interface/tool-row — what a tool call's row shows: what the call touched
// (`rowSummary`), and how much of it and of what it returned the row draws
// (`rowView`).
//
// A row is its summary or its detail. The summary shows the command's first
// SUMMARY_LINES lines and the output's last, so the live output and the result
// that replaces it draw the same height; only the reader opens the detail,
// which shows both whole.

import {
  BASH_TOOL,
  type ImageRef,
  type StreamId,
  streamStart,
  type ToolCall,
  type ToolId,
  type ToolResult,
  toolIdOf,
} from "@pinetrie/core"
import { readShell, type ShellRole } from "@pinetrie/shell"
import { elapsed, plural } from "./counts.ts"
import { toolWord } from "./tool-words.ts"

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
export type ToolBody =
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
export type CallStatus = "pending" | "error" | "ok"

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

/** What a run of a command is, for the page to colour. Only a shell command has runs other than plain. */
export type RunRole = ShellRole

/** Some of a command's text, and what it is. */
export interface Run {
  readonly text: string
  readonly role: RunRole
}

/** What a call touched, as a row shows it. */
export interface RowSummary {
  /** The tool's word (`toolWord`). Absent when the call has no subject: its word is then its command. */
  readonly tag: string | undefined
  /** All of what the call touched: a shell command highlighted, and laid out when it is one long line. */
  readonly whole: readonly Run[]
}

/**
 * How many columns a shell command is laid out to. A command has its row's
 * whole width: a 28rem column's row is 26.5rem, 424px, which is 55 characters
 * of the Mac's SF Mono at a row's .8rem (0.6em each). Only its first line runs
 * beside the tag and status, and wraps once when long.
 */
export const LAYOUT_WIDTH = 55

/** The tools whose subject reads other than as plain text, by id; any other reads plain. */
const VIEWS: Readonly<Partial<Record<ToolId, (subject: string) => Run[]>>> = {
  [BASH_TOOL]: subject => {
    const { spans, laidOut } = readShell(subject, LAYOUT_WIDTH)
    return [...(laidOut ?? spans)]
  },
}

/** What a call's row shows of what it touched; a row keeps it for its call. */
export function rowSummary(call: ToolCall): RowSummary {
  const word = toolWord(call.name)
  if (call.subject === undefined)
    return { tag: undefined, whole: [{ text: word, role: "plain" }] }
  const id = toolIdOf(call.name)
  const view = id === undefined ? undefined : VIEWS[id]
  return {
    tag: word,
    whole: view?.(call.subject) ?? [{ text: call.subject, role: "plain" }],
  }
}

/** Lines a summary shows of a command, and of its output. */
export const SUMMARY_LINES = 5
/** The most of one line a summary shows. */
export const LINE_LENGTH = 160
/** The most of a result the detail draws: its end. */
export const SHOWN = 20_000
/** The tallest image a summary draws at its own size, in CSS px: 10rem, as `.tool-images[data-thumb]` caps it. */
export const THUMB_HEIGHT = 160

type Line = readonly Run[]

/** Runs as lines as written; a run across a break is split, each part keeping its role. A final break ends a line, and starts none. */
function linesOf(runs: readonly Run[]): Line[] {
  const lines: Run[][] = [[]]
  for (const run of runs) {
    const parts = run.text.split("\n")
    parts.forEach((text, i) => {
      if (i > 0) lines.push([])
      if (text !== "") lines.at(-1)?.push({ text, role: run.role })
    })
  }
  if (lines.length > 1 && lines.at(-1)?.length === 0) lines.pop()
  return lines.length === 1 && lines[0]?.length === 0 ? [] : lines
}

/** One line, cut at LINE_LENGTH with "…". */
function cutLine(line: Line): Line {
  if (lengthOf(line) <= LINE_LENGTH) return line
  const out: Run[] = []
  let left = LINE_LENGTH
  for (const run of line) {
    if (left <= 0) break
    out.push(
      run.text.length <= left ? run : { ...run, text: run.text.slice(0, left) },
    )
    left -= run.text.length
  }
  return [...out, { text: "…", role: "plain" }]
}

const lengthOf = (line: Line) => line.reduce((n, r) => n + r.text.length, 0)

/** Lines joined back into runs, a plain break between each, and a run following one of its role merged into it. */
function joinLines(lines: readonly Line[]): Run[] {
  const out: Run[] = []
  const add = (run: Run) => {
    const last = out.at(-1)
    if (last?.role === run.role)
      out[out.length - 1] = { ...last, text: last.text + run.text }
    else out.push(run)
  }
  lines.forEach((line, i) => {
    if (i > 0) add({ text: "\n", role: "plain" })
    for (const run of line) add(run)
  })
  return out
}

/** Some of a text's lines, and what the cut hides. */
export interface Cut {
  readonly runs: readonly Run[]
  /** Lines left out. */
  readonly hidden: number
  /** A line shown was cut at LINE_LENGTH. */
  readonly cut: boolean
}

/** Some of `all`'s lines, each cut at LINE_LENGTH, and what the cut leaves out. */
function cutOf(all: readonly Line[], lines: readonly Line[]): Cut {
  return {
    runs: joinLines(lines.map(cutLine)),
    hidden: all.length - lines.length,
    cut: lines.some(l => lengthOf(l) > LINE_LENGTH),
  }
}

/** The first SUMMARY_LINES lines of runs as written, each cut at LINE_LENGTH. */
export function headLines(runs: readonly Run[]): Cut {
  const lines = linesOf(runs)
  return cutOf(lines, lines.slice(0, SUMMARY_LINES))
}

/** The last SUMMARY_LINES lines of runs as written, each cut at LINE_LENGTH. */
export function tailLines(runs: readonly Run[]): Cut {
  const lines = linesOf(runs)
  return cutOf(lines, lines.slice(-SUMMARY_LINES))
}

/** The detail's output: whole, or its last SHOWN characters after a line counting the rest. */
export function wholeOutput(text: string): string {
  if (text.length <= SHOWN) return text
  const left = text.length - SHOWN
  return `… ${plural(left, "earlier character")}\n${text.slice(left)}`
}

/** What a row's body draws: its output's text, or its images. */
export type RowBody =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "images"
      readonly images: readonly ImageRef[]
      readonly note: string
      /** Drawn THUMB_HEIGHT tall at most, not at its own size. */
      readonly thumb: boolean
    }

/** Everything a row draws but its tag and status. */
export interface RowView {
  /** What the call touched, its head or whole. */
  readonly command: readonly Run[]
  readonly body: RowBody
  /** The toggle's words; undefined when the summary hides nothing. */
  readonly more: string | undefined
}

/** What a summary hides, which its toggle names. */
export interface Hidden {
  /** The command's lines left out. */
  readonly command: number
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
    ...(hidden.command > 0 ? [`+${plural(hidden.command, "line")}`] : []),
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

const textOf = (runs: readonly Run[]) => runs.map(r => r.text).join("")

/**
 * What a row draws, from what its call touched (`rowSummary`), its output's
 * text (the live stream's, or the result's), its body, and whether the
 * reader opened its detail.
 */
export function rowView(
  summary: RowSummary,
  output: string,
  body: ToolBody,
  open: boolean,
): RowView {
  const head = headLines(summary.whole)
  const tail =
    body.kind === "text"
      ? tailLines([{ text: output, role: "plain" }])
      : { runs: [], hidden: 0, cut: false }
  const tall =
    body.kind === "images" && body.images.some(i => i.height > THUMB_HEIGHT)
  const hidden: Hidden = {
    command: head.hidden,
    output: tail.hidden,
    cut: head.cut || tail.cut,
    image: tall,
  }
  return {
    command: open ? summary.whole : head.runs,
    body:
      body.kind === "images"
        ? { ...body, thumb: !open && tall }
        : {
            kind: "text",
            text: open ? wholeOutput(output) : textOf(tail.runs),
          },
    more: moreWords(hidden, open),
  }
}
