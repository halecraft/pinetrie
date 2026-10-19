// pi/scripted — a model whose replies a suite writes in advance.
//
// pi-ai's faux provider, behind pinetrie's own shapes. Suites script tool
// calls with it, so a tool run is repeatable and spends nothing.

import { createHash } from "node:crypto"
import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  createProvider,
  type FauxProviderHandle,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  getSystemMessageText,
  type ImageApi,
  type ImageModel,
  type Provider,
  type TranscriptContext,
} from "@earendil-works/pi-ai"
import {
  FOCUS_REQUEST_HEAD,
  URGENCY_ALONE,
  URGENCY_THEN_DIGEST,
} from "@pinetrie/rules"
import { INTENT_FIELD, type ToolId } from "@pinetrie/threads"
import { TAKES_INTENT } from "./intent.ts"

/**
 * One scripted reply: text; text made from the context the model was given,
 * each message's text in order (a system message as the prompt it renders,
 * an image as `[image <mime> <sha256>]`), so a suite can see what the model
 * saw; or a tool call with optional text before it.
 */
export type ScriptStep =
  | {
      readonly text: string
      /**
       * Thinking blocks the reply reports Anthropic dropped, as pi-ai stores
       * a request whose prefix changed: one listed per block.
       */
      readonly dropped?: number
    }
  | { readonly reply: (context: readonly string[]) => string }
  | {
      readonly tool: ToolId
      readonly args: Record<string, unknown>
      readonly text?: string
    }

/** A reply held from its first event: nothing of it streams until released. */
export interface Held {
  /** Whether the held request has arrived: its run has started. Poll it with a timeout. */
  readonly reached: boolean
  /** The reply's text released so far. */
  readonly released: string
  /**
   * Release the reply's events up to and including its next text delta,
   * once the provider has made it. False when the reply ended first.
   */
  next(): Promise<boolean>
  /** Release the rest of the reply, as it comes. */
  finish(): void
}

export interface ScriptedModel {
  /** The replies the model gives next, one per model turn, in order; after them, `answer`. */
  use(steps: readonly ScriptStep[]): void
  /**
   * Hold the reply to the next request whose last user message includes
   * `prompt`: its run is in progress, with nothing streamed, until released
   * a step at a time or whole. The run's abort releases it. The request
   * still takes its reply when it arrives, in arrival order.
   */
  hold(prompt: string): Held
}

// The faux handles stay in this module: `config.ts` reaches them through here.
const handles = new WeakMap<
  ScriptedModel,
  { readonly run: FauxProviderHandle; readonly describe: FauxProviderHandle }
>()

/** What a scripted model answers a describe request with, by default. */
export const SCRIPTED_DESCRIPTION = "proposed changes: scripted"

/** What a scripted model says of a run's end: nothing is needed. */
export const SCRIPTED_URGENCY = "done"

/** What a scripted model says of a thread's focus: keep it, so a suite names none it did not ask for. */
export const SCRIPTED_FOCUS = "same"

/**
 * A describe request's answer: `describe`, with the urgency line first when
 * the request is a run's end, which asks for it (`digestRequest`). A focus
 * request (`focusRequest`) is answered `same`, unless the scenario gave a
 * `describe` of its own, which answers it.
 */
function describeStep(
  describe: ScriptStep,
  asked: string,
  own: boolean,
): ScriptStep {
  if (!own && asked.startsWith(FOCUS_REQUEST_HEAD))
    return { text: SCRIPTED_FOCUS }
  if (asked.includes(URGENCY_ALONE)) return { text: SCRIPTED_URGENCY }
  if (asked.includes(URGENCY_THEN_DIGEST) && "text" in describe)
    return { text: `${SCRIPTED_URGENCY}\n${describe.text}` }
  return describe
}

/**
 * `tokensPerSecond` sets how fast replies stream: fast by default. A check
 * that must see a reply while it is being written, or a run in progress,
 * holds it (`hold`).
 */
