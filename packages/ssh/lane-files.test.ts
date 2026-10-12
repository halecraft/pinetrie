import { describe, expect, test } from "vitest"
import {
  hashedHostMatches,
  identityRef,
  keyFileName,
  laneKnownHosts,
  planLaneSsh,
  type SshSources,
} from "./lane-files.ts"

const DIRS = { home: "/home/d", service: "/home/d/.config/pinetrie/ssh" }
const DEPLOY_PUB = "ssh-ed25519 AAAAdeploy deploy"
const ME_PUB = "ssh-ed25519 AAAAme d@mac"
const ON = { kind: "on", hosts: "all", own: false } as const
const CONNECT =
  "/pinetrie-runtime/node/node /pinetrie/packages/ssh/hop.ts connect"

const sources = (over: Partial<SshSources>): SshSources => ({
  service: null,
  personal: null,
  pubs: new Map(),
  knownHosts: { service: null, personal: null },
  ...over,
})

// A real line, hashed by `ssh-keygen -H` from `pop.lan ssh-ed25519 …`.
const KEY =
  "AAAAC3NzaC1lZDI1NTE5AAAAIEVfIP5xz+MysymNU+CGc0IfsUGaFQFq+pT5WNAxjPkV"
const HASHED = `|1|y56KswpK/dHJXvrxFB7vvnpC51c=|9o2IDvm+XMBhM7Ow4/lfjcsY8co= ssh-ed25519 ${KEY}`

describe("identityRef", () => {
  test("a relative service path is in the service folder", () => {
    expect(identityRef("./deploy", "service", DIRS)).toEqual({
      kind: "path",
      path: "/home/d/.config/pinetrie/ssh/deploy",
    })
  })

  test("a service path that leaves the folder is dropped", () => {
    for (const p of ["../../../.ssh/id_ed25519", "~/.ssh/id_ed25519", "/etc/x"])
      expect(identityRef(p, "service", DIRS)).toEqual({
        kind: "dropped",
        why: "outside-folder",
      })
  })

  test("a personal path is home's, and a relative one is dropped", () => {
    expect(identityRef("~/.ssh/id", "personal", DIRS)).toEqual({
      kind: "path",
      path: "/home/d/.ssh/id",
    })
    expect(identityRef("%d/.ssh/id", "personal", DIRS)).toEqual({
      kind: "path",
      path: "/home/d/.ssh/id",
    })
    expect(identityRef("id", "personal", DIRS)).toEqual({
      kind: "dropped",
      why: "relative",
    })
  })

  test("a per-connection token is dropped", () => {
    expect(identityRef("~/.ssh/id_%h", "personal", DIRS)).toEqual({
      kind: "dropped",
      why: "token",
    })
  })
})

