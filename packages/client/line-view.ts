// client/line-view — the integration line in the footer (ADR-0060), "the
// project" (ADR-0061), and publishing it (ADR-0076): what the host last read
// of it, decided as a value (`lineView`) and worded in one function
// (`lineWords`). Which actions may run is `@pinetrie/rules`' `lineActionState`,
// the rule the host decides commands by.

import {
  ERR,
  type LineAction,
  type LineRecord,
  type ProjectRecord,
} from "@pinetrie/core"
import {
  type LineActionState,
  lineActionState,
  lineRefusal,
} from "@pinetrie/rules"
import type { LineActing } from "@pinetrie/session"
import { count } from "./counts.ts"
import type { Intent } from "./intent.ts"
import { outcomeWords } from "./outcome-words.ts"

/**
 * What the project's menu may offer: a `line` command, or "resolve with the
 * agent", which opens a thread in your files and sends nothing yet.
 */
export type LineMenuAction = LineAction | "resolve"

/** The project's own actions, on every host. */
type ProjectAction = Extract<LineAction, "setup" | "publish">
/** What moves work between your files and the project: this machine's host only. */
type YoursAction = Extract<LineMenuAction, "resolve" | "follow" | "land">

/** The line as the header shows it. */
export interface LineView {
  /** absent: no lanes of their own here; unset: no line yet. */
  readonly state: "absent" | "unset" | "set"
  /** The project's own state, on every host: setting it up, publishing it. */
  readonly project: {
    readonly actions: readonly ProjectAction[]
    /** Whether publishing may run now, and if not, why. */
    readonly publish: LineActionState
  }
  /** Your files against the project: null on a host that admits others, or with no line. */
  readonly yours: { readonly actions: readonly YoursAction[] } | null
  readonly facts: Pick<
    LineRecord,
    "onto" | "publish" | "published" | "commands"
  > & {
    /** What setting up writes to your repo's `immutable_heads()`. */
    readonly heads: string
    /** What setting up writes to your repo's `revsets.log`. */
    readonly log: string
  } & LineRecord["yours"]
}

const NO_CONFLICTS = { commits: 0, files: [] }
const NOTHING: LineActionState = { kind: "refused", code: ERR.REFUSED }

export function lineView(record: LineRecord | null): LineView {
  if (record === null)
    return {
      state: "absent",
      project: { actions: [], publish: NOTHING },
      yours: null,
      facts: {
        onto: "",
        publish: "",
        published: { commit: null, behind: 0, ahead: 0 },
        commands: false,
        heads: "",
        log: "",
        behind: 0,
        ahead: null,
        follow: null,
        conflicts: NO_CONFLICTS,
      },
    }
  const facts = {
    onto: record.onto,
    publish: record.publish,
    published: record.published,
    commands: record.commands,
    heads: record.heads.proposed,
    log: record.log.proposed,
    ...record.yours,
  }
  const may = (action: LineAction) =>
    lineActionState(action, record).kind === "ok"
  const publish = lineActionState("publish", record)
  if (record.commit === null)
    return {
      state: "unset",
      project: { actions: may("setup") ? ["setup"] : [], publish },
      yours: null,
      facts,
    }
  const { conflicts } = record.yours
  const conflicted = conflicts.commits > 0 || conflicts.files.length > 0
  return {
    state: "set",
    project: { actions: publish.kind === "ok" ? ["publish"] : [], publish },
    yours: record.commands
      ? {
          actions: [
            ...(conflicted ? (["resolve"] as const) : []),
            ...(may("follow") ? (["follow"] as const) : []),
            ...(may("land") ? (["land"] as const) : []),
          ],
        }
      : null,
    facts,
  }
}

/** One section of the project's menu: what it says, then what it offers. */
export interface LineSection {
  readonly key: "project" | "yours"
  readonly heading: string
  /** Lines of fact, drawn above the actions. */
  readonly notes: readonly string[]
  readonly actions: readonly {
    readonly action: LineMenuAction
    readonly label: string
    /** What it does, in words and in jj. */
    readonly title?: string
  }[]
}

export interface LineWords {
  /** The header trigger's text. */
  readonly trigger: string
  /** Its accessible name and title, with the line's bookmark. */
  readonly label: string
  /** The project first, whose heading names the menu; your files after it. */
  readonly sections: readonly LineSection[]
}

/** Files named, the first three, then how many more: only files that conflict. */
const named = (files: readonly string[]): string =>
  files.length <= 3
    ? files.join(", ")
    : `${files.slice(0, 3).join(", ")} and ${files.length - 3} more`

