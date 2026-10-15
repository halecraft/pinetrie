import {
  chmodSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, expect, test } from "vitest"
import { sshSecret } from "./ssh.ts"

const dir = mkdtempSync(path.join(tmpdir(), "pinetrie-ssh-secret-"))
chmodSync(dir, 0o755)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const modeOf = (file: string) => statSync(file).mode & 0o777

test("the ssh secret is yours alone in a directory others can read, and kept once made", async () => {
  const file = path.join(dir, "made")
  const made = await sshSecret(file)
  expect(made.length).toBe(32)
  expect(modeOf(file)).toBe(0o600)
  expect(await sshSecret(file)).toEqual(made)
})

test("a file that is no secret is replaced by one that is yours alone", async () => {
  const file = path.join(dir, "short")
  writeFileSync(file, "short", { mode: 0o644 })
  expect((await sshSecret(file)).length).toBe(32)
  expect(modeOf(file)).toBe(0o600)
})
