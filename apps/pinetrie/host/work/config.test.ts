import { decodeLaneConfig } from "@pinetrie/lanes"
import { expect, test } from "vitest"
import { startLaneConfigs } from "./config.ts"

test("accepted work's config read again is not in force until it is taken", async () => {
  let file = JSON.stringify({ lanes: {} })
  const configs = await startLaneConfigs({
    root: "/p",
    project: {
      fileAt: async () => ({ kind: "read", at: "accepted", text: file }),
      prepareShared: async () => ({ shared: [], refused: [] }),
    },
    user: decodeLaneConfig({}, "/p"),
    userFile: "config.json",
    log: () => {},
  })
  file = JSON.stringify({ lanes: { hostPorts: [3000] } })
  const next = await configs.readAccepted()
  expect(next.authority.grants.hostPorts).toEqual([3000])
  expect(configs.accepted().authority.grants.hostPorts).toEqual([])
  configs.takeAccepted(next)
  expect(configs.accepted().authority.grants.hostPorts).toEqual([3000])
})
