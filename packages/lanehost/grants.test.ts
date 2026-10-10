import { describe, expect, test } from "vitest"
import { type Grant, grantChain, planGrant } from "./grants.ts"

const KEY = "0123456789abcdef"
const chain = grantChain(KEY)
const grant: Grant = {
  project: KEY,
  subnet: "172.18.0.0/16",
  hostAddress: "192.168.127.254",
  ports: [3000, 5432],
}
const current = [
  "-P DOCKER-USER ACCEPT",
  `-A DOCKER-USER -s 172.17.0.0/16 -j ${chain}`,
  "-A DOCKER-USER -s 172.19.0.0/16 -j PT-ffffffffffffffff",
  "-A DOCKER-USER -j RETURN",
]

describe("planGrant: one project's grant as one iptables-restore input", () => {
  test("the rules accept each port only from the project's network, to the host's address, after clearing its old ones", () => {
    const lines = planGrant(grant, current).split("\n")
    expect(lines.slice(0, 3)).toEqual([
      "*filter",
      `:${chain} - [0:0]`,
      `-F ${chain}`,
    ])
    expect(lines).toContain(`-D DOCKER-USER -s 172.17.0.0/16 -j ${chain}`)
    expect(lines.join("\n")).not.toContain("PT-ffffffffffffffff")
    expect(lines.findIndex(l => l.startsWith("-D "))).toBeLessThan(
      lines.findIndex(l => l.includes("--dport")),
    )
    expect(lines).toContain(
      `-A ${chain} -d 192.168.127.254 -p tcp --dport 5432 -j ACCEPT`,
    )
    expect(lines.slice(-3)).toEqual([
      `-I DOCKER-USER -s 172.18.0.0/16 -j ${chain}`,
      "COMMIT",
      "",
    ])
  })
  test("with no ports, only the old rules go, and the chain", () => {
    const input = planGrant({ ...grant, subnet: "", ports: [] }, current)
    expect(input).not.toContain("ACCEPT")
    expect(input).not.toContain("-I DOCKER-USER")
    expect(input.split("\n").slice(-3)).toEqual([`-X ${chain}`, "COMMIT", ""])
  })
  test("a value that could be anything but what it says is refused", () => {
    expect(() => planGrant({ ...grant, project: "x; reboot" }, [])).toThrow(
      "not a project's key",
    )
    expect(() =>
      planGrant({ ...grant, subnet: "0.0.0.0/0 -j ACCEPT" }, []),
    ).toThrow("not a subnet")
    expect(() => planGrant({ ...grant, ports: [0] }, [])).toThrow("not ports")
    expect(() => planGrant({ ...grant, subnet: "" }, [])).toThrow(
      "ports granted to no network",
    )
  })
})