export function scriptedModel(
  options: {
    readonly tokensPerSecond?: number
    /** Given whenever nothing is queued, and never used up. Without it, such a request gets an error reply. */
    readonly answer?: ScriptStep
    /**
     * Commit messages, answered by a provider of their own, so a describe
     * request never takes a reply from the run's script.
     */
    readonly describe?: ScriptStep
    /**
     * The model's context window, in tokens: small, pi compacts within a
     * test. pi's own default otherwise.
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
  const holds: Hold[] = []
  const run = perRequest(
    faux,
    () => {
      const [next, ...rest] = queue
      queue = rest
      return next ?? options.answer ?? null
    },
    context => {
      const prompt = lastUserText(context)
      const at = holds.findIndex(h => prompt.includes(h.prompt))
      return at < 0 ? undefined : holds.splice(at, 1)[0]
    },
  )
  const model: ScriptedModel = {
    use(steps) {
      queue = steps
    },
    hold(prompt) {
      const hold = newHold(prompt)
      holds.push(hold)
      return hold.held
    },
  }
  handles.set(model, {
    run,
    describe: perRequest(describer, context =>
      describeStep(
        describe,
        lastUserText(context),
        options.describe !== undefined,
      ),
    ),
  })
  return model
}

/** The step a request is answered with; null answers with an error. */
type Choose = (context: TranscriptContext) => ScriptStep | null

/** A request's hold, taken from those waiting as the request arrives. */
type TakeHold = (context: TranscriptContext) => Hold | undefined

/**
 * `faux`, answering each request with `choose`'s step, and holding its
 * stream when `takeHold` gives a hold. Faux takes a response off its queue
 * when a request arrives but runs a factory a microtask later, so a factory
 * that queued itself again would leave the queue empty for a second request
 * in the same tick. Each request queues its own, just before faux takes it.
 */
function perRequest(
  faux: FauxProviderHandle,
  choose: Choose,
  takeHold: TakeHold = () => undefined,
): FauxProviderHandle {
  const dispatch: FauxResponseFactory = context => {
    const step = choose(context)
    return step === null ? NO_REPLY : render(step, context)
  }
  const base = faux.provider
  const held = (
    context: TranscriptContext,
    signal: AbortSignal | undefined,
    stream: AssistantMessageEventStream,
  ) => {
    const hold = takeHold(context)
    return hold === undefined ? stream : holdStream(stream, hold, signal)
  }
  const provider: Provider = {
    id: base.id,
    name: base.name,
    auth: base.auth,
    getModels: () => base.getModels(),
    stream: (model, context, streamOptions) => {
      faux.appendResponses([dispatch])
      return held(
        context,
        streamOptions?.signal,
        base.stream(model, context, streamOptions),
      )
    },
    streamSimple: (model, context, streamOptions) => {
      faux.appendResponses([dispatch])
      return held(
        context,
        streamOptions?.signal,
        base.streamSimple(model, context, streamOptions),
      )
    },
  }
  return { ...faux, provider }
}

/** A hold as `perRequest` drives it, and as the suite sees it (`held`). */
interface Hold {
  readonly prompt: string
  readonly held: Held
  /** The request has arrived. */
  reach(): void
  /** Settles once `event` may go on: at once when released, else at a release. */
  turn(event: AssistantMessageEvent): Promise<void>
  /** `event` has gone on. */
  sent(event: AssistantMessageEvent): void
  /** The reply has no more events. */
  ended(): void
}

function newHold(prompt: string): Hold {
  let reached = false
  let released = ""
  // Text deltas released and not yet sent: each takes the events before it.
  let allowed = 0
  let finished = false
  let over = false
  let wake = () => {}
  let answer: ((more: boolean) => void) | null = null
  const answered = (more: boolean) => {
    answer?.(more)
    answer = null
  }
  return {
    prompt,
    held: {
      get reached() {
        return reached
      },
      get released() {
        return released
      },
      next() {
        if (over) return Promise.resolve(false)
        allowed++
        const more = new Promise<boolean>(resolve => {
          answer = resolve
        })
        wake()
        return more
      },
      finish() {
        finished = true
        wake()
      },
    },
    reach() {
      reached = true
    },
    async turn() {
      while (!finished && allowed === 0)
        await new Promise<void>(resolve => {
          wake = resolve
        })
    },
    sent(event) {
      if (event.type !== "text_delta") return
      released += event.delta
      if (finished) return
      allowed--
      answered(true)
    },
    ended() {
      over = true
      answered(false)
    },
  }
}

/**
 * `inner`'s events, each forwarded only when `hold` lets it go. Faux may
 * have made the whole reply before the run aborts, so an abort ends the
 * reply here, as faux ends one it sees aborted: at the last event forwarded.
 */
function holdStream(
  inner: AssistantMessageEventStream,
  hold: Hold,
  signal: AbortSignal | undefined,
): AssistantMessageEventStream {
  const outer = createAssistantMessageEventStream()
  hold.reach()
  let cut = false
  void aborted(signal).then(() => {
    cut = true
    hold.held.finish()
  })
  void (async () => {
    let partial: AssistantMessage | undefined
    for await (const event of inner) {
      await hold.turn(event)
      partial ??= partialOf(event)
      if (cut) {
        if (partial !== undefined) {
          const error: AssistantMessage = {
            ...partial,
            stopReason: "aborted",
            errorMessage: "Request was aborted",
          }
          outer.push({ type: "error", reason: "aborted", error })
        }
        break
      }
      outer.push(event)
      hold.sent(event)
      partial = partialOf(event) ?? partial
    }
    hold.ended()
    outer.end()
  })()
  return outer
}

/** The message as far as `event` has it. */
const partialOf = (
  event: AssistantMessageEvent,
): AssistantMessage | undefined =>
  "partial" in event ? event.partial : undefined

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
          scriptedArgs(step) as Parameters<typeof fauxToolCall>[1],
        ),
      ],
      { stopReason: "toolUse" },
    )
  if ("reply" in step)
    return fauxAssistantMessage(
      step.reply(
        context.messages.map(m =>
          m.role === "system" ? getSystemMessageText(m) : textOf(m.content),
        ),
      ),
    )
  const reply = fauxAssistantMessage(step.text)
  return step.dropped === undefined ? reply : withDropped(reply, step.dropped)
}

