// S262's replay: reply frames (shapes from `frames.ts`, or a made-up reply)
// filled with text of the same lengths, written into a root document each
// way, every write measured as the delta the store would append
// (`exportSince` from the version before it). Also checks recovery: at every
// frame, the frames rebuilt from the edits' state fold to the message the
// frames so far fold to.
// Run: node replay.ts [shapes.json]

import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { tailEdit } from "../../../packages/core/edits.ts"
import { RootDoc, type RootDocHandle } from "../../../packages/schema/storage.ts"

const here = path.dirname(new URL(import.meta.url).pathname)
const fromPkg = (pkg: string, name: string) =>
  import(
    pathToFileURL(
      createRequire(path.join(here, `../../../packages/${pkg}/package.json`)).resolve(name),
    ).href
  )
const kyneta = (await fromPkg("schema", "@kyneta/schema")) as typeof import("@kyneta/schema")
// pi-ai exports only by `import`; its frame module is read from its file.
const piAi = (await import(
  pathToFileURL(
    path.join(here, "../../../packages/pi/node_modules/@earendil-works/pi-ai/dist/utils/assistant-message-frame.js"),
  ).href
)) as Record<string, unknown>
const reduce = piAi.reduceAssistantMessageFrames as (frames: readonly Frame[]) => unknown
const { batch, createDoc, exportSince, version } = kyneta

type Frame = Record<string, unknown> & { type: string; contentIndex?: number }
type Shape = Record<string, string | number | Record<string, number>>

/** A string whose JSON is `n` characters: the shapes count JSON lengths. */
const text = (n: number) => "x".repeat(Math.max(0, n - 2))
const num = (v: unknown) => (typeof v === "number" ? v : 0)
const inner = (v: unknown) => (v ?? {}) as Record<string, number>

/** Frames from shapes, so every delta, content and signature has its stored length. */
function framesFrom(shapes: readonly Shape[]): Frame[] {
  const acc = new Map<number, string>()
  return shapes.map(s => {
    const t = String(s.t)
    const i = num(s.i)
    switch (t) {
      case "start":
        return {
          type: t,
          partial: {
            role: "assistant",
            content: [],
            pad: text(Object.values(inner(s.partial)).reduce((a, b) => a + b, 0) || 300),
          },
        }
      case "text_start":
      case "thinking_start": {
        const kind = t === "text_start" ? "text" : "thinking"
        const body = text(inner(s.content)[kind] ?? 2)
        acc.set(i, body)
        return { type: t, contentIndex: i, content: { type: kind, [kind]: body } }
      }
      case "text_delta":
      case "thinking_delta": {
        const d = text(num(s.delta))
        acc.set(i, (acc.get(i) ?? "") + d)
        return { type: t, contentIndex: i, delta: d }
      }
      case "text_end":
        return { type: t, contentIndex: i, content: acc.get(i) ?? "", ...(s.textSignature ? { textSignature: text(num(s.textSignature)) } : {}) }
      case "thinking_end":
        return { type: t, contentIndex: i, content: acc.get(i) ?? "", ...(s.thinkingSignature ? { thinkingSignature: text(num(s.thinkingSignature)) } : {}) }
      case "toolcall_start":
        acc.set(i, "")
        return { type: t, contentIndex: i, toolCall: { type: "toolCall", id: text(inner(s.toolCall).id ?? 20), name: text(inner(s.toolCall).name ?? 6), arguments: {} } }
      case "toolcall_delta": {
        const d = text(num(s.delta))
        acc.set(i, (acc.get(i) ?? "") + d)
        return { type: t, contentIndex: i, delta: d }
      }
      case "toolcall_checkpoint": {
        // The JSON so far, as long as the stored one, extending what came before.
        const so = acc.get(i) ?? ""
        const json = so + text(Math.max(0, num(s.json) - so.length))
        acc.set(i, json)
        return { type: t, contentIndex: i, json }
      }
      case "toolcall_end":
        return { type: t, contentIndex: i, id: text(num(s.id)), name: text(num(s.name)), arguments: { pad: text(Math.max(2, num(s.arguments) - 10)) } }
      default:
        return { type: t, contentIndex: i }
    }
  })
}

