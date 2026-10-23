import { describe, expect, test } from "vitest"
import {
  decodeSessions,
  EMPTY_REGISTRY,
  encodeSessions,
  nameFrom,
  planRename,
  planSession,
  type Registry,
  type SessionEntry,
  type SessionFacts,
  sessionWords,
} from "./sessions.ts"
import { sessionNameFor } from "./testing.ts"

const entry = (path: string, name: string, servedAt = 1): SessionEntry => ({
  path,
  name: sessionNameFor(name),
  servedAt,
})

const registry = (...entries: SessionEntry[]): Registry => ({
  version: 1,
  entries,
})

const facts = (over: Partial<SessionFacts> = {}): SessionFacts => ({
  path: "/w/website",
  asked: null,
  now: 100,
  gone: new Set(),
  ownHolds: null,
  served: new Map(),
  ...over,
})

describe("nameFrom", () => {
  test("spaces and case become a lowercase name with -", () => {
    expect(nameFrom("Client Site")).toBe("client-site")
  })

  test("each run of punctuation is one -, trimmed at the ends", () => {
    expect(nameFrom("--my.cool__app (2)!")).toBe("my-cool-app-2")
  })

  test("an accent in NFD names the same session as in NFC", () => {
    expect(nameFrom("Cafe\u0301")).toBe("café")
    expect(nameFrom("Caf\u00e9")).toBe("café")
  })

  test("a folder with no letter or digit is project", () => {
    expect(nameFrom("...")).toBe("project")
  })
})

describe("planSession", () => {
  const own = entry("/w/website", "website")

  test("a folder the registry holds is found, served now", () => {
    expect(planSession(registry(own), facts())).toEqual({
      kind: "found",
      entry: { ...own, servedAt: 100 },
      write: registry({ ...own, servedAt: 100 }),
    })
  })

  test("a folder asked for by its own session's name is found", () => {
    expect(planSession(registry(own), facts({ asked: "website" })).kind).toBe(
      "found",
    )
  })

  test("a folder with a session of its own is not attached to another", () => {
    const other = entry("/old/blog", "blog")
    expect(planSession(registry(own, other), facts({ asked: "blog" }))).toEqual(
      {
        kind: "refused",
        why: { kind: "has-own", asked: "blog", own: "website" },
      },
    )
  })

  test("a folder's own session that holds nothing is replaced by a gone one it is attached to", () => {
    const other = entry("/old/blog", "blog")
    expect(
      planSession(
        registry(own, other),
        facts({ asked: "blog", gone: new Set(["/old/blog"]) }),
      ),
    ).toEqual({
      kind: "attached",
      entry: entry("/w/website", "blog", 100),
      from: "/old/blog",
      dropped: "website",
      write: registry(entry("/w/website", "blog", 100)),
    })
  })

  test("a folder's own session that holds a file is not replaced", () => {
    const other = entry("/old/blog", "blog")
    expect(
      planSession(
        registry(own, other),
        facts({
          asked: "blog",
          gone: new Set(["/old/blog"]),
          ownHolds: "/c/sessions/website/pinetrie.json",
        }),
      ),
    ).toEqual({
      kind: "refused",
      why: {
        kind: "own-holds",
        asked: "blog",
        own: "website",
        file: "/c/sessions/website/pinetrie.json",
      },
    })
  })

  test("a PINETRIE_SESSION that is not a name is refused", () => {
    expect(planSession(registry(), facts({ asked: "Web Site" }))).toEqual({
      kind: "refused",
      why: { kind: "bad-name", asked: "Web Site" },
    })
  })

  test("a session whose folder is gone is attached to this one", () => {
    const old = entry("/old/website", "website")
    expect(
      planSession(
        registry(old),
        facts({ asked: "website", gone: new Set(["/old/website"]) }),
      ),
    ).toEqual({
      kind: "attached",
      entry: entry("/w/website", "website", 100),
      from: "/old/website",
      dropped: null,
      write: registry(entry("/w/website", "website", 100)),
    })
  })

  test("a session whose folder still exists is held", () => {
    const old = entry("/old/website", "website")
    expect(planSession(registry(old), facts({ asked: "website" }))).toEqual({
      kind: "refused",
      why: { kind: "held", asked: "website", path: "/old/website" },
    })
  })

  test("a name asked for that no session has is a new session's", () => {
    const plan = planSession(registry(), facts({ asked: "site" }))
    expect(plan).toEqual({
      kind: "new",
      entry: entry("/w/website", "site", 100),
      write: registry(entry("/w/website", "site", 100)),
    })
  })

  test("a new folder is named for its folder", () => {
    const plan = planSession(EMPTY_REGISTRY, facts({ path: "/w/Client Site" }))
    expect(plan.kind === "new" && plan.entry.name).toBe("client-site")
  })

  test("a new folder whose name is taken gets a two-word suffix", () => {
    const plan = planSession(
      registry(entry("/a/website", "website")),
      facts({ path: "/b/website" }),
    )
    const name = plan.kind === "new" ? plan.entry.name : ""
    expect(name).toMatch(/^website-[a-z]+-[a-z]+$/)
    expect(plan.kind === "new" && plan.write.entries.length).toBe(2)
  })

  test("a suffix that is taken too moves to the next pair", () => {
    const b = facts({ path: "/b/website" })
    const first = planSession(registry(entry("/a/website", "website")), b)
    const firstName = first.kind === "new" ? first.entry.name : ""
    const second = planSession(
      registry(entry("/a/website", "website"), entry("/c/website", firstName)),
      b,
    )
    const secondName = second.kind === "new" ? second.entry.name : ""
    expect(secondName).toMatch(/^website-[a-z]+-[a-z]+$/)
    expect(secondName).not.toBe(firstName)
  })

  test("a folder beside a gone session of its name is a new session, the gone one kept", () => {
    const gone = entry("/x/website", "website", 5)
    const plan = planSession(
      registry(gone),
      facts({ path: "/n/website", gone: new Set(["/x/website"]) }),
    )
    expect(plan.kind).toBe("new")
    expect(plan.kind === "new" && plan.entry.name).toMatch(
      /^website-[a-z]+-[a-z]+$/,
    )
    expect(plan.kind === "new" && plan.write.entries[0]).toEqual(gone)
  })
})

