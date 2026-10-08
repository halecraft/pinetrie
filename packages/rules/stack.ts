// stack — the prompt of the run that splits a thread's offer into a stack
// (ADR-0105, ADR-0080).
//
// A history message (`history.ts`): `content` is what the model reads, the
// `offer-stack` skill's text and where the stack starts and ends, with the
// split card's text, if any, as the person's brief; `details` are what the
// host reads back when the run ends.

import { type Static, Type } from "typebox"
import { CommitSchema, LaneNameSchema, List, WriterIdSchema } from "./decode.ts"
import { type HistoryMessage, historyMessage } from "./history.ts"

const StackDetailsSchema = Type.Object({
  lane: LaneNameSchema,
  /** Where the offer starts: the stack builds on it. */
  start: List(CommitSchema),
  /** The lane's tip: the stack's last revision must have exactly its files. */
  tip: CommitSchema,
  skill: Type.Union([
    Type.Object({ path: Type.String(), hash: Type.String() }),
    Type.Null(),
  ]),
  by: WriterIdSchema,
})

type StackDetails = Static<typeof StackDetailsSchema>

export const STACK = historyMessage("pinetrie.stack", StackDetailsSchema)

/** The pi `CustomMessage` a split's prompt is stored as. */
export type StackMessage = HistoryMessage<"pinetrie.stack", StackDetails>

/** A stored message -> its stack details, or undefined if it is not one. */
export const decodeStack = STACK.decode

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
  return STACK.encode(
    {
      ...details,
      skill:
        input.skill === null
          ? null
          : { path: input.skill.path, hash: input.skill.hash },
    },
    `${skill}Split this thread's work into a stack of revisions.\n\n` +
      `- Start from ${start}.\n` +
      `- The last revision must have exactly the files of \`${details.tip}\`.\n` +
      `- When the stack is done, point the bookmark \`${input.bookmark}\` at its last revision (\`jj bookmark set ${input.bookmark} -r <last>\`).` +
      asked(input.intent ?? ""),
    input.timestamp,
  )
}
