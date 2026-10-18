import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"
import type { SshName, SshPort } from "./names.ts"
import {
  brokerTarget,
  type CombinedConfig,
  checkedHostName,
  combinedConfigText,
  parseResolved,
  resolveArgv,
} from "./resolve.ts"

/** Each case's `ssh -G` output in `testdata/ssh-g.txt`, by its alias. */
const captured = new Map(
  readFileSync(path.join(import.meta.dirname, "testdata/ssh-g.txt"), "utf8")
    .split(/^## /m)
    .slice(1)
    .map(block => {
      const at = block.indexOf("\n")
      return [block.slice(0, at), block.slice(at + 1)] as const
    }),
)
const resolvedCase = (alias: string) => parseResolved(captured.get(alias) ?? "")

describe("parseResolved", () => {
  test("reads a real answer's host, port, alias and command", () => {
    expect(resolvedCase("aliasedport")).toEqual({
      hostname: "192.168.1.2",
      port: 2222,
      hostKeyAlias: "hq-box",
      proxyCommand: null,
    })
    expect(resolvedCase("proxied")?.proxyCommand).toBe("nc %h %p")
  })

  test("a port outside 1–65535 resolves to nothing", () => {
    expect(parseResolved("hostname pop\nport 70000\n")).toBeNull()
    expect(parseResolved("hostname pop\nport 0\n")).toBeNull()
    expect(parseResolved("port 22\n")).toBeNull()
  })
})

describe("checkedHostName", () => {
  test("a HostKeyAlias is the name a key is checked under", () => {
    const resolved = resolvedCase("aliasedport")
    expect(resolved && checkedHostName(resolved)).toBe("hq-box")
  })

  test("without one, the host name and its port", () => {
    const resolved = resolvedCase("plainport")
    expect(resolved && checkedHostName(resolved)).toBe("[192.168.1.2]:2222")
  })
})

test("the broker refuses a name the host runs a program for", () => {
  expect(brokerTarget(resolvedCase("proxied"))).toEqual({
    kind: "refused",
    why: "proxycommand",
  })
  expect(brokerTarget(null)).toEqual({ kind: "refused", why: "unresolved" })
})

test("an allowed host is resolved without -p", () => {
  const config = "/c" as CombinedConfig
  expect(resolveArgv(config, "hql" as SshName, null)).toEqual([
    "ssh",
    "-G",
    "-F",
    "/c",
    "--",
    "hql",
  ])
  expect(resolveArgv(config, "hql" as SshName, 2222 as SshPort)).toContain("-p")
})

test("the combined config includes the service's before the person's", () => {
  expect(
    combinedConfigText({ service: "/s/config", personal: "/p/config" }),
  ).toBe("Include /s/config\nInclude /p/config\n")
})
