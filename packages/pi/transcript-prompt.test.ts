// A lane's prompt kept in its transcript: the request shape, the sections in
// view, and the patch a run starts with. In packages/pi because it reads pi's
// entries and pi-ai's transcript.

import type { Entry } from "@earendil-works/pi-agent-core"
import {
  type Context,
  getModel,
  getSystemMessageText,
  type Message,
  type SystemMessage,
  streamSimple,
  type Tool,
} from "@earendil-works/pi-ai/compat"
import { describe, expect, test } from "vitest"
import {
  leadWithTranscriptPrompt,
  type PromptSections,
  promptPatch,
  sectionsInView,
} from "./transcript-prompt.ts"

const sections = (context: string): PromptSections => ({
  preamble: "You are an expert coding assistant.",
  rules: "<rules>\n- Be concise\n</rules>",
  project_context: `<project_context>\n${context}\n</project_context>`,
  cwd: "<cwd>\n/workspace\n</cwd>",
})
const OLD = sections("AGENTS.md, version 1")
const NEW = sections("AGENTS.md, version 2")

const system = (
  s: Readonly<Record<string, string | null>>,
  timestamp = 0,
): SystemMessage => ({ role: "system", content: "", sections: s, timestamp })
const user = (text: string, timestamp: number): Message => ({
  role: "user",
  content: text,
  timestamp,
})
const reply: Message = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: "let me think", thinkingSignature: "SIG-1" },
    { type: "text", text: "first answer" },
  ],
  api: "anthropic-messages",
  provider: "anthropic",
  model: "claude-opus-5-5",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 2,
}
const TOOL: Tool = {
  name: "bash",
  description: "Run a command",
  parameters: {
    type: "object",
    properties: { cmd: { type: "string" } },
    required: ["cmd"],
  } as never,
}
const promptText = (s: PromptSections) =>
  getSystemMessageText({ ...system(s), sections: s })

describe("leadWithTranscriptPrompt", () => {
  test("leads with the first system message, the tools on it, and no prompt or tools beside", () => {
    const patch = system({ cwd: "<cwd>\n/elsewhere\n</cwd>" }, 3)
    const context: Context = {
      systemPrompt: "the harness's own",
      tools: [TOOL],
      messages: [user("one", 1), system(OLD), reply, patch, user("two", 4)],
    }
    expect(leadWithTranscriptPrompt(context)).toEqual({
      messages: [
        { ...system(OLD), toolsAdded: [TOOL] },
        user("one", 1),
        reply,
        patch,
        user("two", 4),
      ],
    })
  })

  test("a context with no system message is sent as the harness made it", () => {
    const context: Context = {
      systemPrompt: "the harness's own",
      tools: [TOOL],
      messages: [user("one", 1)],
    }
    expect(leadWithTranscriptPrompt(context)).toBe(context)
  })
})

describe("sectionsInView", () => {
  const message = (m: Message): Entry =>
    ({ type: "message", message: m }) as unknown as Entry

  test("folds every patch over the first prompt, in order", () => {
    const entries = [
      message(system(OLD)),
      message(user("one", 1)),
      message(system({ project_context: NEW.project_context ?? "" })),
    ]
    expect(sectionsInView(entries)).toEqual(NEW)
  })

  test("starts at a compaction's retained tail", () => {
    const compaction = {
      type: "compaction",
      retainedTail: [system(OLD), user("kept", 1)],
    } as unknown as Entry
    expect(sectionsInView([compaction, message(user("after", 2))])).toEqual(OLD)
  })

  test("a lane that holds no prompt has none in view", () => {
    expect(sectionsInView([message(user("one", 1))])).toBeNull()
  })
})

describe("promptPatch", () => {
  test("every section when none is in view, and no section counted as changed", () => {
    expect(promptPatch(null, OLD, 5)).toEqual({
      message: system(OLD, 5),
      changed: [],
    })
  })

  test("only the sections that differ, named as changed", () => {
    expect(promptPatch(OLD, NEW, 5)).toEqual({
      message: system({ project_context: NEW.project_context ?? "" }, 5),
      changed: ["project_context"],
    })
  })

  test("a section gone is removed", () => {
    const { cwd: _, ...without } = OLD
    expect(promptPatch(OLD, without, 5)?.message.sections).toEqual({
      cwd: null,
    })
  })

  test("nothing when the prompt in view is the prompt now", () => {
    expect(promptPatch(OLD, { ...OLD }, 5)).toBeNull()
  })
})

/**
 * What pi-ai would send for `context`, through `leadWithTranscriptPrompt`:
 * the payload is caught in `onPayload`, which throws, so nothing is sent.
 */
async function payloadFor(
  provider: string,
  id: string,
  context: Context,
): Promise<{
  readonly system?: unknown
  readonly messages?: unknown[]
  readonly input?: unknown[]
}> {
  const model = getModel(provider as never, id as never) as unknown as {
    baseUrl: string
  }
  let seen: unknown
  const stream = streamSimple(
    { ...model, baseUrl: "http://127.0.0.1:9" } as never,
    leadWithTranscriptPrompt({ ...context, tools: [TOOL] }),
    {
      apiKey: "x",
      reasoning: "high",
      onPayload: (payload: unknown) => {
        seen = structuredClone(payload)
        throw new Error("captured")
      },
    } as never,
  )
  for await (const _ of stream) {
  }
  if (seen === undefined) throw new Error(`no payload for ${provider}/${id}`)
  return seen as never
}

describe("the request pi-ai sends from a transcript's prompt", () => {
  const before = { messages: [system(OLD), user("one", 1), reply] }
  const patched = (change: Readonly<Record<string, string | null>>) => ({
    messages: [...before.messages, system(change, 3), user("two", 4)],
  })

  test("a model that takes mid-conversation system messages keeps every byte before the change", async () => {
    const change = patched({ project_context: NEW.project_context ?? "" })
    const opus = {
      before: await payloadFor("anthropic", "claude-opus-5-5", before),
      after: await payloadFor("anthropic", "claude-opus-5-5", change),
    }
    expect(opus.after.system).toEqual(opus.before.system)
    // The user's message and the reply, as before the change.
    expect(opus.after.messages?.slice(0, 2)).toEqual(
      opus.before.messages?.slice(0, 2),
    )
    const gpt = {
      before: await payloadFor("openai", "gpt-5.5", before),
      after: await payloadFor("openai", "gpt-5.5", change),
    }
    const kept = gpt.before.input?.length ?? 0
    expect(gpt.after.input?.slice(0, kept)).toEqual(gpt.before.input)
  })

  test("a model that folds system messages is sent a replaced section in its place, and a new one last", async () => {
    const sonnet = (context: Context) =>
      payloadFor("anthropic", "claude-sonnet-4-5", context)
    const fresh = await sonnet({
      messages: [system(NEW), user("one", 1), reply, user("two", 4)],
    })
    const replaced = await sonnet(
      patched({ project_context: NEW.project_context ?? "" }),
    )
    expect(replaced.system).toEqual(fresh.system)
    const added = await sonnet(patched({ skills: "<skills>\nnone\n</skills>" }))
    expect(JSON.stringify(added.system)).toContain(
      JSON.stringify(`${promptText(OLD)}\n\n<skills>\nnone\n</skills>`).slice(
        1,
        -1,
      ),
    )
  })
})
