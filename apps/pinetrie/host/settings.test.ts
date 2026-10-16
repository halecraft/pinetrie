import {
  decodeEnv,
  decodeLayer,
  decodeProject,
  type FileRead,
  projectCopy,
} from "@pinetrie/config"
import { configText, tableProblems } from "@pinetrie/config/testing"
import { DEFAULT_REPO } from "@pinetrie/jj"
import { NO_GRANTS } from "@pinetrie/lanes"
import { describe, expect, test } from "vitest"
import {
  decodeAuthority,
  laneCopy,
  repoNames,
  SETTINGS,
  settleHost,
  sshChoice,
} from "./settings.ts"

const read = (values: Record<string, unknown>): FileRead => ({
  kind: "text",
  text: configText(values),
})
const user = (values: Record<string, unknown>) =>
  decodeLayer(SETTINGS, "user", "user.json", read(values))
const system = (values: Record<string, unknown>) =>
  decodeLayer(SETTINGS, "system", "system.json", read(values))
const START = {
  system: null,
  user: user({}),
  local: null,
  env: decodeEnv(SETTINGS, {}),
}

test("the host's table keeps every rule", () => {
  expect(tableProblems(SETTINGS)).toEqual([])
})

describe("personal ssh", () => {
  const granted = laneCopy({
    grants: { ...NO_GRANTS, ssh: true },
    shared: [],
  })

  test("the person's false beats a project's grant", () => {
    const report = settleHost(
      { ...START, user: user({ "lanes.ssh.personal": false }) },
      { lane: granted },
    )
    expect(sshChoice(report).personal).toEqual({
      on: false,
      decider: "person",
    })
  })

  test("a project's grant is the project's choice", () => {
    expect(sshChoice(settleHost(START, { lane: granted })).personal).toEqual({
      on: true,
      decider: "project",
    })
  })

  test("a system file's false forbids it, whoever grants it", () => {
    const report = settleHost(
      {
        ...START,
        system: system({ "lanes.ssh.personal": false }),
        user: user({ "lanes.ssh.personal": true }),
      },
      {},
    )
    expect(sshChoice(report).personal).toEqual({
      on: false,
      decider: "machine",
    })
  })

  test("malformed hosts are refused, and turn personal ssh off rather than widening it", () => {
    const report = settleHost(
      { ...START, user: user({ "lanes.ssh.hosts": "pop" }) },
      {},
    )
    expect(report.refusals.map(r => r.key)).toEqual(["lanes.ssh.hosts"])
    expect(sshChoice(report).hosts).toBe("invalid")
  })
})

describe("defaults", () => {
  test("nothing set: built-in icons, titles and digests on, the default budget and slots", () => {
    const { settled } = settleHost(START, {})
    expect([
      settled["icons.source"].value,
      settled["titles.enabled"].value,
      settled["digests.enabled"].value,
      settled["agents.budget"].value,
      settled["lanes.vm.slots"].value,
    ]).toEqual(["built-in", true, true, 200_000, 16])
  })

  test("a VM's slots above 20 are refused: a VM boots with at most 20 share devices", () => {
    const report = settleHost(
      { ...START, user: user({ "lanes.vm.slots": 24 }) },
      {},
    )
    expect(report.settled["lanes.vm.slots"].value).toBe(16)
    expect(report.refusals.map(r => [r.key, r.why])).toEqual([
      ["lanes.vm.slots", "malformed"],
    ])
  })
})

describe("where each setting may come from", () => {
  test("a project's lanes.vm.slots is refused", () => {
    const copy = decodeProject(
      SETTINGS,
      projectCopy("accepted", "pinetrie.json", read({ "lanes.vm.slots": 4 })),
    )
    expect(copy.refusals.map(r => [r.key, r.why])).toEqual([
      ["lanes.vm.slots", "not-here"],
    ])
  })

  test("a project's packages are refused: they run code on the host", () => {
    const copy = decodeProject(
      SETTINGS,
      projectCopy("accepted", "pinetrie.json", read({ packages: ["/x"] })),
    )
    expect(copy.refusals.map(r => [r.key, r.why])).toEqual([
      ["packages", "not-here"],
    ])
  })

  test("the old lanes.ssh: true is refused as malformed", () => {
    expect(
      decodeAuthority(
        "/p",
        "pinetrie.json",
        '{"lanes":{"ssh":true}}',
      ).refusals.map(r => [r.key, r.why]),
    ).toEqual([["lanes.ssh", "malformed"]])
  })
})

