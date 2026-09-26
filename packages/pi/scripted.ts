// pi/scripted — a model whose replies a suite writes in advance.
//
// pi-ai's faux provider, behind Pineta's own shapes so no pi type crosses
// (ADR-0003). Suites script tool calls with it, so a tool run is repeatable
// and spends nothing (S22).

import {
  type FauxProviderHandle,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai"

/**
 * One scripted reply: text; text made from the context the model was given,
 * each message's text in order, so a suite can see what the model saw; or a
 * tool call with optional text before it.
 */
export type ScriptStep =
  | { readonly text: string }
  | { readonly reply: (context: readonly string[]) => string }
  | {
      readonly tool: string
      readonly args: Record<string, unknown>
      readonly text?: string
    }

export interface ScriptedModel {
  /** The replies the model gives next, one per model turn, in order. */
  use(steps: readonly ScriptStep[]): void
}

// The faux handle stays in this module: `config.ts` reaches it through here.
const handles = new WeakMap<ScriptedModel, FauxProviderHandle>()

/**
 * `tokensPerSecond` sets how fast replies stream: fast by default, for suites;
 * slow, for a check that must see a reply while it is still being written.
 */
export function scriptedModel(
  options: { readonly tokensPerSecond?: number } = {},
): ScriptedModel {
  const faux = fauxProvider({
    tokensPerSecond: options.tokensPerSecond ?? 4000,
    tokenSize: { min: 3, max: 6 },
  })
  const model: ScriptedModel = {
    use(steps) {
      faux.setResponses(
        steps.map(step =>
          "tool" in step
            ? fauxAssistantMessage(
                [
                  ...(step.text === undefined ? [] : [fauxText(step.text)]),
                  // Script arguments are plain JSON, as a model's would be.
                  fauxToolCall(
                    step.tool,
                    step.args as Parameters<typeof fauxToolCall>[1],
                  ),
                ],
                { stopReason: "toolUse" },
              )
            : "reply" in step
              ? (context: { messages: readonly { content: unknown }[] }) =>
                  fauxAssistantMessage(
                    step.reply(context.messages.map(m => textOf(m.content))),
                  )
              : fauxAssistantMessage(step.text),
        ),
      )
    },
  }
  handles.set(model, faux)
  return model
}

/** A message's content as text: a string, or its text parts joined. */
const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .flatMap(part =>
            part?.type === "text" && typeof part.text === "string"
              ? [part.text]
              : [],
          )
          .join("")
      : ""

/** The faux provider behind a scripted model. */
export function fauxOf(model: ScriptedModel): FauxProviderHandle {
  const faux = handles.get(model)
  if (faux === undefined) throw new Error("not a scripted model")
  return faux
}
