// interface/publish-view — the footer's one publish button: what the host last
// read of accepted work, decided as a value (`publishView`), worded in one
// function (`publishWords`), and the toast a refusal or failure leaves
// (`publishToast`). Whether a command may run is `@pinetrie/rules`'
// `acceptedActionState`, the rule the host decides by.

import type { AcceptedRecord, JjAcceptedRecord } from "@pinetrie/core"
import {
  type AcceptedActionState,
  acceptedActionState,
  acceptedRefusal,
  nothingToPublish,
  type PublishWork,
  publishWork,
} from "@pinetrie/rules"
import type { AcceptedActing } from "@pinetrie/session"
import { count } from "./counts.ts"
import { outcomeWords } from "./outcome-words.ts"
import { hashOfPage } from "./page.ts"

/** The publish button as the footer shows it. */
type PublishView =
  /**
   * No lanes of their own here, or a folder project: its folder is
   * accepted work, with nothing to set up or publish to; its history takes
   * the button's place (`historyLink`).
   */
  | { readonly kind: "absent" }
  /** Set up, with nothing to publish. */
  | { readonly kind: "hidden" }
  /** No line yet: what setting it up writes. */
  | {
      readonly kind: "setup"
      readonly acceptedBookmark: string
      readonly heads: string
      readonly log: string
    }
  | {
      readonly kind: "publish"
      readonly record: JjAcceptedRecord
      readonly work: PublishWork
      /** Whether the host would carry it out now, and if not, why. */
      readonly state: AcceptedActionState
    }

/** The footer's way to a folder project's history, in the publish button's place; null for any other project. */
export function historyLink(
  record: AcceptedRecord | null,
): { readonly label: string; readonly hash: string } | null {
  return record?.kind === "folder"
    ? { label: "history", hash: hashOfPage("history") }
    : null
}

export function publishView(record: AcceptedRecord | null): PublishView {
  if (record === null || record.kind === "folder") return { kind: "absent" }
  if (record.commit === null)
    return {
      kind: "setup",
      acceptedBookmark: record.acceptedBookmark,
      heads: record.heads.proposed,
      log: record.log.proposed,
    }
  const work = publishWork(record)
  if (nothingToPublish(work)) return { kind: "hidden" }
  return {
    kind: "publish",
    record,
    work,
    state: acceptedActionState("publish", record),
  }
}

/**
 * jjui's own `[revisions] revset` replaces `revsets.log`, so the log the
 * setup writes does not reach it (`docs/the-jujutsu-repo.md`).
 */
const JJUI_NOTE =
  'jjui with a revset of its own: add | bookmarks(glob:"pinetrie-proposed/*") to it'

/** The button's text, and its title: what it does, in words and in jj, a refusal first. */
type PublishWords =
  | {
      readonly kind: "publish"
      readonly label: string
      readonly title: string
      /** The host would refuse it: the button is marked. */
      readonly refused: boolean
    }
  | {
      readonly kind: "setup"
      readonly label: string
      readonly title: string
      /** Setting up's confirmation: its heading and what it writes. */
      readonly heading: string
      readonly notes: readonly string[]
    }

const commits = (n: number) => count(n, "commit", "commits")

/** What a publish does, in order, and the jj that does it. */
function publishSays(record: JjAcceptedRecord, work: PublishWork): string {
  const { acceptedBookmark, publish } = record
  const steps: string[] = []
  const jj: string[] = []
  const preview = record.yours.catchUp
  if (work.catchUp) {
    const moves =
      preview === null || preview.heads === 0
        ? ""
        : `; ${count(preview.heads, "other line", "other lines")} of your work ${preview.heads === 1 ? "moves" : "move"} with it`
    steps.push(
      `catches the working copy up with accepted work (changes ${count(preview?.changes ?? 0, "file", "files")}${moves})`,
    )
    jj.push(`jj rebase -b @ -d ${acceptedBookmark}`)
  }
  if (work.yours > 0) {
    steps.push(`accepts your ${commits(work.yours)}`)
    jj.push(`jj bookmark move ${acceptedBookmark} ${publish} --to @-`)
  } else jj.push(`jj bookmark move ${publish} --to ${acceptedBookmark}`)
  steps.push(
    work.acceptedCommits > 0
      ? `moves ${publish} forward over ${count(work.acceptedCommits, "accepted commit", "accepted commits")}`
      : `moves ${publish} forward`,
  )
  const said =
    steps.length === 1
      ? steps.join("")
      : `${steps.slice(0, -1).join(", ")}, then ${steps.at(-1) ?? ""}`
  // With the setting off, the working copy behind or your commits below `@` would
  // otherwise read as left out by mistake.
  const { behind, ahead } = record.yours
  const unmoved =
    !record.publishCatchesUp && (behind > 0 || ahead > 0)
      ? "; the working copy does not move (publish.catchUp is off)"
      : ""
  return `${said}${unmoved} · ${jj.join("; ")}`
}

/** What a setup or publish in flight says on the button, until the host answers. */
const SENDING = { setup: "setting up…", publish: "publishing…" } as const

export function publishWords(
  view: Exclude<PublishView, { readonly kind: "absent" | "hidden" }>,
  acting: AcceptedActing | null,
): PublishWords {
  const sending = acting?.kind === "sent" ? SENDING[acting.action] : null
  if (view.kind === "setup")
    return {
      kind: "setup",
      label: sending ?? "set up",
      title: `set up accepted work, where finished work goes: ${view.acceptedBookmark} in jj`,
      heading: `Set up accepted work: ${view.acceptedBookmark}`,
      notes: [
        `${view.acceptedBookmark} goes at your @-`,
        `your repo's immutable heads become: ${view.heads}`,
        `its log, so jj and jjui show threads' changes: ${view.log}`,
        JJUI_NOTE,
      ],
    }
  const says = publishSays(view.record, view.work)
  return {
    kind: "publish",
    label: sending ?? "publish",
    title:
      view.state.kind === "refused"
        ? `${acceptedRefusal("publish", view.state.code, view.record)} · ${says}`
        : says,
    refused: view.state.kind === "refused",
  }
}

/**
 * What a toast says of your last setup or publish command: its refusal or
 * failure. A conflict in the working copy is said, and left to jj.
 */
interface PublishToast {
  readonly text: string
}

/**
 * The toast your last setup or publish command leaves (`outcomeWords`): none while it is
 * out, or once it was carried out, since the button then says how things
 * stand.
 */
export const publishToast = (
  acting: AcceptedActing | null,
): PublishToast | null =>
  acting === null || acting.kind === "sent"
    ? null
    : { text: outcomeWords(acting) }
