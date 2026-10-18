// The probe of S239 (docs/findings/S239-a-topic-that-follows-the-work.md),
// S229's (docs/findings/S229-a-headline-for-every-long-ask.md) with
// three changes to its topic mode. Disposable.
//
// - Each long ask with no stored headline is given one, asked with S229's
//   digest skill as the plan will, so the topic reads what the plan gives it.
// - A failed request keeps the topic, as the host keeps a stored record.
// - A topic is refused over 10 words; the skill asks for 8.
//
// It asks the model and sign-in the host uses (`loadPiSetup`, `complete`).
// The skills are read from PROBE_DIGEST_SKILL and PROBE_TOPIC_SKILL. Run it
// beside the host, on a copy of the store taken while the host is stopped:
//
//   node apps/pinetrie/host/topic-probe.ts topic /tmp/probe.db [limit]
//
// It writes `topic-report.md` and `topic.jsonl` to PROBE_OUT, and nothing to
// the store.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { Exchange } from "@kyneta/exchange"
import { configPlaces, readStartLayers } from "@pinetrie/config"
import {
  type AskIndex,
  type EntryId,
  indexAsks,
  isLongAsk,
  lastWord,
  projectTranscript,
  rootDocId,
  type ThreadId,
  threadEnd,
  type TreeIndex,
} from "@pinetrie/core"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import {
  readDigests,
  readNames,
  readThreads,
  readTreeIndex,
} from "@pinetrie/reads"
import { bindAgentDir, loadPiSetup } from "@pinetrie/pi"
import { askLines, digestRequest } from "@pinetrie/rules"
import { RootDoc, type RootDocHandle, SessionDoc } from "@pinetrie/schema"
import { folderReport, SETTINGS } from "./settings.ts"
import { openStore } from "./store.ts"

const [mode, file, limitArg] = process.argv.slice(2)
if ((mode !== "digest" && mode !== "topic") || file === undefined) {
  console.error("usage: <digest|topic> <store copy> [limit]")
  process.exit(2)
}
const OUT = process.env.PROBE_OUT ?? "/tmp/s229"
mkdirSync(OUT, { recursive: true })
const skill = (name: string): string => {
  const file = process.env[name]
  if (file === undefined) {
    console.error(`set ${name}`)
    process.exit(2)
  }
  return readFileSync(file, "utf8")
}
const DIGEST_SKILL = skill("PROBE_DIGEST_SKILL")
const TOPIC_SKILL = skill("PROBE_TOPIC_SKILL")

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
if (pi.model.kind !== "model") {
  console.error(`no model: ${JSON.stringify(pi.model)}`)
  process.exit(2)
}
const MODEL = pi.model.label

async function complete(system: string, user: string): Promise<string | null> {
  return (await pi.complete({ system, user })).text
}

// ── the candidate reply shapes ────────────────────────────────────────────

const words = (t: string) => t.split(/\s+/).filter(w => w !== "").length
const BULLET = /^[-*] +/
const bare = (t: string) => t.trim().replace(/[.:;,!]+$/, "").trim()

