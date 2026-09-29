// land — the prompt of a resolution run (ADR-0033, ADR-0038).
//
// An update that conflicts merges your work into a lane, in the lane's own
// copy, and the agent then resolves what conflicts. The run starts with a land
// message: a pi
// `CustomMessage`, like chat, whose `content` is what the model reads (the
// resolution skill and the conflict material) and whose `details` are what the
// column shows (one short line, and the files). The model never reads the
// details; the column never shows the content.

import {
  type CommitId,
  commitId,
  type LaneName,
  type WriterId,
} from "@pineta/core"
import { type Static, Type } from "typebox"
import { decodeWith } from "./decode.ts"

export const LAND_TYPE = "pineta.land"

const LandDetailsSchema = Type.Object({
  /** The resolution's id: its record takes it when the run ends. */
  landing: Type.String({ minLength: 1 }),
  lane: Type.String({ minLength: 1 }),
  /** The copy of your `@` that was merged. */
  yours: Type.Array(Type.String({ minLength: 1 })),
  /** The files that conflicted when it merged. */
  files: Type.Array(Type.String()),
  /** The skill the run followed, and a hash of its content; null with none found. */
  skill: Type.Union([
    Type.Object({ path: Type.String(), hash: Type.String() }),
    Type.Null(),
  ]),
  by: Type.String(),
})

const LandSchema = Type.Object({
  role: Type.Literal("custom"),
  customType: Type.Literal(LAND_TYPE),
  details: LandDetailsSchema,
})

export interface LandDetails {
  readonly landing: string
  readonly lane: LaneName
  readonly yours: readonly CommitId[]
  readonly files: readonly string[]
  readonly skill: { readonly path: string; readonly hash: string } | null
  readonly by: WriterId
}

/** The pi `CustomMessage` a resolution's prompt is stored as. */
export interface LandMessage {
  readonly role: "custom"
  readonly customType: typeof LAND_TYPE
  readonly content: string
  readonly display: true
  readonly details: LandDetails
  readonly timestamp: number
}

const fromStored = (d: Static<typeof LandDetailsSchema>): LandDetails => ({
  landing: d.landing,
  lane: d.lane as LaneName,
  yours: d.yours.map(commitId),
  files: d.files,
  skill: d.skill,
  by: d.by as WriterId,
})

/** A stored message -> its land details, or undefined if it is not one. */
export const decodeLand = (message: unknown): LandDetails | undefined =>
  decodeWith(LandSchema, message, ({ details }) => fromStored(details))

/** The one line a column shows for a land message. */
export const landLine = (d: LandDetails): string =>
  d.files.length === 0
    ? "✓ resolving your work: no conflicts"
    : `⚠ resolving your work: ${d.files.length} ${d.files.length === 1 ? "file conflicts" : "files conflict"}`

/** One side of a conflicted file, labelled: why it changed, as the tree says. */
export interface Side {
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
  /** Its content, with jj's conflict markers. */
  readonly content: string
  readonly ours: Side
  readonly theirs: Side
}

/**
 * The land message for a resolution: the skill's text, then each conflicted
 * file with both sides labelled (ADR-0010: the labels are always present and
 * the destination's side is never dropped). Over `budget` characters, each
 * side's reasons are trimmed, oldest first; a file's content never is.
 */
export function planResolution(input: {
  readonly skill: {
    readonly path: string
    readonly content: string
    readonly hash: string
  } | null
  readonly files: readonly ConflictFile[]
  readonly budget: number
  readonly details: Omit<LandDetails, "files" | "skill">
  readonly timestamp: number
}): LandMessage {
  const { files } = input
  const intro =
    files.length === 0
      ? "Your work was merged into this thread's own copy with no conflicts. Check that both sides still work together."
      : `Your work was merged into this thread's own copy, and ${files.length} ${files.length === 1 ? "file conflicts" : "files conflict"}. Resolve them there.`
  const skill = input.skill === null ? "" : `${input.skill.content.trim()}\n\n`
  const render = (f: ConflictFile, ours: string, theirs: string) =>
    `## ${f.path}\n\n\`\`\`\n${f.content}\n\`\`\`\n\n` +
    `### ${f.ours.label}: ${f.ours.who}\n${ours}\n` +
    `### ${f.theirs.label}: ${f.theirs.who}\n${theirs}\n`
  // The fixed part: the skill, the intro, every file and both headings.
  const base =
    skill.length +
    intro.length +
    files.map(f => render(f, "", "")).join("\n").length
  // What is left is shared across every side's reasons; each keeps its newest.
  const room = Math.max(0, input.budget - base)
  const each = files.length === 0 ? 0 : Math.floor(room / (files.length * 2))
  const kept = (s: Side): string => {
    const out: string[] = []
    let used = 0
    for (const reason of s.reasons.toReversed()) {
      const line = `- ${reason}\n`
      if (used + line.length > each) break
      out.unshift(line)
      used += line.length
    }
    const dropped = s.reasons.length - out.length
    if (dropped > 0) out.unshift(`- (${dropped} earlier left out)\n`)
    else if (out.length === 0) out.push("- (no messages)\n")
    return out.join("")
  }
  const body = files
    .map(f => render(f, kept(f.ours), kept(f.theirs)))
    .join("\n")
  return {
    role: "custom",
    customType: LAND_TYPE,
    content: `${skill}${intro}\n\n${body}`.trimEnd(),
    display: true,
    details: {
      ...input.details,
      files: files.map(f => f.path),
      skill:
        input.skill === null
          ? null
          : { path: input.skill.path, hash: input.skill.hash },
    },
    timestamp: input.timestamp,
  }
}
