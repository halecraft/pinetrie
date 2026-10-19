// S251 probe: ask vision models for a short gist of each image, with
// pine·trie's own credentials. Needs a model key, so it runs where the
// person signed in, not in a lane. Run from packages/pi, copied in, since pi
// resolves from there:
//   cp ../../docs/findings/S251-a-gist-of-each-image/probe.ts _probe.ts && node _probe.ts; rm _probe.ts
// More models: node _probe.ts openrouter/google/gemini-3-flash-preview …
// More images: PINETRIE_GIST_IMAGES=/path/a.jpg,/path/b.png node _probe.ts
// It writes output.json beside itself, and prints what each model said.
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { openRuntime } from "./deep.ts"

const HERE = path.resolve("../../docs/findings/S251-a-gist-of-each-image")
const env = process.env
const abs = (v: string | undefined) => (v !== undefined && path.isAbsolute(v) ? v : null)
// pine·trie's places (`configPlaces`, packages/config/places.ts), without a session.
const data = path.join(abs(env.XDG_DATA_HOME) ?? path.join(homedir(), ".local", "share"), "pinetrie")
const config = path.join(abs(env.XDG_CONFIG_HOME) ?? path.join(homedir(), ".config"), "pinetrie")
const runtime = await openRuntime({ authPath: path.join(data, "auth.json"), modelsPath: path.join(config, "models.json") })

const CANDIDATES = [
  "openrouter/google/gemini-3.1-flash-lite",
  "openrouter/google/gemini-2.5-flash-lite",
  "openrouter/qwen/qwen3-vl-8b-instruct",
  "openrouter/openai/gpt-5-nano",
  "openrouter/anthropic/claude-haiku-4.5",
  "cerebras/qwen-3.8-27b",
  ...process.argv.slice(2),
]

const SYSTEM = [
  "You write the gist of an image for agents and people who cannot see it.",
  "In at most 60 words of plain prose, no preamble: what kind of image it is",
  "(screenshot, photo, diagram, drawing, chart, mockup), its subject, any text",
  "that carries meaning, and what would tell it apart from a similar image.",
].join(" ")

const images = [
  ...readdirSync(path.join(HERE, "images")).sort().map(f => path.join(HERE, "images", f)),
  ...(env.PINETRIE_GIST_IMAGES ?? "").split(",").filter(p => p !== ""),
]
const mimeOf = (f: string) => (/\.jpe?g$/i.test(f) ? "image/jpeg" : /\.webp$/i.test(f) ? "image/webp" : /\.gif$/i.test(f) ? "image/gif" : "image/png")

const results: Record<string, unknown>[] = []
for (const ref of CANDIDATES) {
  const [provider = "", ...rest] = ref.split("/")
  const id = rest.join("/")
  const model = runtime.getModel(provider, id)
  if (model === undefined) { console.log(`${ref}: pi lists no such model`); results.push({ model: ref, skipped: "not listed" }); continue }
  if (!model.input.includes("image")) { console.log(`${ref}: takes no images`); results.push({ model: ref, skipped: "no image input" }); continue }
  const auth = await runtime.getAuth(provider).catch(() => undefined)
  if (auth === undefined) { console.log(`${ref}: no credential for ${provider}`); results.push({ model: ref, skipped: "no credential" }); continue }
  for (const file of images) {
    const started = performance.now()
    try {
      const reply = await runtime.completeSimple(model, {
        systemPrompt: SYSTEM,
        messages: [{
          role: "user",
          timestamp: Date.now(),
          content: [
            { type: "text", text: `The image's name: ${path.basename(file)}` },
            { type: "image", data: readFileSync(file).toString("base64"), mimeType: mimeOf(file) },
          ],
        }],
      }, model.reasoning ? { reasoning: "minimal" } : {})
      const text = reply.content.flatMap(p => (p.type === "text" ? [p.text] : [])).join("").trim()
      const row = {
        model: ref,
        image: path.basename(file),
        stop: reply.stopReason,
        error: reply.errorMessage ?? null,
        gist: text,
        words: text.split(/\s+/).filter(w => w !== "").length,
        inputTokens: reply.usage?.input ?? null,
        outputTokens: reply.usage?.output ?? null,
        reasoningTokens: reply.usage?.reasoning ?? null,
        costUsd: reply.usage?.cost.total ?? null,
        ms: Math.round(performance.now() - started),
      }
      results.push(row)
      console.log(`\n${ref} · ${row.image} · ${row.inputTokens}+${row.outputTokens} tokens · $${row.costUsd?.toFixed(5)} · ${row.ms} ms${row.error ? ` · ERROR ${row.error}` : ""}\n  ${text}`)
    } catch (error) {
      results.push({ model: ref, image: path.basename(file), thrown: String(error) })
      console.log(`${ref} · ${path.basename(file)}: threw ${String(error)}`)
    }
  }
}
writeFileSync(path.join(HERE, "output.json"), JSON.stringify({ system: SYSTEM, results }, null, 1))
console.log(`\nwrote ${path.join(HERE, "output.json")}`)
