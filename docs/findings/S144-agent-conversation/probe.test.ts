// S144 probe — disposable. Ran as packages/pi/s144-probe.test.ts with
// `npx vitest run packages/pi/s144-probe.test.ts` (pi 0.87.1); kept here as a
// record of what ran, not maintained. What pi does for agent-to-agent conversation:
// 1. a thread's context drawn from another session's entries, at each request
//    (an entry projector; or a custom message expanded by toProviderMessages);
// 2. usage per request, and abort from a usage listener: how far a run overruns;
// 3. two lanes of one harness running at once;
// 4. a tool that starts another lane's run without awaiting it, and one that awaits;
// 5. what compaction reads of each kind of pointer.

import {
  type AgentMessage,
  BACKGROUND_CONTEXT,
  convertToLlm,
} from "@earendil-works/pi-agent-core"
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session"
import {
  createModels,
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai"
import { Type } from "typebox"
import { expect, test } from "vitest"
import { createAgentHarness } from "./deep.ts"

const CTX = BACKGROUND_CONTEXT

const textOf = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map(p => (p?.type === "text" ? p.text : "")).join("")
      : ""

const transcript = (c: TranscriptContext) =>
  c.messages.map(m => `${m.role}: ${textOf(m.content)}`).join("\n")

type Options = Parameters<typeof createAgentHarness>[0]

async function setup(
  extra: Partial<Options> = {},
  model: { contextWindow?: number } = {},
) {
  const faux = fauxProvider({
    tokensPerSecond: 100_000,
    ...(model.contextWindow === undefined
      ? {}
      : { models: [{ id: "faux-1", contextWindow: model.contextWindow }] }),
  })
  const models = createModels()
  models.setProvider(faux.provider)
  const repo = new MemorySessionRepo()
  const session = await repo.create({}, CTX)
  const { harness } = await createAgentHarness(
    {
      session,
      models,
      model: faux.getModel(),
      systemPrompt: "probe",
      ...extra,
    } as Options,
    CTX,
  )
  return { faux, harness, session }
}

const noop = {
  name: "noop",
  label: "noop",
  description: "does nothing",
  parameters: Type.Object({}),
  async execute() {
    return {
      content: [{ type: "text" as const, text: "ok" }],
      details: undefined,
    }
  },
}

// "Thread A": its own session, with a conversation in it.
async function threadA() {
  const { faux, harness, session } = await setup()
  const a = await harness.lane("A", { createAt: null }, CTX)
  faux.appendResponses([
    fauxAssistantMessage("A-REPLY: I think we should use a queue."),
  ])
  await a.prompt(
    {
      role: "user",
      content: "DUANE-IN-A: should B weigh in on queues?",
      timestamp: 1,
    },
    CTX,
  )
  const entries = (await a.findEntries({ order: "oldestFirst" }, CTX)).filter(
    e => e.type === "message",
  )
  return { session, ids: entries.map(e => e.id), harness }
}

/** A's entries, as the agent in B would read them. */
async function heardFrom(
  sessionA: Awaited<ReturnType<typeof threadA>>["session"],
  ids: readonly string[],
) {
  const found = await sessionA.getEntries([...ids], CTX)
  return ids
    .map(id => found.get(id))
    .map(e =>
      e?.type === "message"
        ? `[in A] ${e.message.role}: ${textOf((e.message as { content?: unknown }).content)}`
        : "",
    )
    .join("\n")
}

test("1a. an entry projector draws another session's entries at every request", async () => {
  const A = await threadA()
  let projected = 0
  const { faux, harness } = await setup({
    tools: [noop] as never[],
    activeToolNames: ["noop"],
    entryProjectors: {
      "pinetrie.heard": async entry => {
        projected++
        const ids = (entry.data as { ids: string[] }).ids
        return [
          {
            role: "custom",
            customType: "pinetrie.heard",
            content: await heardFrom(A.session, ids),
            display: false,
            timestamp: 0,
          },
        ]
      },
    },
  })
  const b = await harness.lane("B", { createAt: null }, CTX)
  const seen: string[] = []
  const usage: unknown[] = []
  harness.events.on("usage", e => {
    usage.push({ ...e.row })
  })
  const record: FauxResponseFactory = c => {
    seen.push(transcript(c))
    return fauxAssistantMessage([fauxToolCall("noop", {})], {
      stopReason: "toolUse",
    })
  }
  const last: FauxResponseFactory = c => {
    seen.push(transcript(c))
    return fauxAssistantMessage("B: a queue is right.")
  }
  faux.appendResponses([record, last])
  await b.appendCustomEntry("pinetrie.heard", { ids: A.ids }, CTX)
  const result = await b.prompt(
    { role: "user", content: "A-ASKS-B: what do you think?", timestamp: 2 },
    CTX,
  )
  console.log("1a result", result.ok, "projected", projected)
  console.log("1a request 1:\n" + seen[0])
  console.log("1a request 2:\n" + seen[1])
  console.log("1a usage rows", JSON.stringify(usage, null, 1))
  expect(seen[0]).toContain("DUANE-IN-A")
  expect(seen[1]).toContain("A-REPLY")
})

test("1b. a custom message in the prompt, expanded by toProviderMessages", async () => {
  const A = await threadA()
  let expanded = 0
  const { faux, harness } = await setup({
    tools: [noop] as never[],
    activeToolNames: ["noop"],
    toProviderMessages: async (messages: AgentMessage[]) => {
      const out: AgentMessage[] = []
      for (const m of messages) {
        if (m.role === "custom" && m.customType === "pinetrie.heard") {
          expanded++
          const ids = (m.details as { ids: string[] }).ids
          out.push({ ...m, content: await heardFrom(A.session, ids) })
        } else out.push(m)
      }
      return convertToLlm(out)
    },
  })
  const b = await harness.lane("B", { createAt: null }, CTX)
  const seen: string[] = []
  const usage: { cacheRead: number; input: number }[] = []
  harness.events.on("usage", e => {
    usage.push(e.row as never)
  })
  faux.appendResponses([
    c => {
      seen.push(transcript(c))
      return fauxAssistantMessage([fauxToolCall("noop", {})], {
        stopReason: "toolUse",
      })
    },
    c => {
      seen.push(transcript(c))
      return fauxAssistantMessage("B: a queue is right.")
    },
  ])
  const pointer: AgentMessage = {
    role: "custom",
    customType: "pinetrie.heard",
    content: "[2 messages in A]",
    display: true,
    details: { ids: A.ids },
    timestamp: 2,
  }
  const result = await b.prompt(
    [
      pointer,
      { role: "user", content: "A-ASKS-B: what do you think?", timestamp: 3 },
    ],
    CTX,
  )
  console.log("1b result", result.ok, "expanded", expanded)
  console.log("1b request 2:\n" + seen[1])
  console.log("1b usage", JSON.stringify(usage))
  expect(seen[0]).toContain("DUANE-IN-A")
  expect(seen[1]).toContain("A-REPLY")
})

test("2. usage per request, and abort from a usage listener", async () => {
  const { faux, harness } = await setup({
    tools: [noop] as never[],
    activeToolNames: ["noop"],
  })
  const lane = await harness.lane("L", { createAt: null }, CTX)
  let requests = 0
  const step: FauxResponseFactory = () => {
    requests++
    return fauxAssistantMessage(
      [fauxText("working"), fauxToolCall("noop", {})],
      {
        stopReason: "toolUse",
      },
    )
  }
  faux.appendResponses(Array.from({ length: 10 }, () => step))
  const rows: unknown[] = []
  let aborting: Promise<void> | undefined
  harness.events.on("usage", e => {
    rows.push({ lane: e.lane, row: e.row, totals: e.totals })
    // A budget of two requests: stop once the second is counted. Not awaited:
    // the listener may be awaited inside the lane's drive.
    if (rows.length === 2) aborting = lane.abort(CTX)
  })
  const result = await lane.prompt(
    { role: "user", content: "go", timestamp: 1 },
    CTX,
  )
  await aborting
  const entries = await lane.findEntries({ order: "oldestFirst" }, CTX)
  console.log("2 result", JSON.stringify(result))
  console.log("2 requests made", requests, "usage events", rows.length)
  console.log("2 first usage event", JSON.stringify(rows[0]))
  console.log(
    "2 entries",
    entries.map(e =>
      e.type === "message"
        ? `${e.message.role}${"stopReason" in e.message ? `(${e.message.stopReason})` : ""}`
        : e.type,
    ),
  )
})

test("2b. abort from before_request", async () => {
  const { faux, harness } = await setup({
    tools: [noop] as never[],
    activeToolNames: ["noop"],
  })
  const lane = await harness.lane("L", { createAt: null }, CTX)
  let requests = 0
  const step: FauxResponseFactory = () => {
    requests++
    return fauxAssistantMessage([fauxToolCall("noop", {})], {
      stopReason: "toolUse",
    })
  }
  faux.appendResponses(Array.from({ length: 10 }, () => step))
  let asked = 0
  let aborting: Promise<void> | undefined
  harness.hooks.on("before_request", () => {
    asked++
    if (asked === 3) aborting = lane.abort(CTX)
    return undefined
  })
  const result = await lane.prompt(
    { role: "user", content: "go", timestamp: 1 },
    CTX,
  )
  await aborting
  console.log(
    "2b result",
    JSON.stringify(result),
    "before_request",
    asked,
    "requests answered",
    requests,
  )
})

test("3. two lanes of one harness run at once", async () => {
  const { faux, harness } = await setup()
  const b = await harness.lane("B", { createAt: null }, CTX)
  const c = await harness.lane("C", { createAt: null }, CTX)
  const gate = Promise.withResolvers<void>()
  const order: string[] = []
  faux.appendResponses([
    async () => {
      order.push("B started")
      await gate.promise
      order.push("B answers")
      return fauxAssistantMessage("B")
    },
    () => {
      order.push("C answers")
      return fauxAssistantMessage("C")
    },
  ])
  const runB = b.prompt({ role: "user", content: "to B", timestamp: 1 }, CTX)
  await new Promise(r => setTimeout(r, 50))
  const runC = c.prompt({ role: "user", content: "to C", timestamp: 2 }, CTX)
  const cDone = await Promise.race([
    runC.then(() => "C finished"),
    new Promise(r => setTimeout(() => r("C still waiting after 500 ms"), 500)),
  ])
  order.push(String(cDone))
  gate.resolve()
  await runB
  await runC
  console.log("3 order", order)
})

test("4. a tool that starts another lane's run: not awaited, then awaited", async () => {
  let harnessRef: Awaited<ReturnType<typeof setup>>["harness"] | undefined
  const started: Promise<unknown>[] = []
  const ask = (wait: boolean) => ({
    name: wait ? "ask_wait" : "ask",
    label: "ask",
    description: "ask another lane",
    parameters: Type.Object({ to: Type.String() }),
    async execute(_id: string, params: { to: string }) {
      const h = harnessRef
      if (h === undefined) throw new Error("no harness")
      const other = await h.lane(params.to, CTX)
      const run = other.prompt(
        { role: "user", content: `asked by a tool`, timestamp: Date.now() },
        CTX,
      )
      started.push(run)
      const text = wait ? JSON.stringify(await run) : "queued"
      return { content: [{ type: "text" as const, text }], details: undefined }
    },
  })
  const { faux, harness } = await setup({
    tools: [ask(false), ask(true)] as never[],
    activeToolNames: ["ask", "ask_wait"],
  })
  harnessRef = harness
  const a = await harness.lane("A", { createAt: null }, CTX)
  await harness.lane("B", { createAt: null }, CTX)
  const log: string[] = []
  // The faux queue is shared: A's tool call, then whichever request comes next.
  const byLast: FauxResponseFactory = c => {
    const last = textOf(c.messages.at(-1)?.content)
    log.push(`request after: ${c.messages.at(-1)?.role} ${last.slice(0, 40)}`)
    if (last === "go")
      return fauxAssistantMessage([fauxToolCall("ask", { to: "B" })], {
        stopReason: "toolUse",
      })
    if (last === "go-wait")
      return fauxAssistantMessage([fauxToolCall("ask_wait", { to: "B" })], {
        stopReason: "toolUse",
      })
    return fauxAssistantMessage(`reply to: ${last.slice(0, 40)}`)
  }
  faux.appendResponses(Array.from({ length: 10 }, () => byLast))
  const r1 = await Promise.race([
    a.prompt({ role: "user", content: "go", timestamp: 1 }, CTX),
    new Promise(r => setTimeout(() => r("A timed out"), 2000)),
  ])
  await Promise.all(started)
  console.log("4 not awaited:", JSON.stringify(r1), log)
  log.length = 0
  const r2 = await Promise.race([
    a.prompt({ role: "user", content: "go-wait", timestamp: 2 }, CTX),
    new Promise(r => setTimeout(() => r("A timed out"), 2000)),
  ])
  console.log("4 awaited:", JSON.stringify(r2), log)
  // B asks A while A is running: refused?
  const gate = Promise.withResolvers<void>()
  faux.setResponses([
    async () => {
      await gate.promise
      return fauxAssistantMessage("A done")
    },
  ])
  const runA = a.prompt({ role: "user", content: "slow", timestamp: 3 }, CTX)
  await new Promise(r => setTimeout(r, 50))
  const again = await a
    .prompt({ role: "user", content: "while running", timestamp: 4 }, CTX)
    .catch(e => ({ thrown: String(e?._tag ?? e) }))
  gate.resolve()
  await runA
  console.log("4 prompt on a running lane:", JSON.stringify(again))
})

test("5. what compaction reads of a projected entry and of a pointer message", async () => {
  const A = await threadA()
  const big = "x".repeat(4000)
  const summarised: string[] = []
  const { faux, harness } = await setup(
    {
      compaction: { enabled: true, reserveTokens: 1500, keepRecentTokens: 300 },
      entryProjectors: {
        "pinetrie.heard": async () => [
          {
            role: "custom",
            customType: "pinetrie.heard",
            content: `PROJECTED-TEXT ${await heardFrom(A.session, A.ids)}`,
            display: false,
            timestamp: 0,
          },
        ],
      },
    },
    { contextWindow: 6000 },
  )
  const b = await harness.lane("B", { createAt: null }, CTX)
  const answer: FauxResponseFactory = c => {
    const t = transcript(c)
    if (t.includes("<conversation>") || /summar/i.test(c.systemPrompt ?? ""))
      summarised.push(t)
    return fauxAssistantMessage(`ok ${big.slice(0, 1500)}`)
  }
  faux.appendResponses(Array.from({ length: 20 }, () => answer))
  await b.appendCustomEntry("pinetrie.heard", { ids: A.ids }, CTX)
  await b.prompt(
    [
      {
        role: "custom",
        customType: "pinetrie.pointer",
        content: "POINTER-CONTENT [2 messages in A]",
        display: true,
        details: { ids: A.ids },
        timestamp: 1,
      },
      { role: "user", content: `first ${big}`, timestamp: 2 },
    ],
    CTX,
  )
  for (const n of [1, 2, 3])
    await b.prompt(
      { role: "user", content: `more ${n} ${big}`, timestamp: 3 + n },
      CTX,
    )
  const entries = await b.findEntries({ order: "oldestFirst" }, CTX)
  console.log(
    "5 entry types",
    entries.map(e => e.type),
  )
  console.log("5 summary requests", summarised.length)
  console.log(
    "5 first summary input:",
    summarised[0]?.replace(/x{20,}/g, "x…").slice(0, 3000),
  )
  for (const s of summarised)
    console.log(
      "5 summary input has PROJECTED-TEXT:",
      s.includes("PROJECTED-TEXT"),
      "POINTER-CONTENT:",
      s.includes("POINTER-CONTENT"),
      "DUANE-IN-A:",
      s.includes("DUANE-IN-A"),
    )
})
