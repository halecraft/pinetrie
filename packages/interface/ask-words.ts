// interface/ask-words — how an ask, its work and its outcome read.

import { type EntryId, firstLine, type WriterId } from "@pinetrie/core"
import {
  type AskOutcome,
  entryMessage,
  type TranscriptMessage,
  type TreeIndex,
} from "@pinetrie/threads"
import type { AskView } from "./ask-view.ts"
import { count, listPhrase, plural } from "./counts.ts"
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
  prompt: TranscriptMessage,
  nameOf: (writer: WriterId) => string,
): string {
  const line = firstLine(prompt.text, ASK_LINE)
  if (prompt.role !== "person") return line
  const who = nameOf(prompt.writer)
  return who === "" ? `"${line}"` : `${who}: "${line}"`
}

/** Ask `ask` as one line (`askWords`), or null for no ask or none drawn. */
export function askLine(
  index: TreeIndex,
  ask: EntryId | null,
  nameOf: (writer: WriterId) => string,
): string | null {
  const prompt = ask === null ? null : entryMessage(index, ask)
  return prompt === null ? null : askWords(prompt, nameOf)
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
 * · 7 files changed · 3 private files · 4m 12s · 2 problems". A part that is
 * zero is left out; problems come last. Tool calls are not counted: each is
 * a step's. A capsule's tooltip and a fold's line hold this
 * line.
 */
export function workWords(
  stats: WorkStats,
  nameOf: (writer: WriterId) => string,
): string {
  const from =
    stats.writers.length === 0
      ? ""
      : ` from ${listPhrase(stats.writers.map(nameOf))}`
  const took = stats.last - stats.first
  return [
    stats.people > 0 ? `${plural(stats.people, "message")}${from}` : "",
    stats.agent > 0 ? plural(stats.agent, "step") : "",
    stats.files.length > 0
      ? count(stats.files.length, "file changed", "files changed")
      : "",
    stats.private > 0 ? plural(stats.private, "private file") : "",
    stats.first > 0 && took >= 1000 ? durationWords(took) : "",
    stats.failed > 0 ? plural(stats.failed, "problem") : "",
    stats.concurrent > 0
      ? count(
          stats.concurrent,
          "overwrote someone else's shared file",
          "overwrote others' shared files",
        )
      : "",
    stats.unignored > 0
      ? count(
          stats.unignored,
          "generated file not ignored",
          "generated files not ignored",
        )
      : "",
    stats.leftovers > 0
      ? count(
          stats.leftovers,
          "file not saved to history",
          "files not saved to history",
        )
      : "",
  ]
    .filter(part => part !== "")
    .join(" · ")
}

/** Where an ask's counts are drawn: outline's line, or story's first fold. */
export type CountsAt = "line" | "fold"

/**
 * An ask's counts and outcome, in order, the parts drawn with " · " between them.
 * `planAskWork` (`ask-fold.ts`) is its only caller. `line` is outline's:
 * while its run lasts, what it does now and what its work holds; once
 * ended, how it ended and what its work holds. `fold` is story's first
 * fold: what its work holds, and how it ended. Neither holds the digest's
 * headline, which is drawn on its own (`AskDraw.summary`).
 */
export function foldWords(
  view: Pick<AskView, "running" | "work" | "outcome" | "live">,
  at: CountsAt,
): readonly string[] {
  const parts =
    at === "fold"
      ? [view.work, view.outcome]
      : [view.running ? view.live : view.outcome, view.work]
  return parts.filter((p): p is string => p !== null && p !== "")
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

/** How much of a column is drawn. */
export type Density = "outline" | "story" | "raw"

export const DENSITIES: readonly Density[] = ["outline", "story", "raw"]

/** The density control's labels, and what each draws. */
export const densityWords = (
  d: Density,
): { readonly label: string; readonly title: string } =>
  ({
    outline: {
      label: "brief",
      title: "people's messages, and one line for each ask",
    },
    story: {
      label: "story",
      title: "each ask's message, a summary, and the answer",
    },
    raw: { label: "everything", title: "every step the agent took" },
  })[d]

/** An ask's fold: what a press does, and its files' button. */
export const askFoldWords = (open: boolean): string =>
  open ? "hide the steps" : "show the steps"

/** An ask's files button's title. */
export const ASK_FILES_TITLE = "see what this changed"

/** The line where this device last left a thread. */
export const LEFT_WORDS = "since you were here"
