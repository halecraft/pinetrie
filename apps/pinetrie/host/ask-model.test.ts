import type { PiSetup } from "@pinetrie/pi"
import { expect, test } from "vitest"
import { askModel, oneAnswer, type ReplyRead } from "./ask-model.ts"
import { methods, record } from "./fakes.ts"

const setup = (text: string | null, skill = true) =>
  record<Pick<PiSetup, "skill" | "complete">>({
    skill: async () =>
      skill ? { path: "SKILL.md", content: "Answer.", hash: "h" } : null,
    complete: async () => ({ text, tokens: 7 }),
  })

const ask = <T>(parse: (reply: string) => ReplyRead<T>) => ({
  skill: "pinetrie:skill:thread-focus",
  request: (skill: string) => ({ system: skill, user: "asked" }),
  parse,
})

test("a missing skill asks nothing", async () => {
  const pi = setup("x", false)
  const lines: string[] = []
  const got = await askModel(
    { piSetup: pi.port, log: l => lines.push(l) },
    ask(r => ({ value: r, refused: [] })),
  )
  expect(got).toEqual({ value: null, tokens: 0 })
  expect(methods(pi.calls)).toEqual(["skill"])
  expect(lines).toEqual(["[host] no thread-focus skill"])
})

test("a refused reply is logged and counts its tokens", async () => {
  const lines: string[] = []
  const got = await askModel(
    { piSetup: setup("not a focus\nat all").port, log: l => lines.push(l) },
    ask(oneAnswer(() => null, "focus")),
  )
  expect(got).toEqual({ value: null, tokens: 7 })
  expect(lines).toEqual([
    '[host] the model\'s focus is not one: "not a focus\\nat all"',
  ])
})

test("a reply refused in part keeps its good part, and logs the other", async () => {
  const lines: string[] = []
  const got = await askModel(
    { piSetup: setup("done\nno digest").port, log: l => lines.push(l) },
    ask(r => ({ value: r.split("\n")[0], refused: ["digest"] })),
  )
  expect(got.value).toBe("done")
  expect(lines).toHaveLength(1)
  expect(lines[0]).toContain("the model's digest is not one")
})

test("a failed request is no value, its tokens counted", async () => {
  expect(
    await askModel(
      { piSetup: setup(null).port, log: () => {} },
      ask(r => ({ value: r, refused: [] })),
    ),
  ).toEqual({ value: null, tokens: 7 })
})
