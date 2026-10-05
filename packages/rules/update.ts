// update — a thread's base, or the thread it branched from, merged into it
// (ADR-0060, ADR-0072), and the offer split into a stack (ADR-0038).
//
// Two pi `CustomMessage`s in `land.ts`'s pattern: `content` is what the model
// reads, `details` what the column shows. An update is a fact in the thread,
// never a prompt: without it, the agent's next run would work from files it
// no longer has. A stack message is the prompt of the run that splits an
// offer, under the `offer-stack` skill, with the split card's text, if any,
// as the person's brief (ADR-0080).

import {
  type CatchUpFrom,
  type CommitId,
  commitId,
  firstLine,
  isLaneName,
  type LaneName,
  type ThreadName,
  type WriterId,
} from "@pinetrie/core"
import { type Static, Type } from "typebox"
import { CommitSchema, decodeWith } from "./decode.ts"
import { catchUpName } from "./line.ts"

const UPDATE_TYPE = "pinetrie.update"
const STACK_TYPE = "pinetrie.stack"

const UpdateDetailsSchema = Type.Object({
  lane: Type.String({ minLength: 1 }),
  /**
   * The bookmark the thread was brought up to date with: the line, or its
   * WIP. Absent in updates stored before ADR-0060, which merged your `@`.
   */
  base: Type.Optional(Type.String({ minLength: 1 })),
  /**
   * Whether `base` is the line. Absent in updates stored before it was
   * written, whose base is named by its bookmark.
   */
  line: Type.Optional(Type.Boolean()),
  /** The thread it branched from, when that was merged (ADR-0072); then no `base`. */
  parent: Type.Optional(
    Type.Object({
      lane: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1 }),
    }),
  ),
  /** The commit merged: the line's, or the WIP's copy; `copy` before ADR-0060. */
  copy: CommitSchema,
  /** The commits that came in, newest first: each one's first line. */
  commits: Type.Array(Type.String()),
  files: Type.Array(Type.String()),
  by: Type.String(),
})

const UpdateSchema = Type.Object({
  role: Type.Literal("custom"),
  customType: Type.Literal(UPDATE_TYPE),
  details: UpdateDetailsSchema,
})

interface UpdateDetails {
  readonly lane: LaneName
  /** What was merged in; null for an update stored before ADR-0060. */
  readonly from: CatchUpFrom | null
  /** The base's bookmark, which the model reads; null for a parent. */
  readonly bookmark: string | null
  /** The commit merged: the line's, or the WIP's copy. */
  readonly merged: CommitId
  readonly commits: readonly string[]
  readonly files: readonly string[]
  readonly by: WriterId
}

/** The pi `CustomMessage` an update is stored as. */
export interface UpdateMessage {
  readonly role: "custom"
  readonly customType: typeof UPDATE_TYPE
  readonly content: string
  readonly display: true
  /** As stored: the merged commit under `copy`, and no `base` when null. */
  readonly details: Static<typeof UpdateDetailsSchema>
  readonly timestamp: number
}

/** What a stored update merged: its parent, else its base by its bookmark. */
function storedFrom(d: Static<typeof UpdateDetailsSchema>): CatchUpFrom | null {
  if (d.parent !== undefined)
    return isLaneName(d.parent.lane)
      ? {
          kind: "parent",
          lane: d.parent.lane,
          name: d.parent.name as ThreadName,
        }
      : null
  if (d.base === undefined) return null
  return d.line === true ? { kind: "line" } : { kind: "wip", bookmark: d.base }
}

const fromStoredUpdate = (
  d: Static<typeof UpdateDetailsSchema>,
): UpdateDetails | undefined =>
  isLaneName(d.lane)
    ? {
        lane: d.lane,
        from: storedFrom(d),
        bookmark: d.parent === undefined ? (d.base ?? null) : null,
        merged: commitId(d.copy),
        commits: d.commits,
        files: d.files,
        by: d.by as WriterId,
      }
    : undefined

/** A stored message -> its update details, or undefined if it is not one. */
export const decodeUpdate = (message: unknown): UpdateDetails | undefined =>
  decodeWith(UpdateSchema, message, ({ details }) => fromStoredUpdate(details))

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/** The one line a column shows for an update. */
export const updateLine = (d: UpdateDetails): string =>
  `↓ caught up${d.from === null ? "" : ` with ${catchUpName(d.from)}`}: ${plural(d.files.length, "file", "files")} changed`

