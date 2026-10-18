import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import {
  type AgentKey,
  decodeAgentRequest,
  decodeIdentities,
  encodeBind,
  encodeSign,
  FAILURE,
  frame,
  LIST_REQUEST,
  listReply,
  SUCCESS,
  takeFrame,
} from "./agent.ts"
import { SOCKET_ENV, serve, TOKEN_ENV } from "./hop.ts"
import { agentLine, connectLine } from "./hop-line.ts"
import { type SshHost, type SshHostOptions, startSshHost } from "./host.ts"
import type { HostKeyFacts } from "./lane-files.ts"
import { laneToken, type SshName, type SshPort } from "./names.ts"
import type { Ran } from "./programs.ts"
import { fingerprint } from "./relay-step.ts"
import type { CombinedConfig } from "./resolve.ts"
import { wireString } from "./wire.ts"

const SECRET = Buffer.alloc(32, 3)
const key = (name: string): AgentKey => ({
  blob: Buffer.from(name),
  comment: name,
})
const DEPLOY = key("deploy")
const MINE = key("mine")
const SIGNATURE = Buffer.concat([Buffer.from([14]), wireString("sig")])

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

const tempDir = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "ssh-"))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** An agent that lists `keys`, signs anything, and accepts a binding signed "good". */
async function fakeAgent(dir: string, name: string, keys: readonly AgentKey[]) {
  const socket = path.join(dir, `${name}.sock`)
  const requests: Uint8Array[] = []
  const server = net.createServer(c => {
    let buffer: Uint8Array = Buffer.alloc(0)
    c.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk])
      for (
        let t = takeFrame(buffer);
        t !== null && t !== "too-long";
        t = takeFrame(buffer)
      ) {
        buffer = t.rest
        requests.push(t.body)
        const r = decodeAgentRequest(t.body)
        const reply =
          r.kind === "list"
            ? listReply(keys)
            : r.kind === "sign"
              ? SIGNATURE
              : r.kind === "bind" &&
                  Buffer.from(r.signature).toString() === "good"
                ? SUCCESS
                : FAILURE
        c.write(frame(reply))
      }
    })
  })
  await new Promise<void>(r => server.listen(socket, r))
  cleanups.push(() => new Promise<void>(r => server.close(() => r())))
  return { socket, requests }
}

/** A connection to the host's socket as a lane's agent: one request, one reply. */
async function laneAgent(socket: string, lane: string) {
  const c = net.createConnection(socket)
  cleanups.push(() => {
    c.destroy()
  })
  await new Promise<void>(r => c.once("connect", () => r()))
  c.write(agentLine(laneToken(SECRET, lane)))
  let buffer: Uint8Array = Buffer.alloc(0)
  const replies: ((b: Uint8Array | null) => void)[] = []
  c.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk])
    for (
      let t = takeFrame(buffer);
      t !== null && t !== "too-long";
      t = takeFrame(buffer)
    ) {
      buffer = t.rest
      replies.shift()?.(t.body)
    }
  })
  c.on("close", () => {
    for (const r of replies.splice(0)) r(null)
  })
  const closed = new Promise<void>(r => c.once("close", () => r()))
  return {
    closed,
    request: (body: Uint8Array) =>
      new Promise<Uint8Array | null>(resolve => {
        replies.push(resolve)
        c.write(frame(body))
      }),
  }
}

const sign = (k: AgentKey, session = "s1") => ({
  kind: "sign" as const,
  key: k.blob,
  data: Buffer.concat([wireString(session), Buffer.from([50])]),
  flags: 0,
})

const bind = (signature: string, session = "s1") => ({
  kind: "bind" as const,
  hostKey: Buffer.from("popkey"),
  session: Buffer.from(session),
  signature: Buffer.from(signature),
  forwarding: false,
})

const ALL: HostKeyFacts = { personal: "all", names: new Map() }

