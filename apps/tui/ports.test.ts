import { canvasIdFor } from "@pinetrie/core"
import { cardIdFor } from "@pinetrie/core/fixtures"
import type { AppPorts } from "@pinetrie/interface"
import { expect, test } from "vitest"
import { type PortCall, terminalPorts } from "./ports.ts"

const given = {
  session: {} as AppPorts["session"],
  attention: {} as AppPorts["attention"],
  uploadBlob: async () => ({ ok: false, reason: "no host" }) as const,
}

test("a fold lands at once, exactly once: nothing moves in a terminal", () => {
  let commits = 0
  terminalPorts(given, () => {}).foldColumn(
    { column: { kind: "canvas", canvas: canvasIdFor("c") }, unfolded: true },
    () => {
      commits++
    },
  )
  expect(commits).toBe(1)
})

test("what a terminal has no screen for is noted, in order; a flight is not", () => {
  const calls: PortCall[] = []
  const ports = terminalPorts(given, call => calls.push(call))
  ports.page("profile")
  ports.fly(cardIdFor("c1"), "move")
  ports.reload()
  expect(calls).toEqual([
    { port: "page", with: ["profile"] },
    { port: "reload", with: [] },
  ])
})
