import { expect, test } from "vitest"
import { planShutdown } from "./shutdown.ts"

test("planShutdown closes intake and the queues before it waits, and waits before the agent closes", () => {
  const steps = planShutdown()
  const at = (s: (typeof steps)[number]) => steps.indexOf(s)
  expect(at("intake")).toBeLessThan(at("quiet"))
  expect(at("close")).toBeLessThan(at("quiet"))
  expect(at("quiet")).toBeLessThan(at("agent"))
  expect(new Set(steps).size).toBe(7)
})
