// update — the project's work merged into a thread, and the offer split into a stack
// (ADR-0038).
//
// Two pi `CustomMessage`s in `land.ts`'s pattern: `content` is what the model
// reads, `details` what the column shows. An update is a fact in the thread,
// never a prompt: without it, the agent's next run would work from files it
// no longer has. A stack message is the prompt of the run that splits an
// offer, under the `offer-stack` skill.

import {
  type CommitId,
  commitId,
  firstLine,
  isLaneName,
  type LaneName,
  type WriterId,
} from "@pineta/core"
import { type Static, Type } from "typebox"
import { decodeWith } from "./decode.ts"

export const UPDATE_TYPE = "pineta.update"
export const STACK_TYPE = "pineta.stack"

const UpdateDetailsSchema = Type.Object({
  lane: Type.String({ minLength: 1 }),
  /** The copy of your `@` that was merged. */
  copy: Type.String({ minLength: 1 }),
  /** Your commits that came in, newest first: each one's first line. */
  commits: Type.Array(Type.String()),
  files: Type.Array(Type.String()),
  by: Type.String(),
})

const UpdateSchema = Type.Object({
  role: Type.Literal("custom"),
  customType: Type.Literal(UPDATE_TYPE),
  details: UpdateDetailsSchema,
})

export interface UpdateDetails {
  readonly lane: LaneName
  readonly copy: CommitId
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
  readonly details: UpdateDetails
  readonly timestamp: number
}

const fromStoredUpdate = (
  d: Static<typeof UpdateDetailsSchema>,
): UpdateDetails | undefined =>
  isLaneName(d.lane)
    ? {
        lane: d.lane,
        copy: commitId(d.copy),
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
  `↓ brought up to date: ${plural(d.files.length, "file", "files")} changed`

/** The update message: what changed in this thread's files, for the model. */
export function encodeUpdate(
  details: UpdateDetails,
  timestamp: number,
): UpdateMessage {
  const commits =
    details.commits.length === 0
      ? "- your uncommitted changes\n"
      : details.commits.map(c => `- ${firstLine(c, 200)}\n`).join("")
  const files = details.files.map(f => `- ${f}\n`).join("") || "- (none)\n"
  return {
    role: "custom",
    customType: UPDATE_TYPE,
    content:
      "The person's work was merged into this thread's own copy, so these files changed under you. Read them again before relying on what you saw earlier.\n\n" +
      `Their work:\n${commits}\nFiles that changed:\n${files}`,
    display: true,
    details,
    timestamp,
  }
}

// ── the stack's prompt ─────────────────────────────────────────────────────

const StackDetailsSchema = Type.Object({
  lane: Type.String({ minLength: 1 }),
  /** Where the offer starts: the stack builds on it. */
  start: Type.Array(Type.String({ minLength: 1 })),
  /** The lane's tip: the stack's last revision must have exactly its files. */
  tip: Type.String({ minLength: 1 }),
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

export interface StackDetails {
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

/**
 * The stack message: the skill's text, then where the stack starts and ends.
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
      `- When the stack is done, point the bookmark \`${input.bookmark}\` at its last revision (\`jj bookmark set ${input.bookmark} -r <last>\`).`,
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