async function host(
  over: Partial<SshHostOptions> & { dir: string },
): Promise<SshHost> {
  const h = await startSshHost({
    secret: SECRET,
    personalAgent: null,
    serviceAgent: null,
    serviceKeys: [],
    hostKeys: ALL,
    combinedConfig: null,
    mayUsePersonal: () => false,
    used: () => {},
    outside: () => {},
    ...over,
  })
  cleanups.push(() => h.close())
  return h
}

describe("the relay", () => {
  test("lists service keys first, each key once", async () => {
    const dir = tempDir()
    const service = await fakeAgent(dir, "service", [DEPLOY])
    const personal = await fakeAgent(dir, "personal", [MINE, DEPLOY])
    const h = await host({
      dir,
      serviceAgent: service.socket,
      personalAgent: personal.socket,
    })
    const lane = await laneAgent(h.socket, "t-a")
    const listed = decodeIdentities(
      (await lane.request(LIST_REQUEST)) ?? Buffer.alloc(0),
    )
    expect(listed?.map(k => k.comment)).toEqual(["deploy", "mine"])
  })

  test("a service sign reaches the service agent re-encoded, and is reported", async () => {
    const dir = tempDir()
    const service = await fakeAgent(dir, "service", [DEPLOY])
    const used: unknown[] = []
    const h = await host({
      dir,
      serviceAgent: service.socket,
      serviceKeys: [
        {
          name: "deploy",
          path: "/k",
          pub: "",
          blob: Buffer.from("deploy").toString("base64"),
        },
      ],
      used: (lane, use) => used.push([lane, use]),
    })
    const lane = await laneAgent(h.socket, "t-a")
    expect(await lane.request(encodeSign(sign(DEPLOY)))).toEqual(SIGNATURE)
    expect(service.requests.at(-1)).toEqual(
      Buffer.from(encodeSign(sign(DEPLOY))),
    )
    expect(used).toEqual([["t-a", { kind: "service", name: "deploy" }]])
  })

  test("a personal sign is answered at once from the policy", async () => {
    const dir = tempDir()
    const personal = await fakeAgent(dir, "personal", [MINE])
    const asked: unknown[] = []
    const h = await host({
      dir,
      personalAgent: personal.socket,
      mayUsePersonal: (lane, host) => {
        asked.push([lane, host])
        return true
      },
    })
    const lane = await laneAgent(h.socket, "t-a")
    expect(await lane.request(encodeSign(sign(MINE)))).toEqual(SIGNATURE)
    expect(asked).toEqual([["t-a", null]])
  })

  test("a personal sign the policy refuses fails", async () => {
    const dir = tempDir()
    const personal = await fakeAgent(dir, "personal", [MINE])
    const h = await host({ dir, personalAgent: personal.socket })
    const lane = await laneAgent(h.socket, "t-a")
    expect(await lane.request(encodeSign(sign(MINE)))).toEqual(FAILURE)
  })

  test("adding a key to the person's agent is refused, and never reaches it", async () => {
    const dir = tempDir()
    const personal = await fakeAgent(dir, "personal", [MINE])
    const h = await host({ dir, personalAgent: personal.socket })
    const lane = await laneAgent(h.socket, "t-a")
    expect(await lane.request(Buffer.from([17, 0, 0, 0, 0]))).toEqual(FAILURE)
    expect(personal.requests.filter(r => r[0] === 17)).toEqual([])
  })

  test("a binding the service agent refuses is not remembered", async () => {
    const dir = tempDir()
    const service = await fakeAgent(dir, "service", [])
    const personal = await fakeAgent(dir, "personal", [MINE])
    let asked = 0
    const h = await host({
      dir,
      serviceAgent: service.socket,
      personalAgent: personal.socket,
      hostKeys: {
        personal: new Set([Buffer.from("popkey").toString("base64")]),
        names: new Map(),
      },
      mayUsePersonal: () => {
        asked++
        return true
      },
    })
    const forged = await laneAgent(h.socket, "t-a")
    expect(await forged.request(encodeBind(bind("bad")))).toEqual(FAILURE)
    expect(await forged.request(encodeSign(sign(MINE)))).toEqual(FAILURE)
    expect(asked).toBe(0)
    const real = await laneAgent(h.socket, "t-a")
    expect(await real.request(encodeBind(bind("good")))).toEqual(SUCCESS)
    expect(await real.request(encodeSign(sign(MINE)))).toEqual(SIGNATURE)
    expect(asked).toBe(1)
  })

  test("a signature for a host outside is reported, never asked", async () => {
    const dir = tempDir()
    const service = await fakeAgent(dir, "service", [])
    const personal = await fakeAgent(dir, "personal", [MINE])
    const popKey = Buffer.from("popkey").toString("base64")
    let asked = 0
    const outside: unknown[] = []
    const h = await host({
      dir,
      serviceAgent: service.socket,
      personalAgent: personal.socket,
      hostKeys: { personal: new Set(), names: new Map([[popKey, "pop"]]) },
      mayUsePersonal: () => {
        asked++
        return true
      },
      outside: (lane, refusal) => outside.push([lane, refusal]),
    })
    const lane = await laneAgent(h.socket, "t-a")
    expect(await lane.request(encodeBind(bind("good")))).toEqual(SUCCESS)
    expect(await lane.request(encodeSign(sign(MINE)))).toEqual(FAILURE)
    expect(asked).toBe(0)
    expect(outside).toEqual([
      ["t-a", { host: "pop", key: fingerprint(popKey) }],
    ])
  })
})

