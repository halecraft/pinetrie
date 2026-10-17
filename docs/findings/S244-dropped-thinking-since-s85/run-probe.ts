// A lane's run that starts with a system message, its prompt in view, a reply's
// diagnostics shrunk in after_response, and a compaction that carries the
// folded prompt into its retained tail.
// Run from packages/pi, copied in, since pi resolves from there:
//   cp ../../docs/findings/S244-dropped-thinking-since-s85/run-probe.ts _probe.ts && node _probe.ts; rm _probe.ts
import { BACKGROUND_CONTEXT as CTX, MemorySessionRepo } from "@earendil-works/pi-agent-core"
import { createModels, fauxAssistantMessage, fauxProvider, getCurrentSystemMessage } from "@earendil-works/pi-ai"
import { createAgentHarness } from "./deep.ts"

const faux = fauxProvider({ models: [{ id: "faux-1", contextWindow: 4000 }] })
const seen: string[] = []
faux.setResponses(Array.from({ length: 30 }, () => (ctx: any) => {
  seen.push(ctx.messages.map((m: any) => m.role === "system" ? `system{${Object.keys(m.sections ?? {})}}${m.toolsAdded ? "+tools" : ""}` : m.role).join(" "))
  const r = fauxAssistantMessage("reply " + "x".repeat(400)) as any
  r.diagnostics = [{ type: "anthropic_input_transformations", timestamp: 1, details: { transformations: [{ type: "thinking_dropped", path: "messages.1.content.0", reason: "prefix_binding_mismatch" }, { type: "thinking_dropped", path: "messages.4.content.0", reason: "prefix_binding_mismatch" }] } }]
  return r
}))
const models = createModels(); models.setProvider(faux.provider)
const session = await (new MemorySessionRepo()).create({}, CTX)
const tool = { name: "noop", label: "noop", description: "d", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }) }
const { harness } = await createAgentHarness({ session, models, model: faux.getModel(), tools: [tool as never], activeToolNames: ["noop"], systemPrompt: "FRESH", compaction: { enabled: true, reserveTokens: 500, keepRecentTokens: 600 } as never } as never, CTX)
harness.hooks.on("after_response", async (e: any) => {
  const d = e.message.diagnostics
  return d === undefined ? undefined : { message: { ...e.message, diagnostics: d.map((x: any) => ({ type: x.type, timestamp: x.timestamp, details: { dropped: x.details.transformations.length } })) } }
})
const SYS = (s: Record<string, string>) => ({ role: "system", content: "", sections: s, timestamp: Date.now() })
let carried = 0
harness.hooks.on("before_compaction", async (e: any) => {
  const p = e.preparation
  const sys = [...p.messagesToSummarize, ...p.turnPrefixMessages].filter((m: any) => m.role === "system")
  const folded = getCurrentSystemMessage(sys as never)
  if (folded === undefined) return undefined
  carried++
  const { compact } = await import("@earendil-works/pi-agent-core")
  const done: any = await (compact as any)(p, models, faux.getModel(), e.customInstructions, undefined, undefined, undefined, CTX)
  return done.ok ? { compaction: { ...done.value, retainedTail: [folded, ...done.value.retainedTail] } } : undefined
})
const lane = await harness.lane("a", { createAt: null }, CTX)
const r1 = await lane.prompt([SYS({ preamble: "P", project_context: "v1" }), { role: "user", content: "one", timestamp: Date.now() }] as never, CTX)
console.log("prompt([system,user]) ok:", (r1 as any).ok)
await lane.prompt([SYS({ project_context: "v2" }), { role: "user", content: "two", timestamp: Date.now() }] as never, CTX)
const inView = async () => {
  const es = (await lane.findEntries({ stopAtType: "compaction", order: "newestFirst" } as never, CTX)).reverse() as any[]
  const msgs = es.flatMap(e => e.type === "compaction" ? (e.retainedTail ?? []) : e.type === "message" ? [e.message] : [])
  return { types: es.map(e => e.type).join(" "), sections: getCurrentSystemMessage(msgs as never)?.sections }
}
console.log("in view before compaction:", JSON.stringify(await inView()))
const all = await lane.findEntries(undefined, CTX) as any[]
console.log("stored diagnostics:", JSON.stringify(all.filter(e => e.message?.role === "assistant").map(e => e.message.diagnostics)[0]))
for (let n = 0; n < 6; n++) await lane.prompt("turn " + n + " " + "y".repeat(800), undefined, CTX)
const c = await lane.compact(undefined, CTX)
console.log("compaction ok", (c as any).ok, "carried calls", carried)
const ce = (await lane.findEntries({ type: "compaction" } as never, CTX)) as any[]
console.log("compaction entry keys:", Object.keys(ce.at(-1) ?? {}).join(","))
console.log("in view after compaction:", JSON.stringify(await inView()))
await lane.prompt("after", undefined, CTX)
console.log("provider saw, last:", seen.at(-1))