/** The candidate digest: a headline always, then up to four points. */
function readDigest(
  reply: string,
): { headline: string; points: string[] } | { refused: string } {
  const lines = reply
    .split("\n")
    .map(l => l.trim())
    .filter(l => l !== "")
  const [first, ...rest] = lines
  if (first === undefined) return { refused: "empty" }
  if (BULLET.test(first)) return { refused: "no headline" }
  if (bare(first).toLowerCase() === "nothing to add")
    return { refused: "old sentinel" }
  const headline = bare(first.replace(/^#+\s*/, ""))
  if (words(headline) > 14) return { refused: "headline too long" }
  if (rest.length > 4) return { refused: "too many points" }
  if (!rest.every(l => BULLET.test(l))) return { refused: "not a list" }
  const points = rest.map(l => l.replace(BULLET, "").trim())
  if (points.some(p => words(p) > 40)) return { refused: "point too long" }
  return { headline, points }
}

/** The candidate topic reply: `same`, or a topic of at most eight words. */
function readTopic(
  reply: string,
): { kind: "same" } | { kind: "topic"; topic: string } | { refused: string } {
  const lines = reply.split("\n").filter(l => l.trim() !== "")
  if (lines.length !== 1) return { refused: "not one line" }
  const t = bare(lines[0] ?? "").replace(/^["'`]|["'`]$/g, "")
  if (t.toLowerCase() === "same") return { kind: "same" }
  if (t === "" || words(t) > 10) return { refused: "too long" }
  return { kind: "topic", topic: t }
}

// ── the store ─────────────────────────────────────────────────────────────

const { store } = openStore(file)
const ex = new Exchange({
  principal: "probe",
  type: "service",
  transports: [],
  store,
})
const session = ex.get(SESSION_DOC_ID, SessionDoc)
await ex.whenHydrated(SESSION_DOC_ID)
const threads = readThreads(session)
const names = readNames(session)
const roots = new Set([...threads.values()].map(t => t.root))
const rootDocs = new Map<string, RootDocHandle>()
for (const root of roots) {
  const id = rootDocId(root)
  rootDocs.set(root, ex.get(id, RootDoc))
  await ex.whenHydrated(id)
}

const clip = (t: string | null, n = 400) =>
  t === null ? "" : t.length > n ? `${t.slice(0, n)}…` : t
const md = (t: string) => t.replace(/\n/g, "\n> ")
const jsonl: unknown[] = []
const report: string[] = [`# ${mode} probe: ${MODEL}\n`]

if (mode === "digest") {
  const limit = Number(limitArg ?? 40)
  // Every ended long ask, newest first by its prompt's uuidv7.
  const found: { root: string; ask: EntryId }[] = []
  for (const [root, doc] of rootDocs) {
    const index = readTreeIndex(doc)
    const asks = indexAsks(index)
    for (const ask of asks.work.keys())
      if (isLongAsk(asks, ask) && lastWord(index, asks, ask) !== null)
        found.push({ root, ask })
  }
  found.sort((a, b) => (a.ask < b.ask ? 1 : -1))
  const counts = { asked: 0, refused: 0, withPoints: 0 }
  for (const { root, ask } of found.slice(0, limit)) {
    const doc = rootDocs.get(root)
    if (doc === undefined) continue
    const index = readTreeIndex(doc)
    const asks = indexAsks(index)
    const lines = askLines(index, asks, ask)
    if (lines === null) continue
    const request = digestRequest({
      answer: "digest",
      skill: DIGEST_SKILL,
      ask: lines.said,
      work: lines.work,
      shown: lines.shown,
      previous: null,
      budget: 12_000,
    })
    const reply = (await complete(request.system, request.user)) ?? ""
    const read = readDigest(reply)
    const stored = readDigests(doc).get(ask)
    counts.asked += 1
    if ("refused" in read) counts.refused += 1
    else if (read.points.length > 0) counts.withPoints += 1
    jsonl.push({ ask, said: lines.said, shown: lines.shown, stored, reply, read })
    report.push(
      `## ${ask}\n`,
      `**Asked:** ${clip(lines.said, 300)}\n`,
      `**Work:** ${lines.work.length} messages\n`,
      `**Last word:**\n> ${md(clip(lines.shown, 600))}\n`,
      `**Stored digest:** ${stored === undefined ? "none" : stored.headline === null ? "nothing to add" : `${stored.headline}${stored.points.map(p => `\n- ${p}`).join("")}`}\n`,
      `**Candidate:** ${"refused" in read ? `REFUSED (${read.refused})` : "ok"}\n> ${md(reply)}\n`,
      "**Your read** (headline useful? restates the last word? points add?): \n",
    )
  }
  report.splice(
    1,
    0,
    `${counts.asked} asks, ${counts.refused} refused, ${counts.withPoints} with points.\n`,
  )
} else {
  const limit = Number(limitArg ?? 12)
  const own = [...threads.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap(t => {
      const doc = rootDocs.get(t.root)
      if (doc === undefined) return []
      const index = readTreeIndex(doc)
      const asks = indexAsks(index)
      const end = threadEnd(index, t.thread)
      if (end === null) return []
      const path = projectTranscript(index, end)
      const mine = path.filter(
        m => m.thread === t.thread && asks.work.has(m.id),
      )
      return mine.length >= 2 ? [{ t, doc, index, asks, mine }] : []
    })
    .slice(0, limit)
  const counts = { threads: 0, requests: 0, changes: 0, refused: 0 }
  /** A long ask's headline: its stored one, else one asked for as the plan will. */
  const headlineOf = async (
    index: TreeIndex,
    asks: AskIndex,
    stored: string | null,
    ask: EntryId,
  ): Promise<string | null> => {
    if (stored !== null || !isLongAsk(asks, ask)) return stored
    const lines = askLines(index, asks, ask)
    if (lines === null) return null
    const request = digestRequest({
      answer: "digest",
      skill: DIGEST_SKILL,
      ask: lines.said,
      work: lines.work,
      shown: lines.shown,
      previous: null,
      budget: 12_000,
    })
    const read = readDigest(
      (await complete(request.system, request.user)) ?? "",
    )
    return "refused" in read ? null : read.headline
  }
  for (const { t, doc, index, asks, mine } of own) {
    counts.threads += 1
    const digests = readDigests(doc)
    const name = names.get(t.thread as ThreadId) ?? t.thread
    report.push(`## ${name} (${mine.length} asks)\n`)
    let topic: string | null = null
    const seen: string[] = []
    for (const m of mine) {
      const headline = await headlineOf(
        index,
        asks,
        digests.get(m.id)?.headline ?? null,
        m.id,
      )
      seen.push(
        `- ${m.author ?? "someone"}: ${clip(m.text, 300).replace(/\n/g, " ")}${headline === null ? "" : `\n  (came of it: ${headline})`}`,
      )
      const asked = [seen[0], ...seen.slice(1).slice(-29)].join("\n")
      const user = `The thread's topic now: ${topic ?? "(none yet)"}\n\nWhat was asked in the thread, oldest first:\n${asked}\n`
      const reply = await complete(TOPIC_SKILL, user)
      const read = readTopic(reply ?? "")
      counts.requests += 1
      let line: string
      if (reply === null) {
        counts.refused += 1
        line = "the request failed: kept"
      } else if ("refused" in read) {
        counts.refused += 1
        line = `REFUSED (${read.refused}): ${reply}`
      } else if (read.kind === "same" || read.topic === topic) {
        line = "same"
      } else {
        counts.changes += topic === null ? 0 : 1
        line = `**→ ${read.topic}**`
        topic = read.topic
      }
      jsonl.push({ thread: t.thread, ask: m.id, reply, read, topic })
      report.push(
        `1. ${clip(m.text, 160).replace(/\n/g, " ")}\n   ${line}${headline === null ? "" : ` · (${headline})`}`,
      )
    }
    report.push("\n**Your read** (each → a real change? any missed?): \n")
  }
  report.splice(
    1,
    0,
    `${counts.threads} threads, ${counts.requests} requests, ${counts.changes} changes after the first topic, ${counts.refused} refused.\n`,
  )
}

writeFileSync(path.join(OUT, `${mode}-report.md`), report.join("\n"))
writeFileSync(
  path.join(OUT, `${mode}.jsonl`),
  jsonl.map(j => JSON.stringify(j)).join("\n"),
)
console.log(`wrote ${OUT}/${mode}-report.md`)
await ex.shutdown()
