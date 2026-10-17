// What pi's stable harness does with a system message appended to a lane:
// stored, read back, sent, inherited by a branch, kept by a compaction.
// Run from packages/pi (copied in, as it imports ./deep.ts):
//   cp ../../docs/findings/S244-dropped-thinking-since-s85/harness-probe.ts _probe.ts && node _probe.ts; rm _probe.ts
import { BACKGROUND_CONTEXT as CTX, MemorySessionRepo } from "@earendil-works/pi-agent-core"
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai"
import { createAgentHarness } from "./deep.ts"

const faux = fauxProvider({ models: [{ id: "faux-1", contextWindow: 4000 }] })
const seen: { label: string; roles: string; head: string; systemPrompt: string | undefined; tools: number }[] = []
let label = ""
faux.setResponses(Array.from({ length: 20 }, () => (ctx: any) => {
  const ms = ctx.messages as any[]
  seen.push({
    label,
    roles: ms.map(m => (m.role === "system" ? `system${m.sections ? `{${Object.keys(m.sections)}}` : ""}${m.toolsAdded ? `+${m.toolsAdded.length}tools` : ""}` : m.role)).join(" "),
    head: JSON.stringify(ms[0]).slice(0, 160),
    systemPrompt: undefined,
    tools: 0,
  })
  return fauxAssistantMessage(`reply ${seen.length} ` + "x".repeat(400))
}))
const models = createModels()
models.setProvider(faux.provider)
// What the harness hands the provider layer, before pi-ai normalizes it.
const handed: any[] = []
const wrapped = new Proxy(models, {
  get(t, k, r) {
    if (k === "streamSimple")
      return (model: any, context: any, options: any) => {
        handed.push({ label, systemPrompt: context.systemPrompt?.slice(0, 40), tools: context.tools?.length, roles: context.messages.map((m: any) => m.role).join(" ") })
        return t.streamSimple(model, context, options)
      }
    const v = Reflect.get(t, k, r)
    return typeof v === "function" ? v.bind(t) : v
  },
})

const repo = new MemorySessionRepo()
const session = await repo.create({}, CTX)
const tool = { name: "noop", label: "noop", description: "does nothing", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }) }
const { harness } = await createAgentHarness({
  session, models: wrapped as never, model: faux.getModel(), tools: [tool as never], activeToolNames: ["noop"],
  systemPrompt: "FRESH PROMPT", compaction: { enabled: true, reserveTokens: 500, keepRecentTokens: 600 } as never,
} as never, CTX)
const lane = await harness.lane("a", { createAt: null }, CTX)

label = "1 first prompt"
await lane.prompt("one", undefined, CTX)
const sysId = await lane.appendMessage({ role: "system", content: "", sections: { project_context: "<project_context>v2</project_context>" }, timestamp: Date.now() } as never, CTX)
console.log("appended system entry", sysId)
label = "2 after a system entry"
await lane.prompt("two", undefined, CTX)
const entries = await lane.findEntries(undefined, CTX)
console.log("stored entries:", entries.map((e: any) => `${e.type}:${e.message?.role ?? ""}`).join(" "))

// A branch from the tip: does it carry the system entry?
const tip = await lane.getTipId(CTX)
const branch = await harness.lane("b", { createAt: tip }, CTX)
label = "3 a branch from the tip"
await branch.prompt("three", undefined, CTX)

for (const n of [5, 6, 7, 8]) {
  label = `turn ${n}`
  await lane.prompt(`turn ${n} ` + "y".repeat(800), undefined, CTX)
}
label = "4 compaction's own request"
const compacted = await lane.compact(undefined, CTX)
console.log("compaction:", JSON.stringify(compacted).slice(0, 200))
label = "5 after compaction"
await lane.prompt("four", undefined, CTX)

for (const s of seen) console.log(`\n[${s.label}] provider saw: ${s.roles}\n   first: ${s.head}`)
console.log("\nwhat the harness handed streamSimple:")
for (const h of handed) console.log(`  [${h.label}] systemPrompt=${JSON.stringify(h.systemPrompt)} tools=${h.tools} messages=${h.roles}`)
