// pi/scripted — a model whose replies a suite writes in advance.
//
// pi-ai's faux provider, behind Pineta's own shapes so no pi type crosses
// (ADR-0003). Suites script tool calls with it, so a tool run is repeatable
// and spends nothing (S22). A suite can also give a standing reply for any
// request with nothing queued (`answer`), and pause the reply to a prompt, so
// a check sees its run in progress for as long as it needs (`pause`).

import {
  type AssistantMessage,
  type FauxProviderHandle,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type Provider,
  type TranscriptContext,
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

/** A paused reply (`ScriptedModel.pause`). */
export interface Paused {
  /** Whether the paused request has arrived: its run has started. Poll it with a timeout. */
  readonly reached: boolean
  resume(): void
}

export interface ScriptedModel {
  /** The replies the model gives next, one per model turn, in order; after them, `answer`. */
  use(steps: readonly ScriptStep[]): void
  /**
   * Pause the reply to the next request whose last user message includes
   * `prompt`: its run is in progress, with nothing streamed, until resumed.
   * The request still takes its reply when it arrives, in arrival order.
   */
  pause(prompt: string): Paused
}

// The faux handles stay in this module: `config.ts` reaches them through here.
const handles = new WeakMap<
  ScriptedModel,
  { readonly run: FauxProviderHandle; readonly describe: FauxProviderHandle }
>()

/** What a scripted model answers a describe request with, by default. */
export const SCRIPTED_DESCRIPTION = "offer: scripted"

/**
 * `tokensPerSecond` sets how fast replies stream: fast by default. A check
 * that must see a reply while it is being written uses a slow one; a check
 * that must see a run in progress pauses it instead.
 */
export function scriptedModel(
  options: {
    readonly tokensPerSecond?: number
    /** Given whenever nothing is queued, and never used up. Without it, such a request gets an error reply. */
    readonly answer?: ScriptStep
    /**
     * Commit messages (ADR-0038), answered by a provider of their own, so a
     * describe request never takes a reply from the run's script (S48 item 22).
     */
    readonly describe?: ScriptStep
  } = {},
): ScriptedModel {
  const faux = fauxProvider({
    tokensPerSecond: options.tokensPerSecond ?? 4000,
    tokenSize: { min: 3, max: 6 },
  })
  const describer = fauxProvider({
    provider: "scripted-describe",
    models: [{ id: "describe" }],
  })
  const describe = options.describe ?? { text: SCRIPTED_DESCRIPTION }
  let queue: readonly ScriptStep[] = []
  const pauses: {
    readonly prompt: string
    reached: boolean
    readonly resumed: PromiseWithResolvers<void>
  }[] = []
  const run = perRequest(faux, async (context, signal) => {
    const [next, ...rest] = queue
    queue = rest
    const step = next ?? options.answer ?? null
    const prompt = lastUserText(context)
    const at = pauses.findIndex(p => prompt.includes(p.prompt))
    const [paused] = at < 0 ? [] : pauses.splice(at, 1)
    if (paused !== undefined) {
      paused.reached = true
      await Promise.race([paused.resumed.promise, aborted(signal)])
    }
    return step
  })
  const model: ScriptedModel = {
    use(steps) {
      queue = steps
    },
    pause(prompt) {
      const paused = {
        prompt,
        reached: false,
        resumed: Promise.withResolvers<void>(),
      }
      pauses.push(paused)
      return {
        get reached() {
          return paused.reached
        },
        resume: () => paused.resumed.resolve(),
      }
    },
  }
  handles.set(model, {
    run,
    describe: perRequest(describer, () => describe),
  })
  return model
}

/** The step a request is answered with; null answers with an error. */
type Choose = (
  context: TranscriptContext,
  signal: AbortSignal | undefined,
) => ScriptStep | null | Promise<ScriptStep | null>

/**
 * `faux`, answering each request with `choose`'s step. Faux takes a response
 * off its queue when a request arrives but runs a factory a microtask later,
 * so a factory that queued itself again would leave the queue empty for a
 * second request in the same tick (S52 item 6). Each request queues its own,
 * just before faux takes it.
 */
function perRequest(
  faux: FauxProviderHandle,
  choose: Choose,
): FauxProviderHandle {
  const dispatch: FauxResponseFactory = async (context, options) => {
    const step = await choose(context, options?.signal)
    return step === null ? NO_REPLY : render(step, context)
  }
  const base = faux.provider
  const provider: Provider = {
    id: base.id,
    name: base.name,
    auth: base.auth,
    getModels: () => base.getModels(),
    stream: (model, context, streamOptions) => {
      faux.appendResponses([dispatch])
      return base.stream(model, context, streamOptions)
    },
    streamSimple: (model, context, streamOptions) => {
      faux.appendResponses([dispatch])
      return base.streamSimple(model, context, streamOptions)
    },
  }
  return { ...faux, provider }
}

const NO_REPLY = fauxAssistantMessage("", {
  stopReason: "error",
  errorMessage: "no scripted reply queued",
})

/** A step as the message faux streams. */
function render(
  step: ScriptStep,
  context: TranscriptContext,
): AssistantMessage {
  if ("tool" in step)
    return fauxAssistantMessage(
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
  if ("reply" in step)
    return fauxAssistantMessage(
      step.reply(context.messages.map(m => textOf(m.content))),
    )
  return fauxAssistantMessage(step.text)
}

/** The text of the request's last user message, or "". */
function lastUserText(context: TranscriptContext): string {
  const user = context.messages.findLast(m => m.role === "user")
  return user === undefined ? "" : textOf(user.content)
}

/** Settles when `signal` aborts; never, without one. */
const aborted = (signal: AbortSignal | undefined): Promise<void> =>
  new Promise(resolve => {
    if (signal?.aborted === true) resolve()
    signal?.addEventListener("abort", () => resolve(), { once: true })
  })

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

/** The faux provider behind a scripted model's runs. */
export function fauxOf(model: ScriptedModel): FauxProviderHandle {
  const faux = handles.get(model)
  if (faux === undefined) throw new Error("not a scripted model")
  return faux.run
}

/** The faux provider that answers a scripted model's describe requests. */
export function describeFauxOf(model: ScriptedModel): FauxProviderHandle {
  const faux = handles.get(model)
  if (faux === undefined) throw new Error("not a scripted model")
  return faux.describe
}
