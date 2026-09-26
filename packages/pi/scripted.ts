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

/** One scripted reply: text, or a tool call with optional text before it. */
export type ScriptStep =
  | { readonly text: string }
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
            : fauxAssistantMessage(step.text),
        ),
      )
    },
  }
  handles.set(model, faux)
  return model
}

/** The faux provider behind a scripted model. */
export function fauxOf(model: ScriptedModel): FauxProviderHandle {
  const faux = handles.get(model)
  if (faux === undefined) throw new Error("not a scripted model")
  return faux
}
