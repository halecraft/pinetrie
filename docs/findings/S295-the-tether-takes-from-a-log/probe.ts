// Run as apps/pinetrie/e2e/s295/probe.ts, beside plan.ts, with `node`:
// its imports resolve from there.
// S295's probe: a thread's intent log in Yjs, a tether that takes from it
// into pi through pine·trie's scribe and lanes with a scripted model, and
// the page's thread drawn from both. Uses pine·trie's packages unchanged.

import { createDoc, exportSince, merge, Schema, subscribe, version } from "@kyneta/schema"
import {
  atEntry,
  entryId,
  NOBODY,
  ROOT,
  THE_AGENT,
  type ThreadId,
  threadIdFor,
  writerId,
} from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import { decodeMessage, encodeMessage } from "@pinetrie/rules"
import { readEntries, readLaneTip, type RootDocHandle, rowMessage } from "@pinetrie/schema"
import { newRootDoc, newSessionDoc } from "@pinetrie/schema/fixtures"
import { yjs } from "/workspace/node_modules/.pnpm/@kyneta+yjs-schema@4.0.0_@kyneta+changefeed@4.0.0_@kyneta+schema@4.0.0_yjs@13.6.33/node_modules/@kyneta/yjs-schema/dist/index.js"
import { ONE_ROOT, oneRoot } from "../../../../packages/pi/one-root.ts"
import { startPi } from "../../../../packages/pi/start-pi.ts"
import {
  framedContent,
  type Intent,
  type Message,
  planTake,
  projectThread,
  type RecordItem,
  type Take,
} from "./plan.ts"

const out = (k: string, v: unknown) => console.log(`${k}: ${JSON.stringify(v)}`)

// --- the log: one record per intent, appended, never edited -------------
const Stored = Schema.struct.json({
  kind: Schema.string(),
  id: Schema.string(),
  author: Schema.string(),
  authorName: Schema.string(),
  seq: Schema.number(),
  parent: Schema.string(),
  text: Schema.string(),
  of: Schema.string(),
  before: Schema.string(),
  compels: Schema.boolean(),
})
const LogDoc = yjs.bind(Schema.struct({ intents: Schema.list(Stored) }))
type LogHandle = any
const newLog = (): LogHandle => createDoc(LogDoc as any)
const readLog = (log: LogHandle): (Intent & { compels: boolean })[] =>
  (log.intents() as any[]).map(r =>
    r.kind === "edit"
      ? { kind: "edit", id: r.id, author: r.author, seq: r.seq, of: r.of, before: r.before, text: r.text, compels: false }
      : { kind: "message", id: r.id, author: r.author, authorName: r.authorName, seq: r.seq, parent: r.parent === "" ? null : r.parent, text: r.text, compels: r.compels },
  )
/** Bring `to` up to `from`: one direction of a sync. */
const syncInto = (to: LogHandle, from: LogHandle) => merge(to, exportSince(from, version(to)))

// --- a writer: their own copy of the log, and what their page shows -----
let n = 0
const nextId = () => `i${String(++n).padStart(3, "0")}`
interface Writer {
  readonly name: string
  readonly email: string
  readonly log: LogHandle
  seq: number
  /** The agent's record as this writer last saw it. */
  seen: readonly RecordItem[]
}
const writer = (name: string): Writer => ({ name, email: `${name.toLowerCase()}@x.io`, log: newLog(), seq: 0, seen: [] })
/** The thread's end as the writer's page draws it: what a new message answers. */
function tipSeen(w: Writer): string | null {
  const rows = projectThread({ record: w.seen, log: readLog(w.log), read: new Map() })
  const last = rows.at(-1)
  return last === undefined ? null : last.kind === "agent" ? last.entry : last.intent
}
function say(w: Writer, text: string, compels = true): string {
  const id = nextId()
  w.log.intents.push({ kind: "message", id, author: w.email, authorName: w.name, seq: ++w.seq, parent: tipSeen(w) ?? "", text, of: "", before: "", compels })
  return id
}
function edit(w: Writer, of: string, before: string, text: string): string {
  const id = nextId()
  w.log.intents.push({ kind: "edit", id, author: w.email, authorName: w.name, seq: ++w.seq, parent: "", text, of, before, compels: false })
  return id
}

