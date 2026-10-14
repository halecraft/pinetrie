import { mkdtempSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "vitest"
import { bindAgentDir } from "./agent-dir.ts"
import {
  planSignIn,
  providerAuth,
  type SignInProvider,
  signInNoticeLines,
} from "./auth.ts"

const dir = mkdtempSync(path.join(tmpdir(), "pinetrie-auth-"))
const places = {
  configDir: path.join(dir, "config"),
  credentials: path.join(dir, "data", "auth.json"),
  models: path.join(dir, "config", "models.json"),
}
const binding = bindAgentDir(places.configDir)

test("an API key signed in is kept in pine·trie's auth.json, private, and listed by where it is, never by the key", async () => {
  const auth = await providerAuth({ places, binding, packages: [] })
  const asked: string[] = []
  await auth.signIn("openai", "api_key", {
    prompt: async p => {
      asked.push(p.kind)
      return "sk-test-123"
    },
    notify: () => {},
  })
  expect(asked).toEqual(["secret"])
  expect(statSync(places.credentials).mode & 0o777).toBe(0o600)
  expect(statSync(path.dirname(places.credentials)).mode & 0o777).toBe(0o700)
  expect(readFileSync(places.credentials, "utf8")).toContain("sk-test-123")
  const openai = auth.providers().find(p => p.id === "openai")
  expect(openai?.credential).toBe("stored")
  expect(JSON.stringify(auth.providers())).not.toContain("sk-test-123")
  await auth.signOut("openai")
  expect(auth.providers().find(p => p.id === "openai")?.credential).toBeNull()
})

describe("planSignIn", () => {
  const both: SignInProvider = {
    id: "anthropic",
    name: "Anthropic",
    methods: ["oauth", "api_key"],
    oauthName: "Anthropic (Claude Pro/Max)",
    credential: null,
  }
  const key: SignInProvider = {
    id: "openai",
    name: "OpenAI",
    methods: ["api_key"],
    oauthName: null,
    credential: null,
  }
  const providers = [both, key]

  test("no provider named lists them", () => {
    expect(planSignIn(providers, [])).toEqual({ kind: "list" })
  })
  test("a provider with one method signs in with it, named by id or name", () => {
    expect(planSignIn(providers, ["OpenAI"])).toEqual({
      kind: "sign-in",
      provider: key,
      method: "api_key",
    })
  })
  test("a provider with two asks which, unless one is named", () => {
    expect(planSignIn(providers, ["anthropic"])).toEqual({
      kind: "choose",
      provider: both,
    })
    expect(planSignIn(providers, ["anthropic", "api-key"])).toEqual({
      kind: "sign-in",
      provider: both,
      method: "api_key",
    })
  })
  test("a name no provider has is unknown", () => {
    expect(planSignIn(providers, ["nope"])).toEqual({
      kind: "unknown",
      named: "nope",
    })
  })
})

test("a device code is said with where to enter it", () => {
  expect(
    signInNoticeLines({
      kind: "device-code",
      code: "ABCD-1234",
      url: "https://github.com/login/device",
    }),
  ).toEqual([
    "Go to https://github.com/login/device and enter the code ABCD-1234",
  ])
})
