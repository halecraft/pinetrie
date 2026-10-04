// client/activity — the header's one menu of what needs you (ADR-0069): work
// ready to add to the project, mentions of you, and where the agent works.
// Decided as a value (`activityView`) and worded in one function
// (`activityWords`). The badge counts what needs you; running work is a
// steady count beside it, since the tab, the column and the rail already
// show where the agent works.

import { count } from "./counts.ts"

/** The menu's groups, in the order they are drawn. */
export type ActivitySection = "ready" | "mentions" | "working"

const ORDER: readonly ActivitySection[] = ["ready", "mentions", "working"]

export interface ActivityView {
  /** Open offers plus unseen mentions: what the badge counts. */
  readonly needsYou: number
  /** Threads with an open offer (`openOffers`). */
  readonly ready: number
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
  readonly ready: number
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
    ready: input.ready,
    mentions: input.mentions,
    working: input.working,
  }
  const sections = ORDER.filter(s => rows[s] > 0 || input.kept.includes(s))
  return {
    needsYou: input.ready + input.unseen,
    ready: input.ready,
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
  const { needsYou, ready, mentions, unseen, working } = view
  const what = [
    ...(ready > 0 ? [`${ready} ready to add`] : []),
    ...(unseen > 0 ? [count(unseen, "unseen mention", "unseen mentions")] : []),
  ]
  const needs =
    needsYou === 0
      ? "nothing needs you"
      : `${count(needsYou, "thing needs", "things need")} you`
  const works =
    working === 0
      ? null
      : `the agent is working in ${count(working, "thread", "threads")}`
  const detail = what.length === 0 ? needs : `${needs}: ${what.join(", ")}`
  return {
    label: works === null ? detail : `${detail} · ${works}`,
    heading: needsYou === 0 ? "Nothing needs you" : needs,
    sections: {
      ready: ready > 0 ? "Ready to add" : "Nothing left to add to the project.",
      mentions: mentions > 0 ? "Mentions of you" : "No one has mentioned you.",
      working:
        working > 0 ? "The agent is working in" : "The agent has finished",
    },
  }
}
