// title — a model's few words for a root, written as the root's mark
// (ADR-0045, ADR-0074): unasked when the root's first lane starts, or when a
// person asks for one (Auto-update title). The host carries the plan out
// (`apps/pinetrie/host/titles.ts`).

import {
  type AgentId,
  type EntryId,
  ERR,
  type LaneName,
  type LaneRecord,
  type MarkRecord,
  type Position,
  parseTitle,
  projectTranscript,
  type Refusal,
  type RootId,
  refused,
  summarizeRoots,
  THE_AGENT,
  type TreeIndex,
  type WriterId,
} from "@pinetrie/core"
import { type ModelRef, modelRef, recordOf } from "./config.ts"
import {
  bareLine,
  fitNewest,
  LEFT_OUT_NOTE,
  leftOut,
  transcriptLine,
  transcriptLines,
} from "./request.ts"

// ── the setting ───────────────────────────────────────────────────────────

interface TitleConfig {
  /** Whether a root is titled unasked. Auto-update title works either way. */
  readonly enabled: boolean
  /** The model titles are asked of; null for the run's. */
  readonly model: ModelRef | null
}

/**
 * The user config's `titles`: on unless `enabled` is `false`, and `model` is
 * `provider/id` (`modelRef`). Total: a malformed model is the run's.
 */
export function decodeTitleConfig(json: unknown): TitleConfig {
  const titles = recordOf(recordOf(json)?.titles)
  return {
    enabled: titles?.enabled !== false,
    model: modelRef(titles?.model) ?? null,
  }
}

// ── the decision ──────────────────────────────────────────────────────────

/** Why a title is asked for. */
export type TitleTrigger =
  /**
   * A lane was just created at `at`, for the message `prompt`. The prompt is
   * not in the tree yet: the run writes it.
   */
  | {
      readonly kind: "lane"
      readonly lane: LaneName
      readonly at: Position
      readonly prompt: { readonly author: string; readonly text: string }
    }
  /** A person asked (Auto-update title). */
  | { readonly kind: "asked"; readonly by: WriterId }

type TitlingPlan =
  | Refusal
  /** Nothing to ask. */
  | { readonly kind: "skip" }
  | {
      readonly kind: "ask"
      /** The messages to title, as transcript lines, oldest first. */
      readonly lines: readonly string[]
      readonly by: WriterId | AgentId
    }

/**
 * Pure. Whether to ask for `root`'s title, and from what. Unasked, only for
 * the root's first lane, with titles on, no mark, and none asked already:
 * from the messages above where the lane starts, and its prompt. Asked,
 * always, from the path to the root's newest message; refused for a root
 * with no message yet.
 */
export function planTitling(input: {
  readonly index: TreeIndex
  readonly root: RootId
  readonly marks: ReadonlyMap<EntryId, MarkRecord>
  /** Every lane's record: which lanes work in `root`. */
  readonly lanes: Iterable<LaneRecord>
  readonly trigger: TitleTrigger
  readonly enabled: boolean
  readonly inFlight: boolean
}): TitlingPlan {
  const { index, trigger } = input
  const summary = summarizeRoots(index)[0]
  if (trigger.kind === "asked") {
    if (summary === undefined)
      return refused(ERR.UNKNOWN_TARGET, "there is no message to title yet")
    return {
      kind: "ask",
      lines: transcriptLines(projectTranscript(index, summary.newest)),
      by: trigger.by,
    }
  }
  const first = [...input.lanes].every(
    l => l.root !== input.root || l.lane === trigger.lane,
  )
  const marked =
    summary !== undefined && input.marks.get(summary.root) !== undefined
  if (!input.enabled || !first || marked || input.inFlight)
    return { kind: "skip" }
  const above = projectTranscript(
    index,
    trigger.at.kind === "root" ? null : trigger.at.id,
  )
  return {
    kind: "ask",
    lines: [
      ...transcriptLines(above),
      transcriptLine({
        role: "chat",
        author: trigger.prompt.author,
        text: trigger.prompt.text,
      }),
    ],
    by: THE_AGENT,
  }
}

/** How a title request's text begins: a suite tells one from a commit message's by it. */
export const TITLE_REQUEST_HEAD = "How it began:"

/**
 * Pure. The request: the skill, the root's first message always, since it
 * usually says what the thread is for, then the newest that fit.
 */
export function titleRequest(input: {
  readonly skill: string
  readonly lines: readonly string[]
  readonly budget: number
}): { readonly system: string; readonly user: string } {
  const [first, ...rest] = input.lines
  const head = `${TITLE_REQUEST_HEAD}\n- ${(first ?? "").trim()}\n\n`
  const room = Math.max(0, input.budget - head.length)
  const { text, dropped } = fitNewest(rest, room - LEFT_OUT_NOTE)
  return {
    system: input.skill.trim(),
    user:
      rest.length === 0
        ? head
        : `${head}What was said since:\n${leftOut(dropped)}${text}`,
  }
}

/** The most words a title may have: the skill asks for one to three. */
const TITLE_WORDS = 5

/**
 * Pure. The model's reply as a title (`bareLine`). Null for a reply of more
 * than `TITLE_WORDS` words, or one `parseTitle` refuses (more than one line,
 * or too long): the root keeps its label. It never cuts a reply, which could
 * leave "Fixing the".
 */
export function titleOf(reply: string): string | null {
  const bare = bareLine(reply)
  if (bare.split(/\s+/).length > TITLE_WORDS) return null
  const parsed = parseTitle(bare)
  return parsed.kind === "set" ? parsed.title : null
}

/**
 * Pure. Whether a title that came back may be written over `stored`, the
 * root's mark now. One a person asked for always is. An unasked one gives
 * way to any mark written while it was asked.
 */
export const titleStillWanted = (
  stored: MarkRecord | undefined,
  by: WriterId | AgentId,
): boolean => by !== THE_AGENT || stored === undefined
