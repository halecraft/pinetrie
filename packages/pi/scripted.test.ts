// The scripted model: its queue, its standing answer, and held replies.

import path from "node:path"
import { VERDICT_ALONE, VERDICT_THEN_DIGEST } from "@pinetrie/rules"
import { expect, test, vi } from "vitest"
import { bindAgentDir } from "./agent-dir.ts"
import { loadModelSetup, NO_RESOURCES } from "./config.ts"
import {
  SCRIPTED_DESCRIPTION,
  SCRIPTED_VERDICT,
  type ScriptedModel,
  scriptedModel,
} from "./scripted.ts"
import { testPlaces } from "./start-pi.ts"

const cwd = path.join(import.meta.dirname, "fixtures")
const where = () => {
  const places = testPlaces()
  return {
    cwd,
    places,
    binding: bindAgentDir(places.configDir),
    lists: NO_RESOURCES,
    skillsDir: path.join(import.meta.dirname, "skills"),
  }
}

/** The scripted run's model: a scripted setup always has one. */
const runModel = (setup: Awaited<ReturnType<typeof loadModelSetup>>) => {
  if (setup.model.kind !== "model") throw new Error("no model")
  return setup.model.model
}
const ANSWER = { text: "the answer" }

async function asker(script: ScriptedModel) {
  const setup = await loadModelSetup({ kind: "scripted", script }, where())
  return (prompt: string, signal?: AbortSignal) =>
    setup.models.completeSimple(
      runModel(setup),
      {
        systemPrompt: "answer",
        messages: [{ role: "user", content: prompt, timestamp: 0 }],
      },
      signal === undefined ? {} : { signal },
    )
}

/** A request's stream, and every event it has given so far. */
async function streamer(script: ScriptedModel) {
  const setup = await loadModelSetup({ kind: "scripted", script }, where())
  return (prompt: string) => {
    const stream = setup.models.streamSimple(runModel(setup), {
      systemPrompt: "answer",
      messages: [{ role: "user", content: prompt, timestamp: 0 }],
    })
    const events: string[] = []
    const ended = (async () => {
      for await (const event of stream) events.push(event.type)
    })()
    return { events, ended, result: stream.result() }
  }
}

const textOf = (m: Awaited<ReturnType<Awaited<ReturnType<typeof asker>>>>) =>
  m.content.flatMap(p => (p.type === "text" ? [p.text] : [])).join("")

/** Whether `p` has settled after the event loop has run a while. */
const settled = async (p: Promise<unknown>) => {
  let done = false
  void p.then(() => {
    done = true
  })
  await new Promise(r => setTimeout(r, 50))
  return done
}

test("three requests in one tick are each answered", async () => {
  const ask = await asker(scriptedModel({ answer: ANSWER }))
  const replies = await Promise.all([ask("a"), ask("b"), ask("c")])
  expect(replies.map(r => [r.stopReason, textOf(r)])).toEqual([
    ["stop", "the answer"],
    ["stop", "the answer"],
    ["stop", "the answer"],
  ])
})

test("queued steps come first, then the answer; with no answer, an error reply", async () => {
  const answering = scriptedModel({ answer: ANSWER })
  answering.use([{ text: "one" }])
  const ask = await asker(answering)
  expect(textOf(await ask("a"))).toBe("one")
  expect(textOf(await ask("b"))).toBe("the answer")

  const bare = scriptedModel()
  bare.use([{ text: "one" }])
  const askBare = await asker(bare)
  expect(textOf(await askBare("a"))).toBe("one")
  expect((await askBare("b")).stopReason).toBe("error")
})

test("a held reply waits until finished, and others pass it", async () => {
  const script = scriptedModel({ answer: ANSWER })
  const ask = await asker(script)
  const hold = script.hold("wait")
  const held = ask("please wait here")
  await vi.waitFor(() => expect(hold.reached).toBe(true))
  expect(textOf(await ask("go"))).toBe("the answer")
  expect(await settled(held)).toBe(false)
  hold.finish()
  expect(textOf(await held)).toBe("the answer")
})

