// The scripted model: its queue, its standing answer, and paused replies.

import path from "node:path"
import { VERDICT_ALONE, VERDICT_THEN_DIGEST } from "@pinetrie/rules"
import { expect, test, vi } from "vitest"
import { setUpModel } from "./config.ts"
import {
  SCRIPTED_DESCRIPTION,
  SCRIPTED_VERDICT,
  type ScriptedModel,
  scriptedModel,
} from "./scripted.ts"

const cwd = path.join(import.meta.dirname, "fixtures", "pi-agent")
const ANSWER = { text: "the answer" }

async function asker(script: ScriptedModel) {
  const setup = await setUpModel({ kind: "scripted", script }, { cwd })
  return (prompt: string, signal?: AbortSignal) =>
    setup.models.completeSimple(
      setup.model,
      {
        systemPrompt: "answer",
        messages: [{ role: "user", content: prompt, timestamp: 0 }],
      },
      signal === undefined ? {} : { signal },
    )
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

test("a paused reply waits until resumed, and others pass it", async () => {
  const script = scriptedModel({ answer: ANSWER })
  const ask = await asker(script)
  const paused = script.pause("wait")
  const held = ask("please wait here")
  await vi.waitFor(() => expect(paused.reached).toBe(true))
  expect(textOf(await ask("go"))).toBe("the answer")
  expect(await settled(held)).toBe(false)
  paused.resume()
  expect(textOf(await held)).toBe("the answer")
})

test("a pause matches one request", async () => {
  const script = scriptedModel({ answer: ANSWER })
  const ask = await asker(script)
  const paused = script.pause("wait")
  const first = ask("wait")
  await vi.waitFor(() => expect(paused.reached).toBe(true))
  expect(textOf(await ask("wait again"))).toBe("the answer")
  paused.resume()
  await first
})

test("a paused request whose run aborts ends, aborted, with no resume", async () => {
  const script = scriptedModel({ answer: ANSWER })
  const ask = await asker(script)
  const paused = script.pause("wait")
  const abort = new AbortController()
  const held = ask("wait", abort.signal)
  await vi.waitFor(() => expect(paused.reached).toBe(true))
  abort.abort()
  expect((await held).stopReason).toBe("aborted")
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

test("a run's end is answered with a verdict line, first, so the suites' threads are done (ADR-0077)", async () => {
  const setup = await setUpModel(
    { kind: "scripted", script: scriptedModel() },
    { cwd },
  )
  const describe = async (user: string) =>
    textOf(
      await setup.models.completeSimple(setup.describeModel, {
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
