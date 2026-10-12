import { expect, test } from "vitest"
import { isEncrypted, pubBlob, serviceKeyCheck } from "./keys.ts"
import { wireString } from "./wire.ts"

/** An `openssh-key-v1` key's text up to its cipher, which is all the check reads. */
const opensshKey = (cipher: string): string =>
  [
    "-----BEGIN OPENSSH PRIVATE KEY-----",
    Buffer.concat([
      Buffer.from("openssh-key-v1\0"),
      wireString(cipher),
      wireString("none"),
    ]).toString("base64"),
    "-----END OPENSSH PRIVATE KEY-----",
  ].join("\n")

const PUB = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEVf deploy"
const files = (over: object) => ({
  name: "deploy",
  path: "/c/ssh/deploy",
  privateText: opensshKey("none"),
  mode: 0o600,
  pub: PUB,
  ...over,
})

test("an OpenSSH key with cipher none has no passphrase; another cipher has one", () => {
  expect(isEncrypted(opensshKey("none"))).toBe(false)
  expect(isEncrypted(opensshKey("aes256-ctr"))).toBe(true)
})

test("a PEM key says when it is encrypted", () => {
  expect(
    isEncrypted(
      "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nxx\n-----END RSA PRIVATE KEY-----",
    ),
  ).toBe(true)
  expect(
    isEncrypted(
      "-----BEGIN RSA PRIVATE KEY-----\nxx\n-----END RSA PRIVATE KEY-----",
    ),
  ).toBe(false)
  expect(
    isEncrypted(
      "-----BEGIN ENCRYPTED PRIVATE KEY-----\nxx\n-----END ENCRYPTED PRIVATE KEY-----",
    ),
  ).toBe(true)
})

test("text that is no key is not a key", () => {
  expect(isEncrypted("hello")).toBeNull()
  expect(serviceKeyCheck(files({ privateText: "hello" }))).toEqual({
    kind: "refused",
    name: "deploy",
    why: "not-a-key",
  })
})

test("a usable key carries its public key and blob", () => {
  expect(serviceKeyCheck(files({}))).toEqual({
    kind: "usable",
    key: {
      name: "deploy",
      path: "/c/ssh/deploy",
      pub: PUB,
      blob: "AAAAC3NzaC1lZDI1NTE5AAAAIEVf",
    },
  })
})

test("a key group or others can read is refused, as ssh refuses it", () => {
  for (const mode of [0o640, 0o604, 0o644])
    expect(serviceKeyCheck(files({ mode }))).toMatchObject({ why: "readable" })
})

test("a key with a passphrase is refused", () => {
  expect(
    serviceKeyCheck(files({ privateText: opensshKey("aes256-ctr") })),
  ).toMatchObject({ why: "passphrase" })
})

test("a key with no public key beside it is refused", () => {
  expect(serviceKeyCheck(files({ pub: null }))).toMatchObject({ why: "no-pub" })
  expect(serviceKeyCheck(files({ pub: "garbage" }))).toMatchObject({
    why: "no-pub",
  })
})

test("a public key's blob is its second word, and begins with its type", () => {
  expect(pubBlob("ssh-rsa AAAAB3NzaC1yc2EAAAADAQAB me@x")).toBe(
    "AAAAB3NzaC1yc2EAAAADAQAB",
  )
  expect(pubBlob("not a key line")).toBeNull()
  expect(pubBlob("ssh-rsa AAAAC3NzaC1lZDI1NTE5AAAAIEVf")).toBeNull()
})