describe("shared directories", () => {
  test("the person's come first, then the project's, each once", () => {
    const report = settleHost(
      { ...START, user: user({ "lanes.shared": [".plans", "notes"] }) },
      {
        lane: laneCopy({
          grants: NO_GRANTS,
          shared: [".plans", "shared/data"],
        }),
      },
    )
    expect(report.settled["lanes.shared"].value).toEqual([
      ".plans",
      "notes",
      "shared/data",
    ])
  })
})

describe("your repo's names", () => {
  test("the defaults with nothing set", () => {
    expect(repoNames(settleHost(START, {}).settled)).toEqual(DEFAULT_REPO)
  })

  test("the project's working copy beats the person's", () => {
    const working = decodeProject(
      SETTINGS,
      projectCopy(
        "working",
        "pinetrie.json",
        read({ "accepted.bookmark": "trunk" }),
      ),
    )
    const report = settleHost(
      {
        ...START,
        user: user({ "accepted.bookmark": "mine", "publish.catchUp": true }),
      },
      { working },
    )
    expect(repoNames(report.settled)).toEqual({
      ...DEFAULT_REPO,
      acceptedBookmark: "trunk",
      publishCatchesUp: true,
    })
  })

  test("a name that is no bookmark is refused, and the default holds", () => {
    const report = settleHost(
      {
        ...START,
        user: user({ "accepted.bookmark": "has space", "wip.prefix": "a..b/" }),
      },
      {},
    )
    expect(repoNames(report.settled)).toEqual(DEFAULT_REPO)
    expect(report.refusals.map(r => [r.key, r.why])).toEqual([
      ["accepted.bookmark", "malformed"],
      ["wip.prefix", "malformed"],
    ])
  })

  test("the old `offers` key is refused as unknown", () => {
    expect(
      user({ offers: { onto: "trunk" } }).refusals.map(r => [r.key, r.why]),
    ).toEqual([["offers", "unknown"]])
  })
})

describe("grants", () => {
  test("a mount's source is relative to the project", () => {
    expect(
      decodeAuthority(
        "/p/app",
        "pinetrie.json",
        JSON.stringify({
          lanes: { mounts: [{ source: "../d", target: "/d" }] },
        }),
      ).authority.grants.mounts,
    ).toEqual([{ source: "/p/d", target: "/d", readonly: true }])
  })

  test("a grant left unwritten is not granted", () => {
    expect(
      decodeAuthority("/p", "pinetrie.json", "{}").authority.grants,
    ).toEqual(NO_GRANTS)
  })

  test("ports come in order, each once", () => {
    expect(
      decodeAuthority(
        "/p",
        "pinetrie.json",
        JSON.stringify({ lanes: { hostPorts: [5432, 3000, 3000] } }),
      ).authority.grants.hostPorts,
    ).toEqual([3000, 5432])
  })

  test("a system file's false turns nested lanes off", () => {
    const report = settleHost(
      { ...START, system: system({ "lanes.nested": false }) },
      {
        lane: laneCopy({ grants: { ...NO_GRANTS, nested: true }, shared: [] }),
      },
    )
    expect(report.settled["lanes.nested"].value).toBe(false)
  })
})

describe("the model", () => {
  test("PINETRIE_MODEL beats every file", () => {
    const report = settleHost(
      {
        ...START,
        user: user({ model: "anthropic/claude-opus" }),
        env: decodeEnv(SETTINGS, { PINETRIE_MODEL: "openrouter/x/y" }),
      },
      {},
    )
    expect(report.settled.model.value).toEqual({
      provider: "openrouter",
      model: "x/y",
    })
  })

  test("none, when nothing names one", () => {
    expect(settleHost(START, {}).settled.model.value).toBeNull()
  })
})