// --- the tether's record, read from pi's tree ---------------------------
interface Read {
  readonly record: RecordItem[]
  /** What the agent read of each taken message, as written (`details.text`). */
  readonly read: Map<string, string>
  /** Each intent id, and how many entries carry it. */
  readonly counts: Map<string, number>
  readonly end: string | null
}
function readRecord(doc: RootDocHandle, thread: ThreadId): Read {
  const rows = Object.values(readEntries(doc))
  const mine = rows.filter(r => r.thread === thread)
  const parents = new Set(mine.map(r => r.parentId))
  const tip = readLaneTip(doc, thread) ?? mine.find(r => !parents.has(r.id))?.id ?? null
  const byId = new Map(rows.map(r => [r.id, r]))
  const path: typeof rows = []
  for (let at = tip; at !== null && at !== undefined; ) {
    const row = byId.get(at)
    if (row === undefined) break
    path.unshift(row)
    at = row.parentId
  }
  const record: RecordItem[] = []
  const read = new Map<string, string>()
  const counts = new Map<string, number>()
  for (const row of path) {
    const message = rowMessage(row) as any
    const details = decodeMessage(message)
    if (details !== undefined) {
      record.push({ kind: "person", intent: details.sendId, entry: row.id })
      read.set(details.sendId, details.text)
      counts.set(details.sendId, (counts.get(details.sendId) ?? 0) + 1)
    } else if (message?.role === "assistant") {
      const text = (message.content as any[]).filter(c => c.type === "text").map(c => c.text).join("")
      record.push({ kind: "agent", entry: row.id, text })
    }
  }
  return { record, read, counts, end: tip }
}

// --- the tether ----------------------------------------------------------
const script = scriptedModel()
const contexts: (readonly string[])[] = []
let replies = 0
// One reply per run, naming what the model read last.
const answer = { reply: (context: readonly string[]) => { contexts.push(context); return `R${++replies}` } }
script.use(Array.from({ length: 50 }, () => answer))

const session = newSessionDoc()
let doc = newRootDoc()
let pi = await startPi(oneRoot(doc, session), { model: { kind: "scripted", script } })
const thread = threadIdFor("01a0ffd2-0000-7000-8000-0000000000b1")
let lane = false
/** Each take's framing as the plan decided it, to compare with the page's. */
const decided = new Map<string, unknown>()
let running = false
const tetherLog = newLog()

function namesFor(log: readonly Intent[]) {
  const byId = new Map(log.flatMap(i => (i.kind === "message" ? [[i.id, i] as const] : [])))
  return (id: string) => {
    const m = byId.get(id)
    return m === undefined ? "a message" : `${m.authorName}'s "${m.text}"`
  }
}

