import { expect, test } from "vitest"
import {
  decodeFromLauncher,
  decodeToLauncher,
  encode,
  type FromLauncher,
  type ToLauncher,
} from "./protocol.ts"

test("each message is one line, and decodes to itself", () => {
  const to: ToLauncher[] = [
    { kind: "lease", agent: "/tmp/ssh/agent" },
    { kind: "lease", agent: null },
    { kind: "retire" },
    { kind: "status" },
    { kind: "stop-for-repair" },
    {
      kind: "fill",
      entries: [{ name: "a1", source: "/p", readOnly: true }],
    },
  ]
  for (const m of to) {
    const line = encode(m)
    expect(line.endsWith("\n")).toBe(true)
    expect(line.slice(0, -1)).not.toContain("\n")
    expect(decodeToLauncher(line)).toEqual(m)
  }
  const from: FromLauncher[] = [
    {
      kind: "slot",
      slot: 3,
      docker: "/s/docker.sock",
      image: "a70b862afa160d67",
      launcher: "launcher-c6fb456ce1458f03",
      leases: 2,
    },
    { kind: "refused", reason: "busy", leases: 2 },
    { kind: "filled" },
    {
      kind: "status",
      image: "a70b862afa160d67",
      launcher: "launcher-c6fb456ce1458f03",
      leases: 0,
    },
    { kind: "refused", reason: "full", slots: 16 },
    { kind: "refused", reason: "filled" },
    { kind: "refused", reason: "boot", detail: "no kernel" },
  ]
  for (const m of from) expect(decodeFromLauncher(encode(m))).toEqual(m)
})

test("an unknown kind, an unknown reason, or a malformed field is refused", () => {
  expect(decodeFromLauncher('{"kind":"steal"}')).toBeNull()
  expect(decodeFromLauncher('{"kind":"refused","reason":"tired"}')).toBeNull()
  expect(
    decodeFromLauncher('{"kind":"slot","slot":"1","docker":"/d"}'),
  ).toBeNull()
  expect(decodeFromLauncher("not json")).toBeNull()
  expect(decodeToLauncher('{"kind":"lease"}')).toBeNull()
  expect(
    decodeToLauncher('{"kind":"fill","entries":[{"name":"a","source":"/p"}]}'),
  ).toBeNull()
  expect(decodeToLauncher('{"kind":"shell","cmd":"sh"}')).toBeNull()
})

test("a slot from a launcher older than the VM's identity is read, its identity null", () => {
  expect(decodeFromLauncher('{"kind":"slot","slot":1,"docker":"/d"}')).toEqual({
    kind: "slot",
    slot: 1,
    docker: "/d",
    image: null,
    launcher: null,
    leases: null,
  })
})

test("a status reply without the VM's identity is not one", () => {
  expect(decodeFromLauncher('{"kind":"status"}')).toBeNull()
  expect(
    decodeFromLauncher('{"kind":"status","image":"k","launcher":"l"}'),
  ).toBeNull()
})