describe("planLaneSsh", () => {
  test("service blocks come first, so their settings win", () => {
    const { config } = planLaneSsh(
      sources({
        service: "Host pop\n  User deploy",
        personal: "Host pop\n  HostName 192.168.1.2\n  User d",
      }),
      ON,
      DIRS,
      CONNECT,
    )
    expect(config.indexOf("User deploy")).toBeLessThan(
      config.indexOf("User d\n"),
    )
  })

  test("a line that runs something on the host never reaches the lane", () => {
    const { config } = planLaneSsh(
      sources({
        personal:
          "Host x\n  ProxyCommand nc %h %p\n  LocalCommand rm -rf ~\n  HostName x.lan",
      }),
      ON,
      DIRS,
      null,
    )
    expect(config).not.toMatch(/ProxyCommand|LocalCommand|nc %h|rm -rf/)
    expect(config).toMatch(/HostName x\.lan/)
  })

  test("an IdentityFile becomes its public key's copy, pinned", () => {
    const files = planLaneSsh(
      sources({
        service: "Host *.prod\n  IdentityFile ./deploy",
        pubs: new Map([[`${DIRS.service}/deploy`, DEPLOY_PUB]]),
      }),
      ON,
      DIRS,
      CONNECT,
    )
    const name = keyFileName(DEPLOY_PUB)
    expect(files.config).toContain(`IdentityFile /pinetrie-ssh/keys/${name}`)
    expect(files.config).toContain("IdentitiesOnly yes")
    expect(files.keys.get(name)).toBe(DEPLOY_PUB)
  })

  test("an IdentityFile with no public key, or outside the folder, is dropped and said", () => {
    const { config, dropped } = planLaneSsh(
      sources({
        service:
          "Host a\n  IdentityFile ../../.ssh/id\nHost b\n  IdentityFile ./ci",
      }),
      ON,
      DIRS,
      CONNECT,
    )
    expect(config).not.toContain("IdentityFile")
    expect(dropped).toEqual([
      { side: "service", file: "../../.ssh/id", why: "outside-folder" },
      { side: "service", file: "./ci", why: "no-pub" },
    ])
  })

  test("personal blocks are left out when personal identity is off", () => {
    const { config } = planLaneSsh(
      sources({ personal: "Host pop\n  HostName 192.168.1.2" }),
      { kind: "off", why: "not-granted" },
      DIRS,
      CONNECT,
    )
    expect(config).not.toContain("192.168.1.2")
  })

  test("the broker's ProxyCommand is only in the last Host *, so a ProxyJump still wins", () => {
    const { config } = planLaneSsh(
      sources({ personal: "Host web\n  ProxyJump bastion" }),
      ON,
      DIRS,
      CONNECT,
    )
    const lines = config.split("\n")
    expect(lines.filter(l => l.includes("ProxyCommand"))).toEqual([
      `  ProxyCommand ${CONNECT} %n %p`,
    ])
    expect(config.indexOf("ProxyJump")).toBeLessThan(
      config.indexOf("ProxyCommand"),
    )
    expect(lines.at(-5)).toBe("Host *")
  })

  test("with no broker there is no ProxyCommand, and host keys are still checked", () => {
    const { config } = planLaneSsh(sources({}), ON, DIRS, null)
    expect(config).not.toContain("ProxyCommand")
    expect(config).toContain("StrictHostKeyChecking yes")
  })
})

describe("known hosts", () => {
  test("a hashed entry matches its own name only", () => {
    const entry = HASHED.split(" ")[0] ?? ""
    expect(hashedHostMatches(entry, ["pop.lan"])).toBe(true)
    expect(hashedHostMatches(entry, ["pop"])).toBe(false)
  })

  test("narrowed, a hashed line is kept for a concrete name and not for a wildcard", () => {
    const files = { service: null, personal: HASHED }
    expect(laneKnownHosts(files, ["pop.lan"]).text).toContain(KEY)
    expect(laneKnownHosts(files, ["*.lan"]).text).toBe("")
  })

  test("narrowed, personal identity may sign only for the person's kept keys", () => {
    const { facts } = laneKnownHosts(
      {
        service: "git.internal ssh-ed25519 AAAAgit",
        personal: "pop ssh-ed25519 AAAApop\nother ssh-ed25519 AAAAother",
      },
      ["pop"],
    )
    expect(facts.personal).toEqual(new Set(["AAAApop"]))
    expect(facts.names.get("AAAAgit")).toBe("git.internal")
  })

  test("a port's bracketed entry is named by its host", () => {
    const { facts } = laneKnownHosts(
      { service: null, personal: "[pop]:2222 ssh-ed25519 AAAApop" },
      ["pop"],
    )
    expect(facts.names.get("AAAApop")).toBe("pop")
  })

  test("not narrowed, both files are kept whole", () => {
    const { text, facts } = laneKnownHosts(
      { service: "a ssh-ed25519 AAAAa", personal: "b ssh-ed25519 AAAAb" },
      "all",
    )
    expect(text).toBe("a ssh-ed25519 AAAAa\nb ssh-ed25519 AAAAb\n")
    expect(facts.personal).toBe("all")
  })

  test("with personal identity off, the person's file is not read", () => {
    expect(
      laneKnownHosts({ service: null, personal: "b ssh-ed25519 AAAAb" }, null)
        .text,
    ).toBe("")
  })
})

test("a lane's personal IdentityFile keeps its own public key", () => {
  const { keys } = planLaneSsh(
    sources({
      personal: "Host pop\n  IdentityFile ~/.ssh/id_ed25519",
      pubs: new Map([["/home/d/.ssh/id_ed25519", ME_PUB]]),
    }),
    ON,
    DIRS,
    CONNECT,
  )
  expect([...keys.values()]).toEqual([ME_PUB])
})