/** `reply` with Anthropic's report of `count` dropped thinking blocks, as pi-ai stores it. */
const withDropped = (
  reply: AssistantMessage,
  count: number,
): AssistantMessage => ({
  ...reply,
  diagnostics: [
    {
      type: "anthropic_input_transformations",
      timestamp: 0,
      details: {
        transformations: Array.from({ length: count }, (_, i) => ({
          type: "thinking_dropped",
          path: `messages.${i}.content.0`,
          reason: "prefix_binding_mismatch",
        })),
      },
    },
  ],
})

/**
 * A tool step's arguments as a model gives them: with an intent, when its
 * tool takes one and the step names none, so a suite's call is never
 * refused for the want of one.
 */
function scriptedArgs(
  step: Extract<ScriptStep, { readonly tool: ToolId }>,
): Record<string, unknown> {
  return TAKES_INTENT[step.tool] && !(INTENT_FIELD in step.args)
    ? { [INTENT_FIELD]: `Scripted ${step.tool} call`, ...step.args }
    : step.args
}

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

export function runFaux(model: ScriptedModel): FauxProviderHandle {
  const faux = handles.get(model)
  if (faux === undefined) throw new Error("not a scripted model")
  return faux.run
}

/** The faux provider that answers a scripted model's describe requests. */
export function describeFaux(model: ScriptedModel): FauxProviderHandle {
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
  readonly provider: Provider
  readonly model: ImageModel<ImageApi>
} {
  const model: ImageModel<ImageApi> = {
    type: "image",
    id: "banner",
    name: "scripted banner",
    api: "scripted-images",
    provider: "scripted-images",
    baseUrl: "",
    input: ["text"],
    output: ["image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
  const provider = createProvider({
    id: "scripted-images",
    auth: { apiKey: { name: "Scripted", resolve: async () => ({ auth: {} }) } },
    models: [model],
    images: {
      [model.api]: {
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
    },
  })
  return { provider, model }
}
