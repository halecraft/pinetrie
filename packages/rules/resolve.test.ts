import { ERR } from "@pinetrie/core"
import { expect, test } from "vitest"
import { planResolveCommand } from "./resolve.ts"

test("planResolveCommand: a lane of the host's own and idle goes; one not its own or running is refused", () => {
  expect(planResolveCommand({ own: true, running: false })).toEqual({
    kind: "go",
  })
  expect(planResolveCommand({ own: false, running: false })).toEqual({
    kind: "refused",
    code: ERR.NOT_OWN_COPY,
  })
  expect(planResolveCommand({ own: true, running: true })).toEqual({
    kind: "refused",
    code: ERR.THREAD_RUNNING,
  })
})
