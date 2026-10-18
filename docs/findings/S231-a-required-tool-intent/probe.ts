// The probe of S231 (docs/findings/S231-a-required-tool-intent.md). Disposable.
//
// A small agent loop on the model your threads run on, with the host's
// credentials: pi's setup is loaded as the host loads it (`loadPiSetup`),
// from your config and this folder's `pinetrie.json`, and each turn is pi's
// own `completeSimple`, so tools are sent as pi sends them, strict where the
// model supports it. The tools are pi's `bash`, `read`, `edit` and `write`
// (their descriptions, schemas and `execute`), each schema given a required
// `intent` first, as the plan would. Arguments are checked with pi's
// `validateToolArguments`, and a failure goes back to the model as an error
// result, as pi-agent-core's loop does. It runs each task in `tasks.md` in a
// scratch copy of a repo, and records every call.
//
//   cp docs/findings/S231-a-required-tool-intent/probe.ts packages/pi/intent-probe.ts
//   git clone . /tmp/intent-work   # or any scratch copy; the tasks edit it
//   (cd /tmp/intent-work && pnpm install --frozen-lockfile)
//   node packages/pi/intent-probe.ts /tmp/intent-work
//   PROBE_STRICT=0 PROBE_OUT=/tmp/s231-loose node packages/pi/intent-probe.ts /tmp/intent-work
//
// PROBE_STRICT=0 turns constrained sampling off for every tool, so the model
// is free to leave `intent` out, as on a provider without it. Writes
// `intent-report.md` and `intent.jsonl` to PROBE_OUT (default /tmp/s231).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import {
  type Message,
  type ToolCall,
  Type,
  validateToolArguments,
} from "@earendil-works/pi-ai"
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent"
// Relative, since this package does not depend on them: a probe only.
import { folderReport, SETTINGS } from "../../apps/pinetrie/host/settings.ts"
import { configPlaces, readStartLayers } from "../config/index.ts"
import { bindAgentDir } from "./agent-dir.ts"
import { loadPiSetup, setupInside } from "./pi-setup.ts"

const [cwd] = process.argv.slice(2)
const STRICT = process.env.PROBE_STRICT !== "0"
const MAX_STEPS = Number(process.env.PROBE_STEPS ?? 30)
const OUT = process.env.PROBE_OUT ?? "/tmp/s231"
if (cwd === undefined) {
  console.error("usage: node packages/pi/intent-probe.ts <scratch repo>")
  process.exit(2)
}
mkdirSync(OUT, { recursive: true })

// pi's setup as the host loads it: your config, then this folder's file.
const places = configPlaces(process.env, homedir(), null)
const { settled } = await folderReport(
  await readStartLayers(SETTINGS, places, process.env),
  process.cwd(),
)
const pi = await loadPiSetup({
  model: { kind: "configured", model: settled.model.value },
  places: {
    configDir: places.dirs.config,
    credentials: places.credentials,
    models: places.models,
  },
  binding: bindAgentDir(places.dirs.config),
  lists: { packages: settled.packages.value, skills: [], prompts: [] },
  project: process.cwd(),
})
const { setup } = setupInside.open(pi)
if (setup.model.kind !== "model") {
  console.error(`no model: ${JSON.stringify(pi.model)}`)
  process.exit(2)
}
const model = setup.model.model
const MODEL = `${model.provider}/${model.id}`

/** The candidate description, the same for every tool. */
const INTENT = Type.String({
  description:
    'What this call is for, in a few plain words a person who is not a programmer can follow, e.g. "Run the unit tests" or "Find where tokens are refreshed". Shown in place of the call.',
})

type Tool = ReturnType<typeof createBashTool>
const tools: Tool[] = [
  createBashTool(cwd, { exposeSessionEnvironment: false }),
  createReadTool(cwd) as unknown as Tool,
  createEditTool(cwd) as unknown as Tool,
  createWriteTool(cwd) as unknown as Tool,
].map(t => ({
  ...t,
  parameters: Type.Object({
    intent: INTENT,
    ...(t.parameters as unknown as { properties: Record<string, never> })
      .properties,
  }) as unknown as Tool["parameters"],
  ...(STRICT ? {} : { constrainedSampling: false }),
}))