/** A made-up reply when no shapes are given: thinking, text, then a tool call. */
function madeUp(): Shape[] {
  const d = (t: string, i: number, n: number) => ({ t, i, delta: n })
  return [
    { t: "start", partial: { model: 400 } },
    { t: "thinking_start", i: 0, content: { thinking: 2 } },
    ...Array.from({ length: 60 }, () => d("thinking_delta", 0, 24)),
    { t: "thinking_end", i: 0, content: 1300, thinkingSignature: 1200 },
    { t: "text_start", i: 1, content: { text: 2 } },
    ...Array.from({ length: 30 }, () => d("text_delta", 1, 18)),
    { t: "text_end", i: 1, content: 500 },
    { t: "toolcall_start", i: 2, toolCall: { id: 30, name: 8 } },
    ...Array.from({ length: 12 }, () => d("toolcall_delta", 2, 16)),
    { t: "toolcall_end", i: 2, id: 30, name: 8, arguments: 200 },
  ]
}

/** One way of writing a reply: how one frame changes the document, and the reply's end. */
interface Way {
  frame(d: RootDocHandle, key: string, f: Frame, eid: string): void
  end(d: RootDocHandle, key: string, message: unknown, id: string): void
}

const today: Way = {
  frame(d, key, f, eid) {
    if (!d.lists.has(key)) d.lists.set(key, [])
    d.lists.at(key)?.push({ eid, value: f })
  },
  end(d, key, message, id) {
    d.lists.delete(key)
    d.entries.set(id, { id, parentId: null, type: "message", timestamp: 0, fromId: null, thread: "t", payload: { message } })
  },
}

/** Edits: a small shell per reply and per block in `values`, each block's text grown in `checkpointText`. */
const edits: Way = {
  frame(d, key, f) {
    const i = f.contentIndex ?? -1
    const block = `${key}#${i}`
    const grow = (s: string) => {
      if (!d.checkpointText.has(block)) d.checkpointText.set(block, "")
      d.checkpointText.at(block)?.insert(d.checkpointText.at(block)?.().length ?? 0, s)
    }
    const shell = (v: Record<string, unknown>) =>
      d.values.set(block, { ...((d.values.at(block)?.() as object) ?? {}), ...v })
    switch (f.type) {
      case "start":
        d.values.set(`${key}#start`, { partial: f.partial })
        return
      case "text_start":
      case "thinking_start": {
        const c = f.content as Record<string, string>
        const kind = f.type === "text_start" ? "text" : "thinking"
        shell({ kind, ended: false })
        grow(c[kind] ?? "")
        return
      }
      case "text_delta":
      case "thinking_delta":
      case "toolcall_delta":
        grow(String(f.delta))
        return
      case "text_end":
      case "thinking_end": {
        const { type: _t, contentIndex: _i, content, ...rest } = f
        const now = String(d.checkpointText.at(block)?.() ?? "")
        const edit = tailEdit(now, String(content))
        if (edit.length > 0) d.checkpointText.set(block, String(content))
        shell({ ended: true, ...rest })
        return
      }
      case "toolcall_start":
        shell({ kind: "toolCall", ended: false, toolCall: f.toolCall })
        return
      case "toolcall_checkpoint":
        d.checkpointText.set(block, String(f.json))
        return
      case "toolcall_end": {
        const { type: _t, contentIndex: _i, ...rest } = f
        shell({ ended: true, end: rest })
        return
      }
    }
  },
  end(d, key, message, id) {
    for (const k of Object.keys(d.values()).filter(k => k.startsWith(`${key}#`))) d.values.delete(k)
    for (const k of Object.keys(d.checkpointText()).filter(k => k.startsWith(`${key}#`))) d.checkpointText.delete(k)
    today.end(d, key, message, id)
  },
}

/** Aside: the frames kept outside the document (a table of the host's); the document gets the entry alone. */
const aside: Way = {
  frame() {},
  end(d, key, message, id) {
    today.end(d, key, message, id)
  },
}

