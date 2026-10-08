// pi/scripted — a model whose replies a suite writes in advance.
//
// pi-ai's faux provider, behind pinetrie's own shapes so no pi type crosses
// (ADR-0003). Suites script tool calls with it, so a tool run is repeatable
// and spends nothing (S22). A suite can also give a standing reply for any
// request with nothing queued (`answer`), and pause the reply to a prompt, so
// a check sees its run in progress for as long as it needs (`pause`).

import { createHash } from "node:crypto"
import {
  type AssistantMessage,
  createImagesProvider,
  type FauxProviderHandle,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type ImagesApi,
  type ImagesModel,
  type ImagesProvider,
  type Provider,
  type TranscriptContext,
} from "@earendil-works/pi-ai"
import type { ToolId } from "@pinetrie/core"
import { VERDICT_ALONE, VERDICT_THEN_DIGEST } from "@pinetrie/rules"

/**
 * One scripted reply: text; text made from the context the model was given,
 * each message's text in order (an image as `[image <mime> <sha256>]`), so
 * a suite can see what the model saw; or a tool call with optional text
 * before it.
 */
export type ScriptStep =
  | { readonly text: string }
  | { readonly reply: (context: readonly string[]) => string }
  | {
      readonly tool: ToolId
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

/** What a scripted model says of a run's end (ADR-0077): nothing is needed. */
export const SCRIPTED_VERDICT = "done"

/**
 * A describe request's answer: `describe`, with the verdict line first when
 * the request is a run's end, which asks for it (`digestRequest`).
 */
function describeStep(describe: ScriptStep, asked: string): ScriptStep {
  if (asked.includes(VERDICT_ALONE)) return { text: SCRIPTED_VERDICT }
  if (asked.includes(VERDICT_THEN_DIGEST) && "text" in describe)
    return { text: `${SCRIPTED_VERDICT}\n${describe.text}` }
  return describe
}

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
     * Commit messages (ADR-0105), answered by a provider of their own, so a
     * describe request never takes a reply from the run's script (S48 item 22).
     */
    readonly describe?: ScriptStep
    /**
     * The model's context window, in tokens: small, pi compacts within a
     * test (S92). pi's own default otherwise.
     */
    readonly contextWindow?: number
  } = {},
): ScriptedModel {
  const faux = fauxProvider({
    tokensPerSecond: options.tokensPerSecond ?? 4000,
    tokenSize: { min: 3, max: 6 },
    ...(options.contextWindow === undefined
      ? {}
      : { models: [{ id: "faux-1", contextWindow: options.contextWindow }] }),
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
    describe: perRequest(describer, context =>
      describeStep(describe, lastUserText(context)),
    ),
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

/**
 * A message's content as text: a string, or its parts joined, an image part
 * as `[image <mimeType> <sha256 of its bytes>]`, so a suite can see which
 * image the model was given.
 */
const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .flatMap(part =>
            part?.type === "text" && typeof part.text === "string"
              ? [part.text]
              : part?.type === "image" && typeof part.data === "string"
                ? [
                    `[image ${part.mimeType} ${createHash("sha256").update(Buffer.from(part.data, "base64")).digest("hex")}]`,
                  ]
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

/**
 * A 4×4 dark PNG: what a scripted model draws for every banner. A suite
 * checks that a banner is made and shown, not what it shows.
 */
export const SCRIPTED_IMAGE_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGOQllOBIwbiOACWxAXR5dcEAQAAAABJRU5ErkJggg=="

/**
 * The image provider behind a scripted model's banners: one model, which
 * answers every request with `SCRIPTED_IMAGE_PNG` and needs no key.
 */
export function scriptedImages(): {
  readonly provider: ImagesProvider
  readonly model: ImagesModel<ImagesApi>
} {
  const model: ImagesModel<ImagesApi> = {
    id: "banner",
    name: "scripted banner",
    api: "scripted-images",
    provider: "scripted-images",
    baseUrl: "",
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  const provider = createImagesProvider({
    id: "scripted-images",
    auth: { apiKey: { name: "Scripted", resolve: async () => ({ auth: {} }) } },
    models: [model],
    api: {
      generateImages: async () => ({
        api: model.api,
        provider: model.provider,
        model: model.id,
        output: [
          { type: "image", mimeType: "image/png", data: SCRIPTED_IMAGE_PNG },
        ],
        stopReason: "stop",
        timestamp: Date.now(),
      }),
    },
  })
  return { provider, model }
}
