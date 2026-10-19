// pi-message — pi's own messages as the reads take them: a system, user,
// assistant or tool result message, its parts decoded, and a host tool's
// result with what it says as a fact. Any other role, or a message that does
// not decode, is no message: pi writes no other role into a root, and a
// `custom` one no history decoder takes was stored in an older shape.

import {
  type AgentMessageLike,
  CONFLICT_TOOL,
  GET_LATEST_TOOL,
  type MessageContent,
  type MessagePart,
  type PointId,
  PROPOSE_TOOL,
  type Proposal,
  pointId,
  storedImage,
} from "@pinetrie/core"
import { type Static, Type } from "typebox"
import { isWellFormed } from "./decode.ts"
import { decodeProposal } from "./proposal.ts"

const TextPartSchema = Type.Object({
  type: Type.Literal("text"),
  text: Type.String(),
})

const ToolCallPartSchema = Type.Object({
  type: Type.Literal("toolCall"),
  id: Type.String(),
  name: Type.String(),
  arguments: Type.Optional(Type.Unknown()),
})

const ContentSchema = Type.Union([Type.String(), Type.Array(Type.Unknown())])

const PlainSchema = Type.Object({
  role: Type.Union([Type.Literal("user"), Type.Literal("system")]),
  content: ContentSchema,
})

const AssistantSchema = Type.Object({
  role: Type.Literal("assistant"),
  content: ContentSchema,
  stopReason: Type.Optional(Type.String()),
  errorMessage: Type.Optional(Type.String()),
})

const ToolResultSchema = Type.Object({
  role: Type.Literal("toolResult"),
  content: ContentSchema,
  toolCallId: Type.String(),
  toolName: Type.Optional(Type.String()),
  isError: Type.Optional(Type.Boolean()),
  details: Type.Optional(Type.Unknown()),
})

const AskedSchema = Type.Object({ asked: Type.Literal(true) })

const MergedSchema = Type.Object({
  merged: Type.Array(Type.String({ minLength: 1 })),
})

/**
 * A stored part -> the part as read, or undefined for one nothing shows:
 * pi's thinking, an image whose bytes are inline.
 */
function messagePart(part: unknown): MessagePart | undefined {
  if (isWellFormed(TextPartSchema, part))
    return { type: "text", text: part.text }
  if (isWellFormed(ToolCallPartSchema, part))
    return {
      type: "toolCall",
      id: part.id,
      name: part.name,
      arguments: part.arguments,
    }
  const image = storedImage(part)
  return image === undefined ? undefined : { type: "image", ...image }
}

const messageContent = (
  content: Static<typeof ContentSchema>,
): MessageContent =>
  typeof content === "string"
    ? content
    : content.flatMap(part => messagePart(part) ?? [])

/**
 * What a tool result of the host's tools says as a fact, from its
 * `details`, never its text: an `ask_about_conflict` the host took, the
 * states a `catch_up` merged, or what `propose_branches` proposed. Empty for
 * any other result.
 */
function toolResultFacts(
  result: Static<typeof ToolResultSchema>,
):
  | { readonly asked: true }
  | { readonly merged: readonly PointId[] }
  | { readonly proposal: Proposal }
  | Record<string, never> {
  const { toolName, details } = result
  if (toolName === CONFLICT_TOOL && isWellFormed(AskedSchema, details))
    return { asked: true }
  if (toolName === GET_LATEST_TOOL && isWellFormed(MergedSchema, details))
    return { merged: details.merged.map(pointId) }
  if (toolName === PROPOSE_TOOL) {
    const proposal = decodeProposal(details)
    return proposal === undefined ? {} : { proposal }
  }
  return {}
}

/** A stored message of pi's own -> the message as read, or undefined. */
export function decodePiMessage(
  message: unknown,
): AgentMessageLike | undefined {
  if (isWellFormed(PlainSchema, message))
    return { role: message.role, content: messageContent(message.content) }
  if (isWellFormed(AssistantSchema, message))
    return {
      role: "assistant",
      content: messageContent(message.content),
      ...(message.stopReason === undefined
        ? {}
        : { stopReason: message.stopReason }),
      ...(message.errorMessage === undefined
        ? {}
        : { errorMessage: message.errorMessage }),
    }
  if (isWellFormed(ToolResultSchema, message))
    return {
      role: "toolResult",
      content: messageContent(message.content),
      toolCallId: message.toolCallId,
      isError: message.isError === true,
      ...toolResultFacts(message),
    }
  return undefined
}
