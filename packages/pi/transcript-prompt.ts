// pi/transcript-prompt — a lane's system prompt kept in its own transcript.
//
// pi's harness sends its `systemPrompt` and tool list whole before every
// request's messages, and the prompt is built afresh by each host process: a
// host started after `AGENTS.md` or a skill changed would give every lane a
// new prefix, which costs it its earlier thinking (Anthropic drops it) and a
// cache write of the whole prompt. So the prompt is kept as named sections in
// system messages in the lane: a run starts with what changed (`promptPatch`),
// and every request leads with the transcript's first system message and the
// tools (`transcriptPromptModels`). pi-ai sends that shape to every model: one
// that takes mid-conversation system messages is sent the change where it
// stands, any other has it folded into its leading prompt by section name.

import type { Entry } from "@earendil-works/pi-agent-core"
import {
  type Context,
  getCurrentSystemMessage,
  type Models,
  type SystemMessage,
} from "@earendil-works/pi-ai"
import { diffSystemPromptSections } from "./deep.ts"

/** A prompt as pi's named sections, each its rendered text. */
export type PromptSections = Readonly<Record<string, string>>

const isSystem = (m: { readonly role: string }): m is SystemMessage =>
  m.role === "system"

/**
 * `context` with its first system message leading, the context's tools as
 * that message's `toolsAdded`, and no `systemPrompt` or `tools`; the same
 * context when it holds no system message. Only this shape keeps every model's
 * prefix: a prompt sent beside a later section is duplicated by a model that
 * folds sections, and sections beside a separate tool list are sent after the
 * first user message.
 */
export function leadWithTranscriptPrompt(context: Context): Context {
  const at = context.messages.findIndex(isSystem)
  const first = context.messages[at]
  if (first === undefined || !isSystem(first)) return context
  const { toolsAdded: _, ...prompt } = first
  const tools = context.tools ?? []
  const lead: SystemMessage =
    tools.length === 0 ? prompt : { ...prompt, toolsAdded: tools }
  return {
    messages: [lead, ...context.messages.filter((_, i) => i !== at)],
  }
}

/**
 * `models`, its `streamSimple` sending each context through
 * `leadWithTranscriptPrompt`. A `Proxy`, not a spread: `models` is a class
 * instance (pi-coding-agent's `ModelRuntime`, or pi-ai's `ModelsImpl`), whose
 * methods a spread would drop. A compaction and a branch summary call
 * `completeSimple`, and are sent as the harness makes them.
 */
export function transcriptPromptModels(models: Models): Models {
  return new Proxy(models, {
    get(target, key) {
      if (key === "streamSimple")
        return ((model, context, options) =>
          target.streamSimple(
            model,
            leadWithTranscriptPrompt(context),
            options,
          )) satisfies Models["streamSimple"]
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

/**
 * The sections a lane's next request carries: its entries from its tip back
 * to its newest compaction, oldest first, as the harness scans them for a
 * request (`findEntries` with `stopAtType: "compaction"`, reversed). Null when
 * none of them holds a prompt.
 */
export function sectionsInView(
  entries: readonly Entry[],
): PromptSections | null {
  const messages = entries.flatMap(e =>
    e.type === "compaction"
      ? e.retainedTail
      : e.type === "message"
        ? [e.message]
        : [],
  )
  const sections = getCurrentSystemMessage(messages)?.sections
  return sections === undefined ? null : (sections as PromptSections)
}

/** What a run starts with when the prompt moved: its system message, and the sections it changes. */
export interface PromptPatch {
  readonly message: SystemMessage
  /** The sections that differ from the prompt in view; empty when none was in view. */
  readonly changed: readonly string[]
}

/**
 * The system message a run starts with: every section when none is in view,
 * else the sections that differ (a removed one as `null`, pi-ai's removal);
 * null when nothing differs.
 */
export function promptPatch(
  inView: PromptSections | null,
  now: PromptSections,
  at: number,
): PromptPatch | null {
  const sections = inView === null ? now : diffSystemPromptSections(inView, now)
  if (sections === undefined) return null
  return {
    message: { role: "system", content: "", sections, timestamp: at },
    changed: inView === null ? [] : Object.keys(sections),
  }
}