/** The frames the edits' state stands for: what `readList` would answer after a crash. */
function rebuilt(d: RootDocHandle, key: string): Frame[] {
  const start = d.values.at(`${key}#start`)?.() as { partial: unknown } | undefined
  if (start === undefined) return []
  const out: Frame[] = [{ type: "start", partial: start.partial }]
  const blocks = Object.keys(d.values())
    .filter(k => k.startsWith(`${key}#`) && !k.endsWith("#start"))
    .map(k => Number(k.slice(key.length + 1)))
    .sort((a, b) => a - b)
  for (const i of blocks) {
    const s = d.values.at(`${key}#${i}`)?.() as Record<string, unknown>
    const body = String(d.checkpointText.at(`${key}#${i}`)?.() ?? "")
    const { kind, ended, toolCall, end, ...sig } = s
    if (kind === "toolCall") {
      out.push({ type: "toolcall_start", contentIndex: i, toolCall })
      if (ended) out.push({ type: "toolcall_end", contentIndex: i, ...(end as object) })
      else if (body.length > 0) out.push({ type: "toolcall_checkpoint", contentIndex: i, json: body })
      continue
    }
    out.push({ type: `${kind}_start`, contentIndex: i, content: { type: kind, [String(kind)]: body } })
    if (ended) out.push({ type: `${kind}_end`, contentIndex: i, content: body, ...sig })
  }
  return out
}

interface Tally {
  records: number
  bytes: number
}

/** Write `replies` one way, `per` frames to a write, and tally the deltas; check recovery when asked. */
function run(
  way: Way,
  replies: Frame[][],
  per: number,
  checkRecovery: boolean,
  peek: number[] | null = null,
) {
  const doc = createDoc(RootDoc) as unknown as RootDocHandle
  const tally: Tally = { records: 0, bytes: 0 }
  let mismatches = 0
  const write = (go: (d: RootDocHandle) => void) => {
    const before = version(doc as never)
    batch(doc as never, d => go(d as unknown as RootDocHandle))
    const delta = exportSince(doc as never, before) as { data?: string } | null
    if (delta?.data === undefined) return
    // A write that changed nothing stores nothing.
    if ((JSON.parse(delta.data) as { batches?: unknown[] }).batches?.length === 0) return
    tally.records += 1
    tally.bytes += delta.data.length
    if (peek !== null) peek.push(delta.data.length)
  }
  for (const [r, frames] of replies.entries()) {
    const key = `pi.pending.assistant_frame\u0000op:${r}`
    for (let at = 0; at < frames.length; at += per) {
      const chunk = frames.slice(at, at + per)
      write(d => {
        for (const [k, f] of chunk.entries()) way.frame(d, key, f, `e${at + k}`)
      })
      if (checkRecovery) {
        const want = JSON.stringify(reduce(frames.slice(0, at + chunk.length)))
        const got = JSON.stringify(reduce(rebuilt(doc, key)))
        if (want !== got) mismatches += 1
      }
    }
    write(d => way.end(d, key, reduce(frames), `entry-${r}`))
  }
  return { ...tally, mismatches }
}

const file = process.argv.slice(2).find(a => !a.startsWith("--"))
const input = file === undefined
  ? { replies: [{ frames: madeUp() }] }
  : (JSON.parse(readFileSync(file, "utf8")) as { replies: { frames: Shape[] }[] })
const replies = input.replies.map(r => framesFrom(r.frames)).filter(f => f[0]?.type === "start")
const frames = replies.reduce((n, f) => n + f.length, 0)
console.log(`replies: ${replies.length}, frames: ${frames}${file === undefined ? " (made up)" : ""}`)
const base = run(today, replies, 1, false)
console.log("way, frames per write: records, KB, × today's records, recovery mismatches")
for (const [name, way] of [
  ["today", today],
  ["edits", edits],
  ["aside", aside],
] as const)
  for (const per of name === "aside" ? [1] : [1, 2, 4, 8]) {
    const t = run(way, replies, per, name === "edits")
    console.log(
      `  ${name}, ${per}: ${t.records}, ${(t.bytes / 1e3).toFixed(1)}, ${(t.records / base.records).toFixed(2)} records, ${(t.bytes / base.bytes).toFixed(2)} bytes${name === "edits" ? `, ${t.mismatches}` : ""}`,
    )
  }

if (process.argv.includes("--peek") && replies[0] !== undefined) {
  const first = replies[0]
  for (const [name, way] of [["today", today], ["edits", edits]] as const) {
    const sizes: number[] = []
    run(way, [first], 1, false, sizes)
    const byType = new Map<string, number[]>()
    for (const [k, f] of first.entries()) byType.set(f.type, [...(byType.get(f.type) ?? []), sizes[k] ?? 0])
    console.log(`${name}: ${[...byType].map(([t, v]) => `${t} ${Math.round(v.reduce((a, b) => a + b, 0) / v.length)}`).join(", ")}, end ${sizes.at(-1)}`)
  }
}