test("a hold matches one request", async () => {
  const script = scriptedModel({ answer: ANSWER })
  const ask = await asker(script)
  const hold = script.hold("wait")
  const first = ask("wait")
  await vi.waitFor(() => expect(hold.reached).toBe(true))
  expect(textOf(await ask("wait again"))).toBe("the answer")
  hold.finish()
  await first
})

test("a held request whose run aborts ends, aborted, with no release", async () => {
  const script = scriptedModel({ answer: ANSWER })
  const ask = await asker(script)
  const hold = script.hold("wait")
  const abort = new AbortController()
  const held = ask("wait", abort.signal)
  await vi.waitFor(() => expect(hold.reached).toBe(true))
  abort.abort()
  expect((await held).stopReason).toBe("aborted")
})

test("a held reply streams nothing, its start included, until released", async () => {
  const script = scriptedModel({ answer: ANSWER })
  const hold = script.hold("wait")
  const held = (await streamer(script))("wait")
  await vi.waitFor(() => expect(hold.reached).toBe(true))
  expect(await settled(held.result)).toBe(false)
  expect(held.events).toEqual([])
  hold.finish()
  await held.ended
})

/** Long enough for faux to stream it in several deltas, of 3 to 6 tokens each. */
const LONG = Array.from({ length: 40 }, (_, k) => `word${k}`).join(" ")

test("a held reply is released a text delta at a time, in order, until none are left", async () => {
  const script = scriptedModel({ answer: { text: LONG } })
  const hold = script.hold("step")
  const held = (await streamer(script))("step")
  const steps: string[] = []
  while (await hold.next()) {
    steps.push(hold.released)
    await vi.waitFor(() =>
      expect(held.events.filter(e => e === "text_delta")).toHaveLength(
        steps.length,
      ),
    )
  }
  await held.ended
  expect(steps.length).toBeGreaterThan(2)
  expect(
    steps.every((t, i) => i === 0 || t.startsWith(steps[i - 1] ?? "")),
  ).toBe(true)
  expect(textOf(await held.result)).toBe(LONG)
  expect(hold.released).toBe(LONG)
})

test("finish releases the rest of a reply stepped part way", async () => {
  const script = scriptedModel({ answer: { text: LONG } })
  const hold = script.hold("step")
  const held = (await streamer(script))("step")
  expect(await hold.next()).toBe(true)
  hold.finish()
  await held.ended
  expect(textOf(await held.result)).toBe(LONG)
})

test("a scripted tool step's call carries its arguments", async () => {
  const script = scriptedModel()
  const ask = await asker(script)
  script.use([{ tool: "read", args: { path: "notes.txt" } }])
  const reply = await ask("read it")
  expect(
    reply.content.flatMap(p => (p.type === "toolCall" ? [p] : [])),
  ).toMatchObject([{ name: "read", arguments: { path: "notes.txt" } }])
})

test("a run's end is answered with a verdict line, first, so the suites' threads are done", async () => {
  const setup = await loadModelSetup(
    { kind: "scripted", script: scriptedModel() },
    where(),
  )
  const describeModel = setup.describeModel
  if (describeModel === null) throw new Error("no describe model")
  const describe = async (user: string) =>
    textOf(
      await setup.models.completeSimple(describeModel, {
        systemPrompt: "summarize",
        messages: [{ role: "user", content: user, timestamp: 0 }],
      }),
    )
  expect(await describe(`What was asked\n\n${VERDICT_ALONE}\n`)).toBe(
    SCRIPTED_VERDICT,
  )
  expect(await describe(`What was asked\n\n${VERDICT_THEN_DIGEST}\n`)).toBe(
    `${SCRIPTED_VERDICT}\n${SCRIPTED_DESCRIPTION}`,
  )
  expect(await describe("a commit message, please")).toBe(SCRIPTED_DESCRIPTION)
})