const SYSTEM = [
  "You are an expert coding assistant working in a repository.",
  `Your working directory is ${cwd}.`,
  "Use the tools to answer or do what is asked, then reply with a short answer.",
  "Available tools:",
  ...tools.map(
    t =>
      `- ${t.name}: ${(t as { promptSnippet?: string }).promptSnippet ?? t.description}`,
  ),
].join("\n")

const resultText = (content: readonly unknown[]): string =>
  content
    .map(c =>
      typeof c === "object" && c !== null && "text" in c
        ? String((c as { text: unknown }).text)
        : "[non-text result]",
    )
    .join("\n")
    .slice(0, 20_000)

/** What a person would see today in place of an intent. */
const target = (input: Record<string, unknown>): string =>
  String(input.command ?? input.path ?? "")
    .split("\n")[0]
    ?.slice(0, 120) ?? ""

const tasks = readFileSync(
  path.resolve("docs/findings/S231-a-required-tool-intent", "tasks.md"),
  "utf8",
)
  .split(/^## /m)
  .slice(1)
  .map(t => t.trim())

const jsonl: unknown[] = []
const report: string[] = []
const counts = { calls: 0, refused: 0, missingIntent: 0, emptyIntent: 0 }

for (const task of tasks) {
  const [title = "", ...rest] = task.split("\n")
  report.push(
    `## ${title}\n`,
    "| tool | intent | call | ok |",
    "|---|---|---|---|",
  )
  const messages: Message[] = [
    { role: "user", content: rest.join("\n").trim(), timestamp: Date.now() },
  ]
  let answer = ""
  for (let step = 0; step < MAX_STEPS; step++) {
    const reply = await setup.models.completeSimple(model, {
      systemPrompt: SYSTEM,
      messages,
      tools,
    })
    if (reply.stopReason === "error")
      throw new Error(`the model failed: ${JSON.stringify(reply)}`)
    messages.push(reply)
    const calls = reply.content.filter(
      (b): b is ToolCall => b.type === "toolCall",
    )
    answer = reply.content
      .flatMap(b => (b.type === "text" ? [b.text] : []))
      .join("")
    if (calls.length === 0) break
    for (const call of calls) {
      counts.calls += 1
      const input = call.arguments as Record<string, unknown>
      const tool = tools.find(t => t.name === call.name)
      const intent = input.intent
      if (intent === undefined) counts.missingIntent += 1
      else if (typeof intent !== "string" || intent.trim() === "")
        counts.emptyIntent += 1
      let text: string
      let isError = false
      try {
        if (tool === undefined) throw new Error(`Tool ${call.name} not found`)
        const args = validateToolArguments(tool as never, call) as Record<
          string,
          unknown
        >
        const { intent: _, ...params } = args
        const out = await tool.execute(
          call.id,
          params as never,
          AbortSignal.timeout(120_000),
        )
        text = resultText(out.content)
      } catch (error) {
        isError = true
        counts.refused += 1
        text = error instanceof Error ? error.message : String(error)
      }
      messages.push({
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: "text", text }],
        isError,
        timestamp: Date.now(),
      })
      jsonl.push({ task: title, step, tool: call.name, input, isError })
      report.push(
        `| ${call.name} | ${typeof intent === "string" ? intent : "**(none)**"} | \`${target(input).replace(/\|/g, "\\|")}\` | ${isError ? "✗" : "✓"} |`,
      )
    }
  }
  report.push(
    `\n**Answer:** ${answer.slice(0, 600).replace(/\n/g, " ")}\n`,
    "**Your read** (would the intents alone tell you what happened? any vague or wrong?): \n",
  )
}

report.unshift(
  `# intent probe: ${MODEL}${STRICT ? "" : " (constrained sampling off)"}\n`,
  `${counts.calls} calls, ${counts.missingIntent} without intent, ${counts.emptyIntent} with an empty one, ${counts.refused} refused (any reason).\n`,
)
writeFileSync(path.join(OUT, "intent-report.md"), report.join("\n"))
writeFileSync(
  path.join(OUT, "intent.jsonl"),
  jsonl.map(j => JSON.stringify(j)).join("\n"),
)
console.log(`wrote ${OUT}/intent-report.md`)