describe("planSession, with a session another host serves", () => {
  const own = entry("/w/website", "website")
  const name = own.name

  test("a folder whose session another host serves is refused, naming its pid", () => {
    expect(
      planSession(registry(own), facts({ served: new Map([[name, 42]]) })),
    ).toEqual({ kind: "refused", why: { kind: "served", name, pid: 42 } })
  })

  test("a served session whose holder wrote no pid is refused without one", () => {
    expect(
      planSession(registry(own), facts({ served: new Map([[name, null]]) })),
    ).toEqual({ kind: "refused", why: { kind: "served", name, pid: null } })
  })

  test("an attach that would drop a session another host serves is refused", () => {
    const old = entry("/old/site", "site")
    const plan = planSession(
      registry(own, old),
      facts({
        asked: "site",
        gone: new Set(["/old/site"]),
        served: new Map([[name, 7]]),
      }),
    )
    expect(plan).toEqual({
      kind: "refused",
      why: { kind: "served", name, pid: 7 },
    })
  })

  test("another session served refuses nothing here", () => {
    const other = entry("/w/blog", "blog")
    const served = new Map([[other.name, 7]])
    expect(planSession(registry(own, other), facts({ served })).kind).toBe(
      "found",
    )
  })
})

describe("sessionWords for a served session", () => {
  const name = entry("/w/website", "website").name

  test("names the holder's pid when it wrote one", () => {
    expect(sessionWords({ kind: "served", name, pid: 42 })).toContain(
      "by process 42",
    )
  })

  test("says no pid when it wrote none", () => {
    expect(sessionWords({ kind: "served", name, pid: null })).toBe(
      "session website is being served: stop its host first",
    )
  })
})

describe("planRename", () => {
  const reg = registry(entry("/w/website", "website"), entry("/w/blog", "blog"))

  test("a session renamed keeps its path under the new name", () => {
    expect(planRename(reg, "website", "site", null)).toEqual({
      kind: "renamed",
      from: "website",
      to: "site",
      write: registry(entry("/w/website", "site"), entry("/w/blog", "blog")),
    })
  })

  test("a rename of a session nobody has is refused", () => {
    expect(planRename(reg, "nope", "site", null)).toEqual({
      kind: "refused",
      why: { kind: "unknown", name: "nope" },
    })
  })

  test("a rename to text that is not a name is refused", () => {
    expect(planRename(reg, "website", "My Site", null)).toEqual({
      kind: "refused",
      why: { kind: "bad-name", asked: "My Site" },
    })
  })

  test("a rename to a name another session has is refused", () => {
    expect(planRename(reg, "website", "blog", null)).toEqual({
      kind: "refused",
      why: { kind: "taken", name: "blog" },
    })
  })

  test("a rename of a served session is refused", () => {
    expect(planRename(reg, "website", "site", { pid: 42 })).toEqual({
      kind: "refused",
      why: { kind: "served", name: "website", pid: 42 },
    })
  })
})

describe("decodeSessions", () => {
  test("a registry encoded decodes as itself", () => {
    const reg = registry(entry("/w/website", "website", 7))
    expect(decodeSessions(encodeSessions(reg))).toEqual(reg)
  })

  test("text that is not JSON is broken", () => {
    expect(decodeSessions("{")).toEqual({ broken: "not-json" })
  })

  test("a version this host does not know is broken", () => {
    expect(decodeSessions('{"version":2,"entries":[]}')).toEqual({
      broken: "unknown-version",
    })
  })

  test("two entries with one name are broken", () => {
    const text = encodeSessions(
      registry(entry("/a/website", "website"), entry("/b/website", "website")),
    )
    expect(decodeSessions(text)).toEqual({ broken: "not-a-registry" })
  })
})
