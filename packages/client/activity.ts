// client/activity — the footer's one menu of what needs you (ADR-0069,
// ADR-0077): how the threads you follow ended, work ready to add to the
// project, what is worth a read, mentions of you, and where the agent works.
// Decided as a value (`activityView`) and worded in one function
// (`activityWords`). The badge counts what needs you: the verdicts that do,
// the offers of threads you follow, and unseen mentions. What is worth a
// read is listed, not counted. Running work is a steady count beside it,
// since the tab, the column and the rail already show where the agent works.

import { count } from "./counts.ts"

/** The menu's groups, in the order they are drawn. */
export type ActivitySection =
  | "needsYou"
  | "ready"
  | "worthARead"
  | "mentions"
  | "working"

const ORDER: readonly ActivitySection[] = [
  "needsYou",
  "ready",
  "worthARead",
  "mentions",
  "working",
]

export interface ActivityView {
  /** What the badge counts: `needsYou`, `readyYours` and `unseen`. */
  readonly badge: number
  /** Verdicts that need you, on threads you follow (`attentionOf`). */
  readonly needsYou: number
  /** Threads with an open offer (`openOffers`), yours or not. */
  readonly ready: number
  /** Of them, those of threads you follow, not marked "not needed". */
  readonly readyYours: number
  /** Verdicts worth a read, on threads you follow. */
  readonly worthARead: number
  /** Mentions of you, seen or not. */
  readonly mentions: number
  readonly unseen: number
  /** Lanes the agent is working on, in any root (`runsHere`). */
  readonly working: number
  /** Each section with rows, or kept because the menu is open on it. */
  readonly sections: readonly ActivitySection[]
  /**
   * Nothing to list: the trigger is not drawn, except while its menu is open
   * (`Popover`'s `gone`).
   */
  readonly gone: boolean
}

export function activityView(input: {
  readonly needsYou: number
  readonly ready: number
  readonly readyYours: number
  readonly worthARead: number
  /** Mentions of you, seen or not: any keeps the inbox reachable. */
  readonly mentions: number
  readonly unseen: number
  readonly working: number
  /**
   * The sections shown when the menu opened, empty while it is closed: an
   * open menu keeps them until you close it (ADR-0030).
   */
  readonly kept: readonly ActivitySection[]
}): ActivityView {
  const rows: Record<ActivitySection, number> = {
    needsYou: input.needsYou,
    ready: input.ready,
    worthARead: input.worthARead,
    mentions: input.mentions,
    working: input.working,
  }
  const sections = ORDER.filter(s => rows[s] > 0 || input.kept.includes(s))
  return {
    badge: input.needsYou + input.readyYours + input.unseen,
    needsYou: input.needsYou,
    ready: input.ready,
    readyYours: input.readyYours,
    worthARead: input.worthARead,
    mentions: input.mentions,
    unseen: input.unseen,
    working: input.working,
    sections,
    gone: ORDER.every(s => rows[s] === 0),
  }
}

export interface ActivityWords {
  /** The trigger's accessible name and title. */
  readonly label: string
  /** The menu's own heading. */
  readonly heading: string
  /** Each section's heading: what it lists, or that it has emptied. */
  readonly sections: Readonly<Record<ActivitySection, string>>
}

export function activityWords(view: ActivityView): ActivityWords {
  const { badge, needsYou, ready, readyYours, worthARead, mentions } = view
  const { unseen, working } = view
  const what = [
    ...(needsYou > 0 ? [count(needsYou, "run ended", "runs ended")] : []),
    ...(readyYours > 0 ? [`${readyYours} ready to accept`] : []),
    ...(unseen > 0 ? [count(unseen, "unseen mention", "unseen mentions")] : []),
  ]
  const needs =
    badge === 0
      ? "nothing needs you"
      : `${count(badge, "thing needs", "things need")} you`
  const works =
    working === 0
      ? null
      : `the agent is working in ${count(working, "thread", "threads")}`
  const detail = what.length === 0 ? needs : `${needs}: ${what.join(", ")}`
  return {
    label: works === null ? detail : `${detail} · ${works}`,
    heading: badge === 0 ? "Nothing needs you" : needs,
    sections: {
      needsYou: needsYou > 0 ? "Needs you" : "Nothing needs you now.",
      ready: ready > 0 ? "Ready to accept" : "Nothing left to accept.",
      worthARead: worthARead > 0 ? "Worth a read" : "Nothing left to read.",
      mentions: mentions > 0 ? "Mentions of you" : "No one has mentioned you.",
      working:
        working > 0 ? "The agent is working in" : "The agent has finished",
    },
  }
}
