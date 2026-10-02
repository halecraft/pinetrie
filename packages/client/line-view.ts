// client/line-view — the integration line in the header (ADR-0060): what
// the host last read of it, decided as a value (`lineView`) and worded in one
// function (`lineWords`).

import type { LineAction, LineRecord } from "@pineta/core"

/** The line as the header shows it. */
export interface LineView {
  /** absent: no lanes of their own here; unset: no line yet. */
  readonly state: "absent" | "unset" | "set"
  /** The actions this page may offer: none on a host that admits others. */
  readonly actions: readonly LineAction[]
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
    /** This host takes `line` commands. */
    readonly commands: boolean
  }
}

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
        commands: false,
      },
    }
  const facts = {
    onto: record.onto,
    heads: record.heads.proposed,
    log: record.log.proposed,
    behind: record.yours.behind,
    ahead: record.yours.ahead,
    commands: record.commands,
  }
  if (record.commit === null)
    return {
      state: "unset",
      actions: record.commands ? ["setup"] : [],
      facts,
    }
  const landable =
    record.commands && record.yours.ahead !== null && record.yours.ahead > 0
  return { state: "set", actions: landable ? ["land"] : [], facts }
}

export interface LineWords {
  /** The header trigger's text, and its accessible name. */
  readonly trigger: string
  readonly label: string
  readonly heading: string
  /** Lines of fact, drawn above the actions. */
  readonly notes: readonly string[]
  readonly actions: readonly {
    readonly action: LineAction
    readonly label: string
  }[]
}

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

export function lineWords(view: LineView): LineWords {
  const { onto, heads, log, behind, ahead, commands } = view.facts
  if (view.state !== "set")
    return {
      trigger: "set up the line",
      label: "the integration line is not set up",
      heading: `No line yet: ${onto}`,
      notes: commands
        ? [
            `${onto} goes at your @-`,
            `your repo's immutable heads become: ${heads}`,
            `its log, so jj and jjui show the offers: ${log}`,
          ]
        : [`this host admits others: create ${onto} with jj on its machine`],
      actions: view.actions.map(action => ({
        action,
        label: "set up the line",
      })),
    }
  const notes = [
    behind > 0
      ? `your work is ${count(behind, "commit", "commits")} behind ${onto}: rebase onto it in jj`
      : `your work is on ${onto}`,
  ]
  return {
    trigger: `◆ ${onto}`,
    label: `the integration line, ${onto}`,
    heading: onto,
    notes,
    actions: view.actions.map(action => ({
      action,
      label: `land my work (${count(ahead ?? 0, "commit", "commits")})`,
    })),
  }
}
