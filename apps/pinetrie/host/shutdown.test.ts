import { expect, test } from "vitest"
import { planShutdown } from "./shutdown.ts"

test("planShutdown closes intake and the queues before it waits, waits before the agent closes, and closes the scribe after the agent", () => {
  const steps = planShutdown()
  const at = (s: (typeof steps)[number]) => steps.indexOf(s)
  expect(at("intake")).toBeLessThan(at("quiet"))
  expect(at("close")).toBeLessThan(at("quiet"))
  expect(at("quiet")).toBeLessThan(at("agent"))
  expect(at("agent")).toBeLessThan(at("scribe"))
  expect(new Set(steps).size).toBe(8)
})