/** One step: read the record and the log, plan, carry the plan out. `stopAfter` cuts it off, as a crash would. */
async function step(stopAfter = Infinity): Promise<{ readonly plan: ReturnType<typeof planTake>; readonly done: number }> {
  const log = readLog(tetherLog)
  const { record, end } = readRecord(doc, thread)
  const plan = planTake({ record, log, running })
  if (plan.kind !== "take" || plan.takes.length === 0) return { plan, done: 0 }
  const names = namesFor(log)
  const compels = new Map(log.map(i => [i.id, i.compels]))
  const message = (t: Take) => ({
    ...encodeMessage(
      {
        author: writerId(t.intent.author),
        authorName: t.intent.authorName,
        text: t.intent.text,
        compels: compels.get(t.intent.id) ? { kind: "agent", agent: THE_AGENT } : NOBODY,
        sendId: t.intent.id,
      },
      Date.now(),
    ),
    content: framedContent(t, names),
  })
  for (const t of plan.takes) decided.set(t.intent.id, t.framing)
  let done = 0
  let at = end
  const last = plan.takes.length - 1
  const anyCompels = plan.takes.some(t => compels.get(t.intent.id))
  for (const [k, t] of plan.takes.entries()) {
    if (done >= stopAfter) break
    const m = message(t) as any
    if (!lane && !(anyCompels && k === last)) {
      // A thread with no lane: a chat, at its end.
      const r = await pi.scribe.appendToTree(m, { root: ONE_ROOT, at: at === null ? ROOT : atEntry(entryId(at)) }, thread)
      if (r.kind !== "appended") throw new Error(`append: ${r.kind}`)
      at = r.id
    } else {
      if (!lane) {
        const made = await pi.agent.createThreadLane({ root: ONE_ROOT, at: at === null ? ROOT : atEntry(entryId(at)) }, thread)
        if (made.kind !== "created") throw new Error(`lane: ${made.kind}`)
        lane = true
      }
      const handle = pi.agent.lane(thread)
      if (k === last && anyCompels) {
        running = true
        const r = await handle.run(m, [])
        running = false
        if (r.kind !== "ok") throw new Error(`run: ${r.kind}`)
      } else {
        const r = await handle.append(m)
        if (r.kind !== "appended") throw new Error(`append: ${r.kind}`)
      }
    }
    done++
  }
  return { plan, done }
}
const syncAll = (...ws: Writer[]) => {
  for (const w of ws) syncInto(tetherLog, w.log)
  for (const w of ws) syncInto(w.log, tetherLog)
}
const look = (...ws: Writer[]) => {
  const { record } = readRecord(doc, thread)
  for (const w of ws) w.seen = record
}
const lastContext = () => contexts.at(-1) ?? []
const ada = writer("Ada")
const bea = writer("Bea")

// The changefeed is only a trigger: it counts what reaches the tether.
let triggers = 0
subscribe(tetherLog, () => { triggers++ })

// --- Q1: chats with no lane, then a lane created at them -----------------
say(ada, "hello, Bea", false)
syncAll(ada, bea)
say(bea, "hi Ada", false)
syncAll(ada, bea)
const s1 = await step()
out("1 chats taken with no lane", s1.done)
const ask = say(ada, "@agent summarise what we said")
syncAll(ada, bea)
await step()
look(ada, bea)
out("1 lane created at the chats; the model read, last three", lastContext().slice(-3))
const r1 = readRecord(doc, thread)
out("1 record, in order", r1.record.map(i => (i.kind === "person" ? i.intent : i.text)))
out("1 the model read them in the record's order", lastContext().slice(-3).map(s => s.split(": ")[0].replace(/^\(.*\)\n/, "")))
void ask

// --- Q3: two messages at once, against the same end ----------------------
const a2 = say(ada, "please also list the open questions")
const b2 = say(bea, "and keep it short")
syncAll(ada, bea)
const s3 = await step()
look(ada, bea)
out("3 same end: framings", s3.plan.kind === "take" ? s3.plan.takes.map(t => [t.intent.id, t.framing.kind]) : s3.plan)
out("3 same end: one turn, runs", replies)
out("3 same end: the model read, last two", lastContext().slice(-2))

// --- Q3: a message written against an older end, after a reply -----------
const beaSaw = bea.seen
const a3 = say(ada, "what about the deadline?")
syncAll(ada) // Bea is partitioned
await step()
look(ada)
bea.seen = beaSaw
const b3 = say(bea, "never mind the open questions")
syncAll(ada, bea)
const s3b = await step()
look(ada, bea)
out("3 older end: Bea's parent", readLog(tetherLog).find(i => i.id === b3)?.kind === "message" ? (readLog(tetherLog).find(i => i.id === b3) as Message).parent : null)
out("3 older end: framing", s3b.plan.kind === "take" ? s3b.plan.takes.map(t => [t.intent.id, t.framing]) : s3b.plan)
out("3 older end: the model read", lastContext().at(-1))
void a3

