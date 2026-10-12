import { describe, expect, test } from "vitest"
import { agentLine, connectLine, decodeHopLine } from "./hop-line.ts"
import {
  laneToken,
  parseSshName,
  parseSshPort,
  type SshName,
  type SshPort,
  tokenLane,
} from "./names.ts"

const SECRET = Buffer.alloc(32, 7)
const OTHER = Buffer.alloc(32, 8)

describe("parseSshName", () => {
  test("a host name, an address or a bracketed IPv6 address passes", () => {
    for (const name of ["pop", "web.prod", "192.168.1.2", "[::1]"])
      expect(parseSshName(name)).toBe(name)
  })

  test("a leading dash, which ssh would read as an option, is refused", () => {
    for (const name of ["-oProxyCommand=x", "-v", "-Fconfig"])
      expect(parseSshName(name)).toBeNull()
  })

  test("a space or a shell character is refused", () => {
    for (const name of ["a b", "a;b", "a$b", ""])
      expect(parseSshName(name)).toBeNull()
  })
})

test("a port is 1 to 65535, written in digits", () => {
  expect(parseSshPort("22")).toBe(22)
  for (const port of ["0", "65536", "2a", "-1", ""])
    expect(parseSshPort(port)).toBeNull()
})

describe("a lane's token", () => {
  test("reads back its lane", () => {
    expect(tokenLane(SECRET, laneToken(SECRET, "t-01a1"))).toBe("t-01a1")
  })

  test("another secret's token is refused", () => {
    expect(tokenLane(SECRET, laneToken(OTHER, "t-01a1"))).toBeNull()
  })

  test("a lane changed under its MAC is refused", () => {
    const [, mac] = laneToken(SECRET, "t-01a1").split(".")
    const forged = `${Buffer.from("t-02b2").toString("base64url")}.${mac}`
    expect(tokenLane(SECRET, forged)).toBeNull()
  })

  test("a short or missing MAC is refused without throwing", () => {
    expect(tokenLane(SECRET, "dC0wMWEx.abcd")).toBeNull()
    expect(tokenLane(SECRET, "dC0wMWEx")).toBeNull()
  })
})

describe("the hop's line", () => {
  const token = laneToken(SECRET, "t-01a1")

  test("an agent line names its lane", () => {
    expect(decodeHopLine(agentLine(token).trimEnd(), SECRET)).toEqual({
      kind: "agent",
      lane: "t-01a1",
    })
  })

  test("a connect line names its lane, host and port", () => {
    const line = connectLine(token, "pop" as SshName, 22 as SshPort)
    expect(decodeHopLine(line.trimEnd(), SECRET)).toEqual({
      kind: "connect",
      lane: "t-01a1",
      name: "pop",
      port: 22,
    })
  })

  test("a connect line naming an option is refused", () => {
    expect(
      decodeHopLine(`connect ${token} -oProxyCommand=x 22`, SECRET),
    ).toBeNull()
  })

  test("a line whose token does not check is refused", () => {
    expect(
      decodeHopLine(`agent ${laneToken(OTHER, "t-01a1")}`, SECRET),
    ).toBeNull()
  })

  test("extra words are refused", () => {
    expect(decodeHopLine(`agent ${token} more`, SECRET)).toBeNull()
  })
})