describe("the host's socket", () => {
  test("a connection whose token does not check is closed", async () => {
    const dir = tempDir()
    const h = await host({ dir })
    const c = net.createConnection(h.socket)
    cleanups.push(() => {
      c.destroy()
    })
    c.write(agentLine(laneToken(Buffer.alloc(32, 9), "t-a")))
    await new Promise<void>(r => c.once("close", () => r()))
  })

  test("cut closes one lane's connections and not another's", async () => {
    const dir = tempDir()
    const service = await fakeAgent(dir, "service", [DEPLOY])
    const h = await host({ dir, serviceAgent: service.socket })
    const a = await laneAgent(h.socket, "t-a")
    const b = await laneAgent(h.socket, "t-b")
    await a.request(LIST_REQUEST)
    await b.request(LIST_REQUEST)
    h.cut("t-a")
    await a.closed
    expect(
      decodeIdentities((await b.request(LIST_REQUEST)) ?? Buffer.alloc(0)),
    ).toHaveLength(1)
  })
})

/** A TCP server on loopback that greets with `banner` and echoes. */
async function bannerServer(banner: string): Promise<number> {
  const server = net.createServer(c => {
    c.write(banner)
    c.pipe(c)
  })
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r))
  cleanups.push(() => new Promise<void>(r => server.close(() => r())))
  const address = server.address()
  return typeof address === "object" && address !== null ? address.port : 0
}

const COMBINED = "/combined" as CombinedConfig

const resolvedRun = (stdout: string) => async (): Promise<Ran> => ({
  code: 0,
  stdout,
  stderr: "",
})

async function connectThrough(h: SshHost, lane: string): Promise<string> {
  const c = net.createConnection(h.socket)
  cleanups.push(() => {
    c.destroy()
  })
  c.write(connectLine(laneToken(SECRET, lane), "pop" as SshName, 22 as SshPort))
  let got = ""
  return new Promise(resolve => {
    c.on("data", d => {
      got += d.toString()
      if (
        got.includes("\n") &&
        (got.startsWith("refused") || got.includes("SSH"))
      )
        resolve(got)
    })
    c.on("close", () => resolve(got))
  })
}

