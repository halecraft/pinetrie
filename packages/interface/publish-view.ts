// interface/publish-view — the footer's one publish button (ADR-0090): what the
// host last read of accepted work, decided as a value (`publishView`), worded in
// one function (`publishWords`), and the toast a refusal or failure leaves
// (`publishToast`). Whether a command may run is `@pinetrie/rules`'
// `acceptedActionState`, the rule the host decides by.

import { type AcceptedRecord, ERR, type ProjectRecord } from "@pinetrie/core"
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
import type { Intent } from "./intent.ts"
import { outcomeWords } from "./outcome-words.ts"

/** The publish button as the footer shows it. */
export type PublishView =
  /** No lanes of their own here. */
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
      readonly record: AcceptedRecord
      readonly work: PublishWork
      /** Whether the host would carry it out now, and if not, why. */
      readonly state: AcceptedActionState
    }

export function publishView(record: AcceptedRecord | null): PublishView {
  if (record === null) return { kind: "absent" }
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
 * setup writes does not reach it (S77 item 8, `docs/the-jujutsu-repo.md`).
 */
const JJUI_NOTE =
  'jjui with a revset of its own: add | bookmarks(glob:"pinetrie-offer/*") to it'

/** The button's text, and its title: what it does, in words and in jj, a refusal first. */
export type PublishWords =
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
function publishSays(record: AcceptedRecord, work: PublishWork): string {
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
      `catches your files up with accepted work (changes ${count(preview?.changes ?? 0, "file", "files")}${moves})`,
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
  // With the setting off, your files behind or your commits below `@` would
  // otherwise read as left out by mistake.
  const { behind, ahead } = record.yours
  const unmoved =
    !record.catchUp && (behind > 0 || ahead > 0)
      ? "; your files do not move (offers.catchUp is off)"
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
        `its log, so jj and jjui show the offers: ${view.log}`,
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

/** What a toast says of your last setup or publish command: its refusal or failure. */
export interface PublishToast {
  readonly text: string
  /** Offer "resolve with the agent": your files conflict. */
  readonly resolve: boolean
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
    : {
        text: outcomeWords(acting),
        resolve:
          acting.kind === "refused" && acting.code === ERR.YOURS_CONFLICT,
      }

/**
 * "Resolve with the agent" (ADR-0061, ADR-0090): a new agent tab whose
 * thread works in your files, its box holding the `resolve-conflicts` skill
 * and what to resolve, for you to send. Null without a project root to work
 * in, or a line.
 */
export function resolveIntent(
  project: ProjectRecord | null,
  record: AcceptedRecord | null,
): Intent | null {
  if (project === null || record === null) return null
  const { acceptedBookmark, yours } = record
  const { files } = yours.conflicts
  const would = yours.catchUp?.conflicts ?? []
  // Conflicted files now come first; else, behind, the conflict is the
  // catch-up's, before or after a reverted one; else your commits'.
  const text =
    files.length > 0
      ? `My files have conflicts in ${files.join(", ")}. Resolve them in my working copy.`
      : yours.behind > 0
        ? `Catching my files up with accepted work (${acceptedBookmark}) conflicts${would.length === 0 ? "" : ` in ${would.join(", ")}`}. Rebase my work onto it (jj rebase -b @ -d ${acceptedBookmark}) and resolve the conflicts in my working copy.`
        : "My commits have conflicts. Resolve them in my working copy."
  return {
    kind: "newTab",
    asksAgent: true,
    prefill: {
      text: `/pinetrie:skill:resolve-conflicts ${text}`,
      blank: false,
      work: { kind: "direct", dir: project.root },
    },
  }
}
