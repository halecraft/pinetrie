// land — the prompt of a resolution run.

import { type Static, Type } from "typebox"
import { List, PointSchema, ThreadIdSchema, WriterIdSchema } from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"
import { leftOut } from "./request.ts"

export const LAND_TYPE = "pinetrie.land"

const LandDetailsSchema = Type.Object({
  lane: ThreadIdSchema,
  /** The state that was merged: accepted work's, a WIP's copy, or the parent's. */
  yours: List(PointSchema),
  /** The files that conflicted when it merged. */
  files: List(Type.String()),
  /** The skill the run followed, and a hash of its content; null with none found. */
  skill: Type.Union([
    Type.Object({ path: Type.String(), hash: Type.String() }),
    Type.Null(),
  ]),
  by: WriterIdSchema,
})

type LandDetails = Static<typeof LandDetailsSchema>

export const LAND = historyMessage(LAND_TYPE, LandDetailsSchema)

/** The pi `CustomMessage` a resolution's prompt is stored as. */
export type LandMessage = HistoryMessage<typeof LAND_TYPE, LandDetails>

/** A stored message -> its land details, or undefined if it is not one. */
export const decodeLand = LAND.decode

/** The one line a column shows for a land message. */
export const landLine = (d: LandDetails): string =>
  d.files.length === 0
    ? "✓ catching up: no conflicts"
    : `⚠ catching up: ${d.files.length} ${d.files.length === 1 ? "file conflicts" : "files conflict"}`

/** One side of a conflicted file, labelled: why it changed, as the tree says. */
interface Side {
  /** `ours`: the lane holding the merge (the destination); `theirs`: what comes in. */
  readonly label: "ours" | "theirs"
  /** Who is on this side, for the heading: "this thread", "your working copy". */
  readonly who: string
  /** Why this side changed the file, oldest first: attributed messages, or revision descriptions. */
  readonly reasons: readonly string[]
}

/** A conflicted file, as the resolution run is given it. */
export interface ConflictFile {
  readonly path: string
  /** Its whole content, with jj's conflict markers; the prompt may show less of it (`ConflictShown`). */
  readonly content: string
  readonly ours: Side
  readonly theirs: Side
}

/**
 * A prompt's limit, in the unit pi's compaction counts: the
 * prompt fits when `estimate` of its content is at most `tokens`.
 */
export interface PromptBudget {
  readonly tokens: number
  readonly estimate: (content: string) => number
}

/** The skill a resolution follows, read from your working copy. */
export interface LandSkill {
  readonly path: string
  readonly content: string
  readonly hash: string
}

/**
 * How much of each conflicted file a land message shows, fullest first. A
 * file shown less is read in the lane, where `jj resolve --list` lists them.
 */
export type ConflictShown = "whole" | "sections" | "names" | "count"

const SHOWN_FULLEST_FIRST = ["whole", "sections", "names"] as const

/** The ways that show each file, by its text or its name. */
type FileShown = (typeof SHOWN_FULLEST_FIRST)[number]

/** One conflict in a file: its lines with jj's markers, 1-based and inclusive. */
interface ConflictSection {
  readonly from: number
  readonly to: number
  readonly text: string
}

/**
 * Each conflict in `content`: from a line of seven or more `<` (followed by a
 * space or the line's end) to the next line of as many `>`. jj makes its
 * markers longer than seven when the file holds lines that look like them.
 * An unclosed conflict runs to the file's end.
 */
export function conflictSections(content: string): readonly ConflictSection[] {
  const lines = content.split("\n")
  const sections: ConflictSection[] = []
  let open: { readonly from: number; readonly marker: string } | null = null
  for (const [i, line] of lines.entries()) {
    if (open === null) {
      const start = /^(<{7,})(?: |$)/.exec(line)?.[1]
      if (start !== undefined)
        open = { from: i, marker: ">".repeat(start.length) }
    } else if (/^(>{7,})(?: |$)/.exec(line)?.[1] === open.marker) {
      sections.push(sectionOf(lines, open.from, i))
      open = null
    }
  }
  if (open !== null)
    sections.push(sectionOf(lines, open.from, lines.length - 1))
  return sections
}

const sectionOf = (
  lines: readonly string[],
  from: number,
  to: number,
): ConflictSection => ({
  from: from + 1,
  to: to + 1,
  text: lines.slice(from, to + 1).join("\n"),
})

declare const floorBrand: unique symbol

/**
 * The smallest land message (`count`) for a skill, an ask and whose work
 * came in, measured and within its budget. Only `resolutionFloor` makes one,
 * so a `planResolution` given one always has a message that fits.
 */
export interface Floor {
  readonly [floorBrand]: true
  readonly budget: PromptBudget
  readonly skill: LandSkill | null
  /** The card's text, trimmed: what the person wants done with the new work; "" for nothing. */
  readonly intent: string
  /** Whose work came in, as the model reads it: "Accepted work", a WIP's, or a thread's. */
  readonly incoming: string
  /** The `count` message's content. */
  readonly content: string
}

/** What `resolutionFloor` found: the floor, or how far over the budget it is. */
export type FloorFound =
  | { readonly kind: "fits"; readonly floor: Floor }
  | {
      readonly kind: "too-large"
      readonly tokens: number
      readonly budget: number
    }

const LIST_SENTENCE =
  "`jj resolve --list` in this thread's copy lists the files still conflicted: it, not this message, is what is left."

/**
 * The land message's opening, worded from what it shows. `count` states no
 * number: its text, measured before the merge as the floor, must be the
 * same whatever the merge leaves.
 */