/**
 * jjui's own `[revisions] revset` replaces `revsets.log`, so the log the
 * setup writes does not reach it (S77 item 8, `docs/the-jujutsu-repo.md`).
 */
const JJUI_NOTE =
  'jjui with a revset of its own: add | bookmarks(glob:"pinetrie-offer/*") to it'

const commits = (n: number) => count(n, "commit", "commits")

/** The project against its publish bookmark, and why publishing is not offered. */
function projectNotes(view: LineView): string[] {
  const { publish, published } = view.facts
  const state = view.project.publish
  if (state.kind === "refused" && state.code !== ERR.REFUSED)
    return [lineRefusal("publish", state.code, view.facts)]
  return published.behind === 0
    ? [`everything in the project is on ${publish}`]
    : [`${commits(published.behind)} not yet on ${publish}`]
}

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
      `${commits(conflicts.commits)} of yours ${conflicts.commits === 1 ? "has" : "have"} conflicts`,
    )
  if (behind === 0) {
    if (notes.length === 0)
      notes.push("your files have everything in the project")
    return notes
  }
  const fresh = `${count(behind, "new commit", "new commits")} in the project since you last updated`
  if (follow === null) {
    notes.push(`${fresh}: rebase onto ${onto} in jj`)
    return notes
  }
  notes.push(fresh)
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

/** An action on your files, labelled, with what it does as its title. */
function yoursAction(
  action: YoursAction,
  facts: LineView["facts"],
): LineSection["actions"][number] {
  const { onto, ahead, follow } = facts
  switch (action) {
    case "resolve":
      return { action, label: "resolve with the agent" }
    case "follow":
      return {
        action,
        label: "update my files",
        title: `changes ${count(follow?.changes ?? 0, "file", "files")} · your work stays on top · jj diff --from 'fork_point(@ | ${onto})' --to ${onto}`,
      }
    case "land":
      return {
        action,
        label: `add my work to the project (${commits(ahead ?? 0)})`,
        title: `moves ${onto} forward to your @-`,
      }
  }
}

export function lineWords(view: LineView): LineWords {
  const { onto, publish, published, heads, log, commands } = view.facts
  if (view.state !== "set") {
    const notSet = `the project is not set up: create ${onto} with jj on the host's machine`
    return {
      trigger: commands ? "set up the project" : "◆ project",
      label: commands ? `the project's line, ${onto}, is not set up` : notSet,
      sections: [
        {
          key: "project",
          heading: commands
            ? `Set up the project's line: ${onto}`
            : "The project",
          notes: commands
            ? [
                `${onto} goes at your @-`,
                `your repo's immutable heads become: ${heads}`,
                `its log, so jj and jjui show the offers: ${log}`,
                JJUI_NOTE,
              ]
            : ["the project is not set up yet"],
          actions: view.project.actions.map(action => ({
            action,
            label: "set up the project",
          })),
        },
      ],
    }
  }
  const where = `the project: where finished work is added, ${onto} in jj`
  // Unpublished work marks the trigger; your files being behind does not,
  // so ↓ keeps its one meaning on a column's header (ADR-0076).
  const unpublished = published.commit === null ? 0 : published.behind
  const project: LineSection = {
    key: "project",
    heading: "The project",
    notes: projectNotes(view),
    actions: view.project.actions.map(action => ({
      action,
      label: `publish to ${publish} (${commits(published.behind)})`,
      title: `moves ${publish} forward to ${onto}`,
    })),
  }
  const yours: LineSection | null =
    view.yours === null
      ? null
      : {
          key: "yours",
          heading: "Your files",
          notes: yourFiles(view.facts),
          actions: view.yours.actions.map(action =>
            yoursAction(action, view.facts),
          ),
        }
  return {
    trigger:
      unpublished > 0 ? `◆ project · ${unpublished} unpublished` : "◆ project",
    label:
      unpublished > 0
        ? `${where}; ${commits(unpublished)} not yet on ${publish}`
        : where,
    sections: yours === null ? [project] : [project, yours],
  }
}

/** What a line command in flight says, until the host answers. */
const LINE_SENDING: Record<LineAction, string> = {
  setup: "setting up the project…",
  land: "adding your work to the project…",
  follow: "updating your files…",
  publish: "publishing the project…",
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
      text: `/pinetrie:skill:resolve-conflicts My files were updated from the project (${facts.onto}) and conflict${facts.conflicts.files.length === 0 ? "" : ` in ${facts.conflicts.files.join(", ")}`}. Resolve them in my working copy.`,
      blank: false,
      work: { kind: "direct", dir: project.root },
    },
  }
}
