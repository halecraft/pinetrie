// What pi-ai sends when a later system message patches a section, per provider.
// Run from packages/pi, copied in, since pi resolves from there:
//   cp ../../docs/findings/S244-dropped-thinking-since-s85/payload-probe.ts _probe.ts && node _probe.ts; rm _probe.ts
// Each request goes to a closed port; only the payload (onPayload) is kept.
import { getModel, streamSimple } from "@earendil-works/pi-ai/compat"
import { getSystemMessageText } from "@earendil-works/pi-ai"

const sections = (ctx: string) => ({
  preamble: "You are an expert coding assistant.",
  rules: "<rules>\n- Be concise\n</rules>",
  project_context: `<project_context>\n${ctx}\n</project_context>`,
  cwd: "<cwd>\n/workspace\n</cwd>",
})
const OLD = sections("AGENTS.md, version 1")
const NEW = sections("AGENTS.md, version 2")
const render = (s: Record<string, string>) =>
  getSystemMessageText({ role: "system", content: "", sections: s, timestamp: 0 } as never)

const tool = {
  name: "bash",
  description: "Run a command",
  parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
}
const u = (text: string, t: number) => ({ role: "user", content: text, timestamp: t })
const a1 = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: "let me think", thinkingSignature: "SIG-1" },
    { type: "text", text: "first answer" },
  ],
  api: "anthropic-messages", provider: "anthropic", model: "claude-opus-5-5",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  stopReason: "stop", timestamp: 2,
}
const patch = { role: "system", content: "", sections: { project_context: NEW.project_context }, timestamp: 3 }

const cases = {
  before: { systemPrompt: render(OLD), messages: [u("one", 1), a1, u("two", 4)] },
  patched: { systemPrompt: render(OLD), messages: [u("one", 1), a1, patch, u("two", 4)] },
  fresh: { systemPrompt: render(NEW), messages: [u("one", 1), a1, u("two", 4)] },
  // The prompt as a leading system message of sections, beside the request's tools.
  leadingSections: {
    messages: [{ role: "system", content: "", sections: OLD, timestamp: 0 }, u("one", 1), a1, patch, u("two", 4)],
  },
  // The prompt and the tools both in the leading system message, as pi's own agent loop sends them.
  leadingWithTools: {
    noTools: true,
    messages: [{ role: "system", content: "", sections: OLD, toolsAdded: [tool], timestamp: 0 }, u("one", 1), a1, patch, u("two", 4)],
  },
} as const

async function payloadOf(model: any, context: any): Promise<any> {
  let seen: unknown
  const s = streamSimple({ ...model, baseUrl: "http://127.0.0.1:9" }, { ...context, ...(context.noTools ? {} : { tools: [tool] }) }, {
    apiKey: "x",
    reasoning: "high",
    onPayload: p => {
      seen = structuredClone(p)
      throw new Error("captured")
    },
  } as never)
  for await (const _ of s) {
  }
  return seen
}

const models: [string, string][] = [
  ["anthropic", "claude-opus-5-5"],
  ["anthropic", "claude-sonnet-4-5"],
  ["openai", "gpt-5.5"],
]
for (const [provider, id] of models) {
  const model = getModel(provider as never, id as never) as any
  if (model === undefined) {
    console.log(`${provider}/${id}: no such model`)
    continue
  }
  console.log(`\n=== ${provider}/${id} (api ${model.api}, mid-conversation system: ${model.compat?.supportsMidConvoSystemMessages === true})`)
  for (const [name, ctx] of Object.entries(cases)) {
    const p = await payloadOf(model, ctx)
    console.log(`--- ${name}`)
    const short = (k: string, v: any) => (k === "tools" ? `[${v.length} tools]` : v)
    const { system, instructions, messages, input, tools } = p ?? {}
    console.log(JSON.stringify({ system, instructions, tools, messages: messages ?? input }, short))
  }
}
