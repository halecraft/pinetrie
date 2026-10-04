// client/line-view — the integration line in the header (ADR-0060), "the
// project" (ADR-0061): what the host last read of it, decided as a value
// (`lineView`) and worded in one function (`lineWords`).

import type { LineAction, LineRecord, ProjectRecord } from "@pineta/core"
import type { LineActing } from "./acting.ts"
import { count } from "./counts.ts"
import type { Intent } from "./intent.ts"
import { outcomeWords } from "./outcome-words.ts"

/**
 * What the project's menu may offer: a `line` command, or "resolve with the
 * agent", which opens a thread in your files and sends nothing yet.
 */
export type LineMenuAction = LineAction | "resolve"

/** The line as the header shows it. */
export interface LineView {
  /** absent: no lanes of their own here; unset: no line yet. */
  readonly state: "absent" | "unset" | "set"
  /** The actions this page may offer: none on a host that admits others. */
  readonly actions: readonly LineMenuAction[]
  readonly facts: {
    readonly onto: string
    /** What setting up writes to your repo's `immutable_heads()`. */
    readonly heads: string
    /** What setting up writes to your repo's `revsets.log`. */
    readonly log: string
    /** Line commits your `@-` lacks. */
    readonly behind: number
    /** Your commits above the line; null when your `@-` is not above it. */
    readonly ahead: number | null
    /** What updating your files would do; null when it cannot or need not. */
    readonly follow: LineRecord["yours"]["follow"]
    /** Your conflicted commits above the line, and files in `@`. */
    readonly conflicts: LineRecord["yours"]["conflicts"]
    /** This host takes `line` commands. */
    readonly commands: boolean
  }
}

const NO_CONFLICTS = { commits: 0, files: [] }

export function lineView(record: LineRecord | null): LineView {
  if (record === null)
    return {
      state: "absent",
      actions: [],
      facts: {
        onto: "",
        heads: "",
        log: "",
        behind: 0,
        ahead: null,
        follow: null,
        conflicts: NO_CONFLICTS,
        commands: false,
      },
    }
  const { yours, commands } = record
  const facts = {
    onto: record.onto,
    heads: record.heads.proposed,
    log: record.log.proposed,
    behind: yours.behind,
    ahead: yours.ahead,
    follow: yours.follow,
    conflicts: yours.conflicts,
    commands,
  }
  if (record.commit === null)
    return { state: "unset", actions: commands ? ["setup"] : [], facts }
  const conflicted =
    yours.conflicts.commits > 0 || yours.conflicts.files.length > 0
  const actions: LineMenuAction[] = !commands
    ? []
    : [
        ...(conflicted ? (["resolve"] as const) : []),
        ...(yours.follow !== null ? (["follow"] as const) : []),
        ...(yours.ahead !== null && yours.ahead > 0 ? (["land"] as const) : []),
      ]
  return { state: "set", actions, facts }
}

export interface LineWords {
  /** The header trigger's text. */
  readonly trigger: string
  /** Its accessible name and title, with the line's bookmark. */
  readonly label: string
  readonly heading: string
  /** Lines of fact, drawn above the actions: where your files stand. */
  readonly notes: readonly string[]
  readonly actions: readonly {
    readonly action: LineMenuAction
    readonly label: string
  }[]
}

/** Files named, the first three, then how many more. */
const named = (files: readonly string[]): string =>
  files.length <= 3
    ? files.join(", ")
    : `${files.slice(0, 3).join(", ")} and ${files.length - 3} more`

/**
 * jjui's own `[revisions] revset` replaces `revsets.log`, so the log the
 * setup writes does not reach it (S77 item 8, `docs/the-jujutsu-repo.md`).
 */
const JJUI_NOTE =
  'jjui with a revset of its own: add | bookmarks(glob:"pineta-offer/*") to it'

