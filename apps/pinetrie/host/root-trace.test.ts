import { rootDocId, rootIdFor } from "@pinetrie/core"
import { expect, test } from "vitest"
import { hostRoots } from "./fakes.ts"
import { callerIn, type RootEvent } from "./root-trace.ts"

const A = rootIdFor("01a0ffd2-0000-7000-8000-00000000000a")

test("the trace hears each use and whether it loaded, each release, and the upkeep that lets the root go", async () => {
  const events: RootEvent[] = []
  const { roots, keeper } = hostRoots({ trace: e => events.push(e) })
  const first = roots.leases.root(A)
  const second = roots.leases.root(A)
  await first.ready
  await first[Symbol.asyncDispose]()
  await second[Symbol.asyncDispose]()
  await keeper.idle()
  expect(
    events.map(e =>
      e.kind === "use"
        ? { kind: e.kind, via: e.via, loaded: e.loaded }
        : e.kind === "upkeep"
          ? { kind: e.kind, unload: e.unload, compact: e.compact }
          : e,
    ),
  ).toEqual([
    { kind: "use", via: "lease", loaded: true },
    { kind: "use", via: "lease", loaded: false },
    { kind: "release", root: A },
    { kind: "release", root: A },
    { kind: "upkeep", unload: [A], compact: [rootDocId(A)] },
  ])
})

test("a use names the first caller outside the code that keeps roots", () => {
  const stack = [
    "Error",
    "    at callerNow (file:///w/apps/pinetrie/host/root-trace.ts:52:41)",
    "    at use (file:///w/apps/pinetrie/host/roots.ts:296:76)",
    "    at lease (file:///w/apps/pinetrie/host/roots.ts:330:19)",
    "    at Object.wipLine (file:///w/apps/pinetrie/host/jj/proposed/state.ts:131:41)",
    "    at refresh (file:///w/apps/pinetrie/host/jj/proposed/refresh.ts:102:20)",
  ].join("\n")
  expect(callerIn(stack)).toBe("apps/pinetrie/host/jj/proposed/state.ts:131")
  expect(callerIn("Error\n    at node:internal/process/task_queues:95:5")).toBe(
    null,
  )
})