function introOf(
  incoming: string,
  conflicts: number,
  shown: ConflictShown,
): string {
  const merged = `${incoming} was merged into this thread's own copy`
  if (shown === "count")
    return `${merged}, and files conflict. They are too many or too large to show here: read them in this thread's copy, and resolve them there. ${LIST_SENTENCE}`
  if (conflicts === 0)
    return `${merged} with no conflicts. Check that both sides still work together.`
  const head = `${merged}, and ${conflicts} ${conflicts === 1 ? "file conflicts" : "files conflict"}. Resolve them there.`
  switch (shown) {
    case "whole":
      return `${head} ${LIST_SENTENCE}`
    case "sections":
      return `${head} They are too large to show whole: each file below shows only its conflict sections. ${LIST_SENTENCE}`
    case "names":
      return `${head} They are too large to show: each file below is named only. ${LIST_SENTENCE}`
  }
}

/** The person's text under its own heading, after everything else. */
const askedOf = (intent: string): string =>
  intent === "" ? "" : `\n\n## What the person asked\n\n${intent}`

/** A land message's content from its parts; the person's text always last. */
const joined = (
  skill: LandSkill | null,
  intro: string,
  body: string,
  asked: string,
): string =>
  `${`${skill === null ? "" : `${skill.content.trim()}\n\n`}${intro}\n\n${body}`.trimEnd()}${asked}`

/**
 * The floor for a resolution: its `count` message, measured. Too large only
 * when the skill and the person's text alone overflow the budget; then the
 * caller refuses before it merges.
 */
export function resolutionFloor(input: {
  readonly budget: PromptBudget
  readonly skill: LandSkill | null
  readonly intent: string
  readonly incoming: string
}): FloorFound {
  const intent = input.intent.trim()
  const content = joined(
    input.skill,
    introOf(input.incoming, 0, "count"),
    "",
    askedOf(intent),
  )
  const tokens = input.budget.estimate(content)
  if (tokens > input.budget.tokens)
    return { kind: "too-large", tokens, budget: input.budget.tokens }
  const floor = { ...input, intent, content } as Floor
  return { kind: "fits", floor }
}

/** A side's newest `k` reasons, the older ones counted. */
function reasonLines(reasons: readonly string[], k: number): string {
  if (reasons.length === 0) return "- (no messages)\n"
  const kept = reasons.slice(Math.max(0, reasons.length - k))
  return (
    leftOut(reasons.length - kept.length) + kept.map(r => `- ${r}\n`).join("")
  )
}

/** A file's text as `shown` words it. */
function fileText(f: ConflictFile, shown: FileShown): string {
  switch (shown) {
    case "whole":
      return `\`\`\`\n${f.content}\n\`\`\``
    case "sections": {
      const sections = conflictSections(f.content)
      if (sections.length === 0)
        return "No conflict markers in its text: read it in this thread's copy."
      return [
        "Conflict sections only: read the rest in this thread's copy.",
        ...sections.map(
          s => `Lines ${s.from}–${s.to}:\n\n\`\`\`\n${s.text}\n\`\`\``,
        ),
      ].join("\n\n")
    }
    case "names":
      return "Not shown: read it in this thread's copy."
  }
}

/** A conflicted file in the land message: its text as shown, then both labelled sides with their newest `k` reasons. */
const renderFile = (f: ConflictFile, shown: FileShown, k: number): string =>
  `## ${f.path}\n\n${fileText(f, shown)}\n\n` +
  `### ${f.ours.label}: ${f.ours.who}\n${reasonLines(f.ours.reasons, k)}\n` +
  `### ${f.theirs.label}: ${f.theirs.who}\n${reasonLines(f.theirs.reasons, k)}\n`

/**
 * The land message for a resolution: the skill's text, then the conflicted
 * files with both sides labelled (the labels are always present and
 * the destination's side is never dropped), then what the person asked, the
 * text of the card that brought the thread up to date.
 *
 * It fits `floor.budget`, measured on the whole message. The
 * files are shown the fullest way that fits with each side's newest reason
 * (`ConflictShown`), the same way for every file; then each side keeps as
 * many newest reasons as fit. So the code gives way before the reasons do:
 * the agent can read the files in its lane again, and its own reasons may be
 * compacted away. When no way fits, the message is the floor's.
 */
export function planResolution(input: {
  readonly floor: Floor
  readonly files: readonly ConflictFile[]
  readonly details: Omit<LandDetails, "files" | "skill">
  readonly timestamp: number
}): LandMessage {
  const { floor, files } = input
  const asked = askedOf(floor.intent)
  const contentOf = (shown: FileShown, k: number) =>
    joined(
      floor.skill,
      introOf(floor.incoming, files.length, shown),
      files.map(f => renderFile(f, shown, k)).join("\n"),
      asked,
    )
  const fits = (content: string) =>
    floor.budget.estimate(content) <= floor.budget.tokens
  const most = Math.max(
    1,
    ...files.flatMap(f => [f.ours.reasons.length, f.theirs.reasons.length]),
  )
  const content = ((): string => {
    for (const shown of SHOWN_FULLEST_FIRST) {
      let best = contentOf(shown, 1)
      if (!fits(best)) continue
      for (let k = 2; k <= most; k++) {
        const next = contentOf(shown, k)
        if (!fits(next)) break
        best = next
      }
      return best
    }
    return floor.content
  })()
  return LAND.encode(
    {
      ...input.details,
      files: files.map(f => f.path),
      skill:
        floor.skill === null
          ? null
          : { path: floor.skill.path, hash: floor.skill.hash },
    },
    content,
    input.timestamp,
  )
}
