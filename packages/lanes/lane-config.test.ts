import { describe, expect, test } from "vitest"
import {
  configChangeNote,
  configWidenings,
  effectiveLaneConfig,
} from "./lane-config.ts"
import { NO_GRANTS } from "./spec.ts"

describe("config as a fact of a state: accepted work's, narrowed by the lane's", () => {
  const mount = { source: "/p/d", target: "/d", readonly: true }
  const accepted = {
    grants: {
      ssh: true,
      nested: true,
      hostPorts: [5432, 6379],
      env: ["A", "B"],
      mounts: [mount],
    },
    shared: [".plans", "notes"],
  }
  const none = { grants: NO_GRANTS, shared: [] }

  test("effectiveLaneConfig: what a lane dropped from its base's copy, key by key, it gives up", () => {
    expect(
      effectiveLaneConfig(accepted, {
        base: accepted,
        own: {
          grants: {
            ssh: false,
            nested: true,
            hostPorts: [5432, 8080],
            env: ["B", "C"],
            mounts: [mount, { source: "/x", target: "/x", readonly: true }],
          },
          shared: [".plans", "other"],
        },
      }),
    ).toEqual({
      grants: {
        ssh: false,
        nested: true,
        hostPorts: [5432],
        env: ["B"],
        mounts: [mount],
      },
      shared: [".plans"],
    })
  })

  test("effectiveLaneConfig: a grant accepted after the lane started reaches it; one its own copy adds never does", () => {
    const later = {
      grants: { ...accepted.grants, env: [...accepted.grants.env, "LATER"] },
      shared: accepted.shared,
    }
    const own = {
      grants: { ...accepted.grants, env: [...accepted.grants.env, "MINE"] },
      shared: accepted.shared,
    }
    expect(
      effectiveLaneConfig(later, { base: accepted, own }).grants.env,
    ).toEqual(["A", "B", "LATER"])
  })

  test("effectiveLaneConfig: a lane with no copy read gets accepted work's", () => {
    expect(effectiveLaneConfig(accepted, null)).toEqual(accepted)
  })

  test("configWidenings: what the second lets that the first does not, key by key", () => {
    expect(configWidenings(none, accepted)).toEqual([
      { kind: "ssh" },
      { kind: "nested" },
      { kind: "env", name: "A" },
      { kind: "env", name: "B" },
      { kind: "mount", target: "/d" },
      { kind: "host-port", port: 5432 },
      { kind: "host-port", port: 6379 },
      { kind: "shared", path: ".plans" },
      { kind: "shared", path: "notes" },
    ])
    expect(configWidenings(accepted, none)).toEqual([])
    expect(configWidenings(accepted, accepted)).toEqual([])
  })

  test("configChangeNote: what a lane gave up applies from its next run; what it asked for waits for acceptance", () => {
    const written = {
      grants: { ...accepted.grants, ssh: false, env: ["A", "B", "TOKEN"] },
      shared: accepted.shared,
    }
    expect(configChangeNote(accepted, written)).toBe(
      "pine·trie: this lane gives up your ssh identity from its next run.\npine·trie: this lane gets $TOKEN only once this change to pinetrie.json is accepted.",
    )
    expect(configChangeNote(accepted, accepted)).toBeNull()
  })
})
