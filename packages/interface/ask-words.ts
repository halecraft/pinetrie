// interface/ask-words — how an ask, its work and its outcome read (ADR-0106).
// Pure. Each label is decided as a value elsewhere and worded here, once.

import {
  type AskOutcome,
  firstLine,
  type TranscriptMessage,
  type WriterId,
} from "@pinetrie/core"
import type { AskView } from "./ask-view.ts"
import { listOf, plural } from "./counts.ts"
import type { WorkStats } from "./work-stats.ts"

/** How long an ask's first line is shown. */
const ASK_LINE = 48

/**
 * An ask as one line: `Ada: "Fix the rail…"`. A person's message names its
 * writer by their name now; a land or stack message is its own short line.
 * The ask bar, the working mark's title, the rail's tooltip, outline's line
 * and the `↰ answering` reference all say it so.
 */
export function askWords(
  prompt: Pick<TranscriptMessage, "role" | "text" | "writer" | "author">,
  nameOf: (writer: WriterId) => string,
): string {
  const line = firstLine(prompt.text, ASK_LINE)
  if (prompt.role !== "chat") return line
  const who =
    prompt.writer === undefined ? (prompt.author ?? "") : nameOf(prompt.writer)
  return who === "" ? `"${line}"` : `${who}: "${line}"`
}

/** A span of time as it reads in a fold's line: "42s", "4m 12s", "2h 5m". */
export function durationWords(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/**
 * What some work holds, as one line: "12 messages from Ada and Bea · 38 steps
 * · 61 tool calls · 7 files · 4m 12s · 2 failed". A part that is zero is left
 * out; failures come last. A capsule's tooltip and a fold's line hold this
 * line.
 */
export function workWords(
  stats: WorkStats,
  nameOf: (writer: WriterId) => string,
): string {
  const from =
    stats.writers.length === 0
      ? ""
      : ` from ${listOf(stats.writers.map(nameOf))}`
  const took = stats.last - stats.first
  return [
    stats.people > 0 ? `${plural(stats.people, "message")}${from}` : "",
    stats.agent > 0 ? plural(stats.agent, "step") : "",
    stats.calls > 0 ? plural(stats.calls, "tool call") : "",
    stats.files.length > 0 ? plural(stats.files.length, "file") : "",
    stats.first > 0 && took >= 1000 ? durationWords(took) : "",
    stats.failed > 0 ? `${stats.failed} failed` : "",
  ]
    .filter(part => part !== "")
    .join(" · ")
}

/** A part of an ask's fold line, and whether a model wrote it (a digest's headline). */
export interface FoldPart {
  readonly text: string
  readonly byModel: boolean
}

/** Where an ask's summary is drawn: outline's line, or story's first fold. */
export type SummaryAt = "line" | "fold"

/**
 * An ask's summary, in order, the parts drawn with " · " between them.
 * `planAskWork` (`ask-fold.ts`) is its only caller. `line` is outline's:
 * while its run lasts, what it does now and what its work holds; once
 * ended, how it ended and what its work holds. It holds no headline, since
 * it is one line cut to the column's width: the digest is drawn whole under
 * it. `fold` is story's first fold: the headline, what its work holds, and
 * how it ended.
 */
export function foldWords(
  view: Pick<AskView, "running" | "headline" | "work" | "outcome" | "live">,
  at: SummaryAt,
): readonly FoldPart[] {
  const part = (text: string | null, byModel = false) =>
    text === null || text === "" ? [] : [{ text, byModel }]
  if (at === "fold")
    return [
      ...part(view.headline, true),
      ...part(view.work),
      ...part(view.outcome),
    ]
  return [...part(view.running ? view.live : view.outcome), ...part(view.work)]
}

/** How an ask ended, when that needs saying: a stop or a failure. */
export function outcomeWords(
  outcome: AskOutcome,
  nameOf: (writer: WriterId) => string,
): string | null {
  switch (outcome.kind) {
    case "stopped":
      return outcome.by === null
        ? "stopped"
        : `stopped by ${nameOf(outcome.by)}`
    case "failed": {
      const why = firstLine(outcome.error, 80)
      return why === "" ? "failed" : `failed: ${why}`
    }
    case "running":
    case "answered":
      return null
  }
}

/** How much of a column is drawn (ADR-0106). */
export type Density = "outline" | "story" | "raw"

export const DENSITIES: readonly Density[] = ["outline", "story", "raw"]

/** The density control's labels, and what each draws. */
export const densityWords = (
  d: Density,
): { readonly label: string; readonly title: string } =>
  ({
    outline: {
      label: "outline",
      title: "people's messages, and one line for each ask",
    },
    story: {
      label: "story",
      title: "each ask's message, its digest, and its last word",
    },
    raw: { label: "raw", title: "every message and tool row" },
  })[d]

/** The line where this device last left a thread. */
export const LEFT_WORDS = "since you were here"