// --- Q3: a message while the agent is replying ---------------------------
const held = script.hold("is the plan ready")
const a4 = say(ada, "is the plan ready?")
syncAll(ada, bea)
const running4 = step()
while (!held.reached) await new Promise(r => setTimeout(r, 10))
// Bea writes while the reply is being written: her end is Ada's message.
bea.seen = readRecord(doc, thread).record
const b4 = say(bea, "add the budget to it")
syncAll(ada, bea)
const during = await step()
out("3 while replying: plan", during.plan.kind)
held.finish()
await running4
const after = await step()
look(ada, bea)
out("3 after the reply: framing", after.plan.kind === "take" ? after.plan.takes.map(t => [t.intent.id, t.framing.kind, t.framing.kind === "before-reply" ? t.framing.to : null]) : after.plan)
out("3 after the reply: the model read", lastContext().at(-1))
void a4
void b4

// --- Q2: stopped mid-log, started again from its store -------------------
const a5 = say(ada, "first of three")
syncAll(ada, bea)
look(ada)
const a6 = say(ada, "second of three")
const b6 = say(bea, "a word from Bea")
syncAll(ada, bea)
const cut = await step(1)
out("2 the first step took, of", [cut.done, cut.plan.kind === "take" ? cut.plan.takes.length : 0])
// The tether stops: pi closes. Its store holds the root document; it starts
// again from a copy of it, with nothing kept in memory.
await pi.close()
const stored = newRootDoc()
merge(stored, exportSince(doc, version(stored)))
doc = stored
pi = await startPi(oneRoot(doc, session), { model: { kind: "scripted", script } })
lane = readLaneTip(doc, thread) !== null
const resumed = await step()
out("2 after the restart, taken", resumed.plan.kind === "take" ? resumed.plan.takes.map(t => [t.intent.id, t.framing.kind]) : resumed.plan)
const again = await step()
out("2 a step with nothing new takes", again.plan.kind === "take" ? again.plan.takes.length : again.plan)
const final = readRecord(doc, thread)
const counts = [...final.counts.values()]
const messages = readLog(tetherLog).filter(i => i.kind === "message").map(i => i.id)
out("2 every message taken once", messages.every(id => final.counts.get(id) === 1))
out("2 entries per intent", [Math.min(...counts), Math.max(...counts), messages.length, final.counts.size])
out("2 the model read, after the restart", lastContext().slice(-3))
void a5
void a6
void b6

// --- Q4: an edit after the take, and forged edits -------------------------
look(ada, bea)
edit(ada, a2, "please also list the open questions", "please also list the open questions, numbered")
edit(bea, a2, "please also list the open questions", "Bea rewrote Ada's words")
const firstReply = final.record.find(i => i.kind === "agent")
edit(bea, firstReply?.entry ?? "", "R1", "words the agent never said")
syncAll(ada, bea)
const s4 = await step()
out("4 an edit is never taken", s4.plan.kind === "take" ? [s4.plan.takes.length, s4.plan.left.filter(l => l.why === "edit").length] : s4.plan)
const pending = say(bea, "a message not yet taken")
syncAll(ada, bea)
const rows = projectThread({ record: readRecord(doc, thread).record, log: readLog(tetherLog), read: readRecord(doc, thread).read })
const row = (id: string) => rows.find(r => r.kind === "person" && r.intent === id)
out("4 the edited message, as drawn", row(a2))
out("4 the agent's first reply, as drawn", rows.find(r => r.kind === "agent"))
out("4 a message not yet taken, as drawn", row(pending))
out("4 rows drawn", rows.map(r => (r.kind === "agent" ? r.text : `${r.author}${r.framing === null ? " (pending)" : r.framing.kind === "as-written" ? "" : ` [${r.framing.kind}]`}${r.agentRead === null ? "" : " (edited after the agent read it)"}`)))
const agree = rows.filter(r => r.kind === "person" && r.framing !== null).every(r => r.kind === "person" && JSON.stringify(r.framing) === JSON.stringify(decided.get(r.intent)))
out("4 the page's framings match the plan's at each take", agree)
out("changefeed triggers seen by the tether", triggers)
out("runs", replies)
void b2

await pi.close()
process.exit(0)
