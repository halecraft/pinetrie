import { describe, expect, test } from "vitest"
import type { BindRequest, SignRequest } from "./agent.ts"
import {
  fingerprint,
  NEW_CONNECTION,
  type RelayFacts,
  relayStep,
  withBinding,
} from "./relay-step.ts"
import { wireString } from "./wire.ts"

const blob = (s: string) => Buffer.from(s)
const b64 = (s: string) => Buffer.from(s).toString("base64")

/** A login's data: its session id, then SSH2_MSG_USERAUTH_REQUEST. */
const loginData = (session: string) =>
  Buffer.concat([wireString(Buffer.from(session)), Buffer.from([50])])

const signWith = (key: string, session = "s1"): SignRequest => ({
  kind: "sign",
  key: blob(key),
  data: loginData(session),
  flags: 0,
})

const bindTo = (hostKey: string, session = "s1"): BindRequest => ({
  kind: "bind",
  hostKey: blob(hostKey),
  session: Buffer.from(session),
  signature: Buffer.from("sig"),
  forwarding: false,
})

const facts = (over: Partial<RelayFacts> = {}): RelayFacts => ({
  service: new Set([b64("deploy")]),
  personal: new Set([b64("mine"), b64("deploy")]),
  hostKeys: { personal: "all", names: new Map([[b64("popkey"), "pop"]]) },
  newestName: null,
  ...over,
})

test("anything but listing, signing and binding is refused", () => {
  expect(relayStep(NEW_CONNECTION, { kind: "other" }, facts())).toEqual({
    kind: "refuse",
  })
})

test("a session binding is verified before it is remembered", () => {
  const bind = bindTo("popkey")
  expect(relayStep(NEW_CONNECTION, bind, facts())).toEqual({
    kind: "verify",
    request: bind,
  })
})

test("a service key signs with no question, even when the person holds it too", () => {
  expect(relayStep(NEW_CONNECTION, signWith("deploy"), facts())).toMatchObject({
    kind: "sign",
    with: "service",
  })
})

test("a key neither agent holds is refused", () => {
  expect(relayStep(NEW_CONNECTION, signWith("stranger"), facts())).toEqual({
    kind: "refuse",
  })
})

test("a personal key with personal identity off is refused", () => {
  expect(
    relayStep(NEW_CONNECTION, signWith("mine"), facts({ personal: null })),
  ).toEqual({ kind: "refuse" })
})

describe("a personal key asks", () => {
  test("naming the bound host from known_hosts", () => {
    const state = withBinding(NEW_CONNECTION, bindTo("popkey"))
    expect(relayStep(state, signWith("mine"), facts())).toMatchObject({
      kind: "ask",
      host: "pop",
    })
  })

  test("naming the broker's newest host when known_hosts does not", () => {
    const state = withBinding(NEW_CONNECTION, bindTo("otherkey"))
    expect(
      relayStep(state, signWith("mine"), facts({ newestName: "web" })),
    ).toMatchObject({ host: "web" })
  })

  test("naming the key's fingerprint when nothing else does", () => {
    const state = withBinding(NEW_CONNECTION, bindTo("otherkey"))
    expect(relayStep(state, signWith("mine"), facts())).toMatchObject({
      host: fingerprint(b64("otherkey")),
    })
  })

  test("naming no host for an unbound session", () => {
    expect(relayStep(NEW_CONNECTION, signWith("mine"), facts())).toMatchObject({
      kind: "ask",
      host: null,
    })
  })
})

describe("with personal hosts narrowed", () => {
  const narrowed = facts({
    hostKeys: {
      personal: new Set([b64("popkey")]),
      names: new Map([[b64("evilkey"), "192.168.1.9"]]),
    },
    newestName: "hql",
  })

  test("a sign for an allowed host's bound session asks", () => {
    const state = withBinding(NEW_CONNECTION, bindTo("popkey"))
    expect(relayStep(state, signWith("mine"), narrowed).kind).toBe("ask")
  })

  test("a sign for an unbound session is refused as outside, named by the broker", () => {
    expect(relayStep(NEW_CONNECTION, signWith("mine"), narrowed)).toEqual({
      kind: "outside",
      refusal: { host: "hql", key: null },
    })
  })

  test("a host key outside the allowed hosts is refused as outside", () => {
    const state = withBinding(NEW_CONNECTION, bindTo("evilkey"))
    expect(relayStep(state, signWith("mine"), narrowed)).toEqual({
      kind: "outside",
      refusal: { host: "192.168.1.9", key: fingerprint(b64("evilkey")) },
    })
  })

  test("a sign for another session than the one bound is refused as outside", () => {
    const state = withBinding(NEW_CONNECTION, bindTo("popkey", "s1"))
    expect(relayStep(state, signWith("mine", "s2"), narrowed).kind).toBe(
      "outside",
    )
  })
})
