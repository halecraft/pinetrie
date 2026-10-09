// interface/tool-row — how much of a tool call's row is shown, and what it
// shows, as pure rules: its summary from what the call touched
// (`rowSummary`, ADR-0114), its body from what it returned (`toolBody`).
//
// A row opens on its own, capped, for a call whose output streams for
// REVEAL_MS, so a fast command never flashes open, and for a result with an
// image (ADR-0051). Nothing but the reader closes it or shows it whole: a
// following column that grew for a row does not shrink when the call ends
// (S35).

import {
  BASH_TOOL,
  type ImageRef,
  type ToolCall,
  type ToolId,
  type ToolResult,
  toolIdOf,
} from "@pinetrie/core"
import { readShell, type ShellRole } from "@pinetrie/shell"
import { previewEnd, toolWord } from "./tool-words.ts"

/** How long a call's output streams before its row opens. */
export const REVEAL_MS = 500

/**
 * `closed`: the summary line. `capped`: opened by the work, its command and
 * output each scrolling in a capped box. `full`: opened by the reader, uncapped.
 */
export type RowSize = "closed" | "capped" | "full"

/** The reader's last choice, or null before they made one. */
export type ReaderChoice = "full" | "closed" | null

/**
 * What a row decides for itself. It outlives the row, kept by its call's id,
 * since a tab shown again mounts its columns anew (ADR-0049).
 */
export interface RowMemory {
  /** The call's output streamed for REVEAL_MS while this row was drawn. */
  readonly revealed: boolean
  readonly reader: ReaderChoice
}

/** A row never drawn before. */
export const NO_MEMORY: RowMemory = { revealed: false, reader: null }

export interface RowFacts extends RowMemory {
  /** Its result has an image. */
  readonly shows: boolean
}

export const rowSize = (f: RowFacts): RowSize =>
  f.reader ?? (f.revealed || f.shows ? "capped" : "closed")

/** A capped row is partly open already: a click shows the rest. */
export const click = (size: RowSize): "full" | "closed" =>
  size === "full" ? "closed" : "full"

/**
 * What an open row draws: a result's images in place of its text, whose
 * caption only says an image was read, or else its text or live output.
 * `note` is that text: the caption, and pi's note of a resize.
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

/** A status as its row's mark. */
export const CALL_MARK: Readonly<Record<CallStatus, string>> = {
  pending: "…",
  error: "✗",
  ok: "✓",
}

/** What a run of a summary is, for the page to colour. Only a shell command has runs other than plain. */
export type RunRole = ShellRole

/** Some of a summary's text, and what it is. */
export interface Run {
  readonly text: string
  readonly role: RunRole
}

/** What a row's summary shows. */
export interface RowSummary {
  /** The tool's word (`toolWord`). Absent when the call has no subject: its word is then its preview. */
  readonly tag: string | undefined
  /** The closed row: what the call touched, to its first line or `PREVIEW_LENGTH`. */
  readonly preview: readonly Run[]
  /** The open row, in the preview's place; undefined when it reads the same. */
  readonly whole: readonly Run[] | undefined
}

/**
 * How many columns a shell command is laid out to. An open command is one
 * box beside the tag, so every line has the room the tag leaves: a 28rem
 * column's row is 26.5rem, which less the ▶ and the tag is about 365px, or
 * 47 characters of the Mac's SF Mono at a row's .8rem (0.6em each).
 */
export const LAYOUT_WIDTH = 46

/** A subject's preview, and all of it. */
type View = (subject: string) => {
  readonly preview: readonly Run[]
  readonly whole: readonly Run[]
}

/** The runs to `at`, and "…" when the text goes on past it. */
function cutRuns(runs: readonly Run[], at: number, cut: boolean): Run[] {
  const out: Run[] = []
  let left = at
  for (const run of runs) {
    if (left <= 0) break
    out.push(
      run.text.length <= left ? run : { ...run, text: run.text.slice(0, left) },
    )
    left -= run.text.length
  }
  return cut ? [...out, { text: "…", role: "plain" }] : out
}

const plainView: View = subject => {
  const { at, cut } = previewEnd(subject)
  const runs: Run[] = [{ text: subject, role: "plain" }]
  return { preview: cutRuns(runs, at, cut), whole: runs }
}

/** A command, highlighted, and opened laid out when it is one long line. */
const shellView: View = subject => {
  const { spans, laidOut } = readShell(subject, LAYOUT_WIDTH)
  const { at, cut } = previewEnd(subject)
  return { preview: cutRuns(spans, at, cut), whole: laidOut ?? spans }
}

/**
 * The tools whose subject reads other than as plain text, by id; any other
 * reads plain. A later tool's own view (a read's range, an edit's diff)
 * joins here.
 */
const VIEWS: Readonly<Partial<Record<ToolId, View>>> = {
  [BASH_TOOL]: shellView,
}

const textOf = (runs: readonly Run[]) => runs.map(r => r.text).join("")

/** What a call's row shows in its summary, closed and open. Pure. */
export function rowSummary(call: ToolCall): RowSummary {
  const word = toolWord(call.name)
  if (call.subject === undefined)
    return {
      tag: undefined,
      preview: [{ text: word, role: "plain" }],
      whole: undefined,
    }
  const id = toolIdOf(call.name)
  const view = (id === undefined ? undefined : VIEWS[id]) ?? plainView
  const { preview, whole } = view(call.subject)
  return {
    tag: word,
    preview,
    whole: textOf(whole) === textOf(preview) ? undefined : whole,
  }
}