/** Where your files stand against the project, a line each. */
function yourFiles(facts: LineView["facts"]): string[] {
  const { onto, behind, follow, conflicts } = facts
  const notes: string[] = []
  if (conflicts.files.length > 0)
    notes.push(
      `your files have conflicts in ${count(conflicts.files.length, "file", "files")}: ${named(conflicts.files)}`,
    )
  else if (conflicts.commits > 0)
    notes.push(
      `${count(conflicts.commits, "commit", "commits")} of yours ${conflicts.commits === 1 ? "has" : "have"} conflicts`,
    )
  if (behind === 0) {
    if (notes.length === 0)
      notes.push("your files have everything in the project")
    return notes
  }
  const missing = `the project has ${count(behind, "commit", "commits")} your files don't`
  if (follow === null) {
    notes.push(`${missing}: rebase onto ${onto} in jj`)
    return notes
  }
  notes.push(missing)
  notes.push(
    follow.files.length === 0
      ? "updating changes none of your files"
      : `updating changes ${count(follow.files.length, "file", "files")}: ${named(follow.files)}`,
  )
  if (follow.conflicts.length > 0)
    notes.push(
      `${count(follow.conflicts.length, "file", "files")} would conflict: ${named(follow.conflicts)}; the agent can resolve them after`,
    )
  if (follow.heads > 0)
    notes.push(
      `${count(follow.heads, "other line", "other lines")} of your work ${follow.heads === 1 ? "moves" : "move"} with it`,
    )
  return notes
}

export function lineWords(view: LineView): LineWords {
  const { onto, heads, log, ahead, commands } = view.facts
  if (view.state !== "set")
    return {
      trigger: "set up the project",
      label: `the project's line, ${onto}, is not set up`,
      heading: `Set up the project's line: ${onto}`,
      notes: commands
        ? [
            `${onto} goes at your @-`,
            `your repo's immutable heads become: ${heads}`,
            `its log, so jj and jjui show the offers: ${log}`,
            JJUI_NOTE,
          ]
        : [`this host admits others: create ${onto} with jj on its machine`],
      actions: view.actions.map(action => ({
        action,
        label: "set up the project",
      })),
    }
  const label = (action: LineMenuAction): string => {
    switch (action) {
      case "resolve":
        return "resolve with the agent"
      case "follow":
        return "update my files"
      case "land":
      case "setup":
        return `add my work to the project (${count(ahead ?? 0, "commit", "commits")})`
    }
  }
  const where = `the project: where finished work is added, ${onto} in jj`
  // Being behind marks this trigger only; the activity badge leaves it out
  // (ADR-0069).
  const behind = view.facts.behind
  return {
    trigger: behind > 0 ? "◆ project ↓" : "◆ project",
    label:
      behind > 0
        ? `${where}; it has ${count(behind, "commit", "commits")} your files don't`
        : where,
    heading: "The project",
    notes: yourFiles(view.facts),
    actions: view.actions.map(action => ({ action, label: label(action) })),
  }
}

/** What a line command in flight says, until the host answers. */
const LINE_SENDING: Record<LineAction, string> = {
  setup: "setting up the project…",
  land: "adding your work to the project…",
  follow: "updating your files…",
}

/**
 * What the project's menu says of your last command there: what it is doing
 * until the host answers, then why it was refused or that it failed
 * (`outcomeWords`); nothing once it was carried out, since the record then
 * says how things stand.
 */
export const lineNote = (acting: LineActing | null): string | null =>
  acting === null
    ? null
    : acting.kind === "sent"
      ? LINE_SENDING[acting.action]
      : outcomeWords(acting)

/**
 * "Resolve with the agent" (ADR-0061): a new agent tab whose thread works in
 * your files, its box holding the `resolve-conflicts` skill and what to
 * resolve, for you to send. Null without a project root to work in.
 */
export function resolveIntent(
  project: ProjectRecord | null,
  facts: LineView["facts"],
): Intent | null {
  if (project === null) return null
  return {
    kind: "newTab",
    asksAgent: true,
    prefill: {
      text: `/pineta:skill:resolve-conflicts My files were updated from the project (${facts.onto}) and conflict${facts.conflicts.files.length === 0 ? "" : ` in ${facts.conflicts.files.join(", ")}`}. Resolve them in my working copy.`,
      blank: false,
      work: { kind: "direct", dir: project.root },
    },
  }
}