/** The update message: what changed in this thread's files, for the model. */
export function encodeUpdate(
  details: UpdateDetails,
  timestamp: number,
): UpdateMessage {
  const commits =
    details.commits.length === 0
      ? "- (none named)\n"
      : details.commits.map(c => `- ${firstLine(c, 200)}\n`).join("")
  const { from } = details
  const what =
    from?.kind === "parent"
      ? `The work of the thread this one branched from (${from.name})`
      : (details.bookmark ?? "The person's work")
  const files = details.files.map(f => `- ${f}\n`).join("") || "- (none)\n"
  return {
    role: "custom",
    customType: UPDATE_TYPE,
    content:
      `${what} was merged into this thread's own copy, so these files changed under you. Read them again before relying on what you saw earlier.\n\n` +
      `What came in:\n${commits}\nFiles that changed:\n${files}`,
    display: true,
    details: {
      lane: details.lane,
      ...(from?.kind === "parent"
        ? { parent: { lane: from.lane, name: from.name } }
        : from === null || details.bookmark === null
          ? {}
          : { base: details.bookmark, line: from.kind === "line" }),
      copy: details.merged,
      commits: [...details.commits],
      files: [...details.files],
      by: details.by,
    },
    timestamp,
  }
}

// ── the stack's prompt ─────────────────────────────────────────────────────

const StackDetailsSchema = Type.Object({
  lane: Type.String({ minLength: 1 }),
  /** Where the offer starts: the stack builds on it. */
  start: Type.Array(CommitSchema),
  /** The lane's tip: the stack's last revision must have exactly its files. */
  tip: CommitSchema,
  skill: Type.Union([
    Type.Object({ path: Type.String(), hash: Type.String() }),
    Type.Null(),
  ]),
  by: Type.String(),
})

const StackSchema = Type.Object({
  role: Type.Literal("custom"),
  customType: Type.Literal(STACK_TYPE),
  details: StackDetailsSchema,
})

interface StackDetails {
  readonly lane: LaneName
  readonly start: readonly CommitId[]
  readonly tip: CommitId
  readonly skill: { readonly path: string; readonly hash: string } | null
  readonly by: WriterId
}

/** The pi `CustomMessage` a split's prompt is stored as. */
export interface StackMessage {
  readonly role: "custom"
  readonly customType: typeof STACK_TYPE
  readonly content: string
  readonly display: true
  readonly details: StackDetails
  readonly timestamp: number
}

/** A stored message -> its stack details, or undefined if it is not one. */
export const decodeStack = (message: unknown): StackDetails | undefined =>
  decodeWith(StackSchema, message, ({ details }) =>
    isLaneName(details.lane)
      ? {
          lane: details.lane,
          start: details.start.map(commitId),
          tip: commitId(details.tip),
          skill: details.skill,
          by: details.by as WriterId,
        }
      : undefined,
  )

/** The one line a column shows for a stack message. */
export const stackLine = (_d: StackDetails): string =>
  "⇶ splitting this thread's work into a stack"

/** The person's text, under its own heading, as a resolution carries it; "" for none. */
const asked = (intent: string): string =>
  intent.trim() === "" ? "" : `\n\n## What the person asked\n\n${intent.trim()}`

/**
 * The stack message: the skill's text, then where the stack starts and ends,
 * then what the person asked of it, when its card had text (ADR-0080).
 * The bookmark it names is where the host reads the stack from.
 */
export function planStack(input: {
  readonly skill: {
    readonly path: string
    readonly content: string
    readonly hash: string
  } | null
  readonly bookmark: string
  readonly details: Omit<StackDetails, "skill">
  /** What the person asked of the split, from its card (ADR-0080); "" for nothing. */
  readonly intent?: string
  readonly timestamp: number
}): StackMessage {
  const { details } = input
  const skill = input.skill === null ? "" : `${input.skill.content.trim()}\n\n`
  const start =
    details.start.length === 1
      ? `\`${details.start[0]}\``
      : `a merge of ${details.start.map(c => `\`${c}\``).join(" and ")}`
  return {
    role: "custom",
    customType: STACK_TYPE,
    content:
      `${skill}Split this thread's work into a stack of revisions.\n\n` +
      `- Start from ${start}.\n` +
      `- The last revision must have exactly the files of \`${details.tip}\`.\n` +
      `- When the stack is done, point the bookmark \`${input.bookmark}\` at its last revision (\`jj bookmark set ${input.bookmark} -r <last>\`).` +
      asked(input.intent ?? ""),
    display: true,
    details: {
      ...details,
      skill:
        input.skill === null
          ? null
          : { path: input.skill.path, hash: input.skill.hash },
    },
    timestamp: input.timestamp,
  }
}
