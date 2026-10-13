import { DEFAULT_REPO, decodeLaneConfig, type Ran } from "@pinetrie/lanes"
import type { RepoOwner } from "@pinetrie/repo"
import { expect, test } from "vitest"
import { record } from "../fakes.ts"
import { startLaneConfigs } from "./config.ts"

const ok = (stdout: string): Ran => ({ ok: true, code: 0, stdout, stderr: "" })

test("accepted work's config read again is not in force until it is taken", async () => {
  let file = JSON.stringify({ lanes: {} })
  const owner = record<RepoOwner>({
    read: go => go({ jj: async () => ok(file), git: async () => ok("") }),
  })
  const configs = await startLaneConfigs({
    root: "/p",
    owner: owner.port,
    repoConfig: DEFAULT_REPO,
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
