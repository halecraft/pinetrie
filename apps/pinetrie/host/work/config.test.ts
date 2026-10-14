import {
  decodeEnv,
  decodeLayer,
  decodeProject,
  projectCopy,
} from "@pinetrie/config"
import { expect, test } from "vitest"
import { SETTINGS } from "../settings.ts"
import { startLaneConfigs } from "./config.ts"

const MISSING = { kind: "missing" } as const
const start = (user: string | null) => ({
  system: null,
  user: decodeLayer(
    SETTINGS,
    "user",
    "user.json",
    user === null ? MISSING : { kind: "text", text: user },
  ),
  local: null,
  env: decodeEnv(SETTINGS, {}),
})
const working = decodeProject(
  SETTINGS,
  projectCopy("working", "pinetrie.json", MISSING),
)

async function configsWith(accepted: () => string, user: string | null = null) {
  return startLaneConfigs({
    root: "/p",
    project: {
      fileAt: async () => ({ kind: "read", at: "accepted", text: accepted() }),
      prepareShared: async entries => ({
        shared: entries.map(p => ({ path: p, source: `/p/${p}` })),
        refused: [],
      }),
    },
    start: start(user),
    working,
    log: () => {},
  })
}

test("accepted work's config read again is not in force until it is taken", async () => {
  let file = JSON.stringify({ lanes: {} })
  const configs = await configsWith(() => file)
  file = JSON.stringify({ lanes: { hostPorts: [3000] } })
  const next = await configs.readAccepted()
  expect(next.authority.grants.hostPorts).toEqual([3000])
  expect(configs.accepted().authority.grants.hostPorts).toEqual([])
  configs.takeAccepted(next)
  expect(configs.accepted().authority.grants.hostPorts).toEqual([3000])
})

test("the shared directories are yours and accepted work's, yours first", async () => {
  const configs = await configsWith(
    () => JSON.stringify({ lanes: { shared: ["data"] } }),
    JSON.stringify({ lanes: { shared: [".plans"] } }),
  )
  expect(configs.accepted().shared.map(d => d.path)).toEqual([".plans", "data"])
})

test("a lane's write of an unknown key is told it is not read", async () => {
  const configs = await configsWith(() => "{}")
  expect(configs.configNote(JSON.stringify({ lanes: { color: 1 } }))).toBe(
    "pine·trie: pinetrie.json: lanes.color is not a setting, and is not read.",
  )
})