describe("the broker", () => {
  test("joins a resolved name to the host's own connection", async () => {
    const dir = tempDir()
    const port = await bannerServer("SSH-2.0-test\r\n")
    const used: unknown[] = []
    const h = await host({
      dir,
      combinedConfig: COMBINED,
      run: resolvedRun(`hostname 127.0.0.1\nport ${port}\n`),
      used: (lane, use) => used.push([lane, use]),
    })
    expect(await connectThrough(h, "t-a")).toBe("ok\nSSH-2.0-test\r\n")
    expect(used).toEqual([["t-a", { kind: "host", name: "pop" }]])
  })

  test("refuses a name the host's config runs a program for", async () => {
    const dir = tempDir()
    const h = await host({
      dir,
      combinedConfig: COMBINED,
      run: resolvedRun("hostname pop\nport 22\nproxycommand nc %h %p\n"),
    })
    expect(await connectThrough(h, "t-a")).toBe("refused proxycommand\n")
  })

  test("with no broker, refuses every name", async () => {
    const dir = tempDir()
    const h = await host({ dir })
    expect(await connectThrough(h, "t-a")).toBe("refused no-broker\n")
  })
})

describe("the hop", () => {
  const HOP = path.join(import.meta.dirname, "hop.ts")

  test("connect ends when the host cuts its lane, whatever is left of its input", async () => {
    const dir = tempDir()
    const port = await bannerServer("SSH-2.0-test\r\n")
    const h = await host({
      dir,
      combinedConfig: COMBINED,
      run: resolvedRun(`hostname 127.0.0.1\nport ${port}\n`),
    })
    const hop = spawn(process.execPath, [HOP, "connect", "pop", "22"], {
      env: {
        ...process.env,
        [TOKEN_ENV]: laneToken(SECRET, "t-a"),
        [SOCKET_ENV]: h.socket,
      },
    })
    cleanups.push(() => {
      hop.kill()
    })
    await new Promise<void>(r => hop.stdout.once("data", () => r()))
    h.cut("t-a")
    const code = await new Promise<number | null>(r => hop.once("exit", r))
    expect(code).toBe(0)
  })

  test("serve relays a lane's agent connection, named by its token", async () => {
    const dir = tempDir()
    const service = await fakeAgent(dir, "service", [DEPLOY])
    const h = await host({ dir, serviceAgent: service.socket })
    const listen = path.join(dir, "lane", "agent.sock")
    const server = serve(listen, h.socket, laneToken(SECRET, "t-a"))
    cleanups.push(() => new Promise<void>(r => server.close(() => r())))
    await new Promise<void>(r => server.once("listening", () => r()))
    const c = net.createConnection(listen)
    cleanups.push(() => {
      c.destroy()
    })
    c.write(frame(LIST_REQUEST))
    const reply = await new Promise<Buffer>(r => c.once("data", r))
    const taken = takeFrame(reply)
    expect(
      taken !== null && taken !== "too-long" && decodeIdentities(taken.body),
    ).toHaveLength(1)
  })

  test("connect joins stdin and stdout to the host's connection, and says a refusal", async () => {
    const dir = tempDir()
    const port = await bannerServer("SSH-2.0-test\r\n")
    const h = await host({
      dir,
      combinedConfig: COMBINED,
      run: async (argv): Promise<Ran> =>
        argv.includes("refused")
          ? {
              code: 0,
              stdout: "hostname refused\nport 22\nproxycommand x\n",
              stderr: "",
            }
          : {
              code: 0,
              stdout: `hostname 127.0.0.1\nport ${port}\n`,
              stderr: "",
            },
    })
    const env = {
      ...process.env,
      [TOKEN_ENV]: laneToken(SECRET, "t-a"),
      [SOCKET_ENV]: h.socket,
    }
    const hop = spawn(process.execPath, [HOP, "connect", "pop", "22"], { env })
    let out = ""
    hop.stdout.on("data", d => {
      out += d.toString()
    })
    hop.stdin.write("ping\n")
    await new Promise<void>(r => {
      const check = () => (out.includes("ping") ? r() : setTimeout(check, 10))
      check()
    })
    expect(out).toBe("SSH-2.0-test\r\nping\n")
    hop.kill()

    const refused = spawn(process.execPath, [HOP, "connect", "refused", "22"], {
      env,
    })
    let said = ""
    refused.stderr.on("data", d => {
      said += d.toString()
    })
    const status = await new Promise<number | null>(r =>
      refused.once("exit", r),
    )
    expect(status).toBe(255)
    expect(said).toContain("did not connect refused: proxycommand")
  })
})
