// host/titles — a root's title from a model (ADR-0074): unasked as the
// root's first lane starts, or when a person asks (Auto-update title).
// `planTitling` and `titleStillWanted` decide; this carries them out.
//
// Both are called inside a command's step on the documents' keeper, so they
// gather and plan there, and only the request goes outside it
// (`requestOutside`). The mark is written in a step of its own.

import { subscribe } from "@kyneta/schema"
import {
  type EntryId,
  type LaneName,
  type Position,
  type Refusal,
  type RootId,
  summarizeRoots,
  type WriterId,
} from "@pinetrie/core"
import type { Keeper } from "@pinetrie/keeper"
import type { PiSetup, Scribe } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readArchived,
  readLaneRecords,
  readMarks,
  readTreeIndex,
} from "@pinetrie/reads"
import {
  archivedIn,
  MARK,
  planMark,
  planTitling,
  setRecord,
  type TitleTrigger,
  titleOf,
  titleRequest,
  titleStillWanted,
} from "@pinetrie/rules"
import type { RootDocHandle } from "@pinetrie/schema"
import { type Basics, failed } from "./basics.ts"
import { requestOutside } from "./outside.ts"

/** A title request's size: the skill aside, the first message and the newest. */
const TITLE_BUDGET = 6_000

/**
 * How long an unasked title waits for its root's first entry. The run
 * writes the prompt after the lane starts, and a fast model can answer
 * first; a run that never writes one leaves the root untitled.
 */
const ROOTED_WAIT = 30_000

export interface Titles {
  /**
   * A lane was just created in `root` at `at`, for `prompt`, which the run
   * writes: its title, when it is the root's first lane and titles are on.
   */
  laneStarted(input: {
    readonly root: RootId
    readonly lane: LaneName
    readonly at: Position
    readonly prompt: { readonly author: string; readonly text: string }
  }): Promise<void>
  /** Auto-update title: `retitling`, or refused for a root with no message. */
  asked(root: RootId, by: WriterId): Promise<Outcome>
}

const rootEntryOf = (doc: RootDocHandle): EntryId | null =>
  summarizeRoots(readTreeIndex(doc))[0]?.root ?? null

/** `doc`'s root entry once it has one, or null after `ms`. */
function whenRooted(doc: RootDocHandle, ms: number): Promise<EntryId | null> {
  const now = rootEntryOf(doc)
  if (now !== null) return Promise.resolve(now)
  return new Promise(resolve => {
    const done = (entry: EntryId | null) => {
      stop()
      clearTimeout(timer)
      resolve(entry)
    }
    const stop = subscribe(doc.entries, () => {
      const entry = rootEntryOf(doc)
      if (entry !== null) done(entry)
    })
    const timer = setTimeout(() => done(null), ms)
  })
}

export function createTitles(deps: {
  readonly basics: Pick<Basics, "session" | "docs" | "log" | "now">
  readonly keeper: Pick<Keeper, "run" | "track">
  /** The user config's `titles.enabled`: whether a root is titled unasked. */
  readonly enabled: boolean
  readonly scribe: Pick<Scribe, "writeValues">
  /** The title model, and its skill. */
  readonly piSetup: Pick<PiSetup, "complete" | "skill">
  /** How long an unasked title waits for its root's first entry; tests shorten it. */
  readonly rootedWait?: number
}): Titles {
  const { basics, keeper } = deps
  const { session, log } = basics
  // Roots an unasked title is being asked for.
  const asking = new Set<RootId>()

  /**
   * Gather and plan in the caller's step; ask outside it, then write in a
   * step of its own. Returns the refusal, or null once asked or skipped.
   */
  async function consider(
    root: RootId,
    trigger: TitleTrigger,
  ): Promise<Refusal | null> {
    const doc = await basics.docs.root(root)
    const plan = planTitling({
      index: readTreeIndex(doc),
      root,
      marks: readMarks(doc),
      lanes: readLaneRecords(session).values(),
      trigger,
      enabled: deps.enabled,
      inFlight: asking.has(root),
    })
    if (plan.kind === "refused") return plan
    if (plan.kind === "skip") return null
    const { by } = plan
    void requestOutside({
      keeper,
      ...(trigger.kind === "lane" ? { held: { set: asking, key: root } } : {}),
      failed: failed(basics, "titling a thread"),
      request: async () => {
        const skill = await deps.piSetup.skill("pinetrie:skill:tab-title")
        if (skill === null) {
          log("[host] no tab-title skill")
          return null
        }
        const reply = await deps.piSetup.complete({
          ...titleRequest({
            skill: skill.content,
            lines: plan.lines,
            budget: TITLE_BUDGET,
          }),
          purpose: "title",
        })
        if (reply === null) return null
        const title = titleOf(reply)
        if (title === null) {
          log(`[host] the model's title is not one: ${JSON.stringify(reply)}`)
          return null
        }
        const entry = await whenRooted(doc, deps.rootedWait ?? ROOTED_WAIT)
        return entry === null ? null : { entry, title }
      },
      settle: async ({ entry, title }) => {
        // An archived root takes no writes (ADR-0029).
        if (archivedIn([root], readArchived(session)) !== null) return
        const marks = readMarks(doc)
        if (!titleStillWanted(marks.get(entry), by)) return
        const planned = planMark({
          entry,
          title,
          by,
          now: basics.now(),
          index: readTreeIndex(doc),
          marks,
        })
        if (planned.kind === "write")
          await deps.scribe.writeValues([setRecord(MARK, planned.record, root)])
      },
    })
    return null
  }

  return {
    laneStarted: async ({ root, ...started }) => {
      await consider(root, { kind: "lane", ...started })
    },
    asked: async (root, by) =>
      (await consider(root, { kind: "asked", by })) ?? { kind: "retitling" },
  }
}
