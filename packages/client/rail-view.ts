// client/rail-view — the view's part of the rail's runs (`compactRail`). Pure.

import type { AgentRun, RunStats, WriterId } from "@pineta/core"
import { listOf, plural } from "./counts.ts"

/**
 * The messages this view draws on their own, never inside a run: thread
 * ends someone else follows, running lanes' tips, each open
 * column's end, and each thread end holding a card of yours, whose dot
 * carries its mark. A column's end is kept because a pinned column can end
 * mid-stretch: inside a run, half of it would be on the column's path and half
 * not, and where the column ends would not show.
 */
export function railKeep(input: {
  /** Thread ends others follow: the rings' keys. */
  readonly rings: ReadonlyMap<string, unknown>
  readonly activity: readonly AgentRun[]
  /** Each open column's end (`ColumnView.tipId`). */
  readonly ends: Iterable<string | null>
  /** Thread ends holding a card of yours (`CardMarks.ends`). */
  readonly cards: ReadonlySet<string>
}): ReadonlySet<string> {
  const keep = new Set([...input.rings.keys(), ...input.cards])
  for (const run of input.activity) keep.add(run.tip)
  for (const end of input.ends) if (end !== null) keep.add(end)
  return keep
}

/**
 * What a run holds, as its tooltip says it: "12 messages from Ada and Bea ·
 * 143 agent messages · 211 tool calls · 2 failed". Parts that are zero are
 * left out.
 */
export function runLabel(
  count: number,
  stats: RunStats,
  nameOf: (writer: WriterId) => string,
): string {
  const agent = count - stats.people
  const from =
    stats.writers.length === 0
      ? ""
      : ` from ${listOf(stats.writers.map(nameOf))}`
  return [
    stats.people > 0 ? `${plural(stats.people, "message")}${from}` : "",
    agent > 0 ? plural(agent, "agent message") : "",
    stats.calls > 0 ? plural(stats.calls, "tool call") : "",
    stats.failed > 0 ? `${stats.failed} failed` : "",
  ]
    .filter(part => part !== "")
    .join(" · ")
}

/** Who wrote a run's messages: the agent alone, people alone, or both. */
export type RunFill = "agent" | "people" | "mixed"

/**
 * A run's fill: hollow for the agent's work alone, solid for people alone,
 * half strength for both. Three states rather than a share: a small share
 * filled only the capsule's rounded end, which read as a drawing fault.
 */
export function runFill(count: number, stats: RunStats): RunFill {
  if (stats.people === 0) return "agent"
  return stats.people === count ? "people" : "mixed"
}

/**
 * The message a click `fraction` of the way down a run's capsule picks: the
 * one that far through the run. A capsule is drawn far shorter than its
 * messages, so this is approximate, one message per `1 / ids.length` of its
 * height. Null, a click with no point, picks the first.
 */
export function pickAt(
  ids: readonly [string, ...string[]],
  fraction: number | null,
): string {
  if (fraction === null) return ids[0]
  const i = Math.floor(fraction * ids.length)
  return ids[Math.min(ids.length - 1, Math.max(0, i))] ?? ids[0]
}

/** What a rail item marks besides its place: decided here, drawn by `Rail`. */
export interface RailMarks {
  /** On an open column's path: `data-open`. A run's first message speaks for it. */
  readonly open: boolean
  /** Your colour when an unsent card of yours waits here (ADR-0048), else null. */
  readonly yours: string | null
}

/** Each item's marks, read from its first message. */
export function railItems<I extends { readonly ids: readonly string[] }>(
  items: readonly I[],
  facts: {
    readonly open: ReadonlySet<string>
    readonly yours: {
      readonly ends: ReadonlySet<string>
      readonly color: string
    }
  },
): readonly (readonly [item: I, marks: RailMarks])[] {
  return items.map(item => {
    const id = item.ids[0] ?? ""
    return [
      item,
      {
        open: facts.open.has(id),
        yours: facts.yours.ends.has(id) ? facts.yours.color : null,
      },
    ] as const
  })
}
