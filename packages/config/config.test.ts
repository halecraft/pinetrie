import { describe, expect, test } from "vitest"
import {
  choice,
  configPlaces,
  count,
  decodeEnv,
  decodeLayer,
  decodeProject,
  defineTable,
  type FileRead,
  flag,
  hostCode,
  join,
  limited,
  list,
  pick,
  projectCopy,
  record,
  settle,
  text,
} from "./index.ts"
import type { AnySetting } from "./setting.ts"
import { configText, sessionNameFor, tableProblems } from "./testing.ts"

const absolute = text(
  s => (s.startsWith("/") ? s : null),
  "is not an absolute path",
)
const ref = text(s => (s.includes("/") ? s : null), "is not provider/id")

const TABLE = defineTable({
  "lanes.personal": limited(
    pick(flag(), {
      fallback: false,
      describe: "personal ssh",
      order: [{ project: "lane" }, "user", "local"],
    }),
    ["system"],
  ),
  "agents.budget": limited(
    pick(count({ min: 1 }), {
      fallback: 200,
      describe: "a budget",
      order: ["user", "local"],
    }),
    ["system"],
  ),
  model: pick(ref, {
    fallback: "none/none",
    describe: "the model",
    order: ["system", "user", { project: "accepted" }, "local", "env"],
    env: "TEST_MODEL",
  }),
  packages: join(hostCode(list(absolute)), {
    describe: "packages",
    layers: ["system", "user"],
  }),
  skills: join(list(text(s => s, "is not text")), {
    describe: "skills",
    layers: ["system", "user", { project: "accepted" }, "local"],
  }),
  "lanes.hosts": limited(
    pick(list(text(s => s, "is not text")), {
      fallback: [],
      describe: "hosts",
      order: ["user", "local"],
    }),
    ["system"],
  ),
  "icons.source": pick(choice(["built-in", "drawn", "none"]), {
    fallback: "built-in",
    describe: "icons",
    order: ["system", "user", "local"],
  }),
  "commands.names": join(record(text(s => s, "is not text")), {
    describe: "renames",
    layers: ["user"],
  }),
})

const textRead = (values: Record<string, unknown>): FileRead => ({
  kind: "text",
  text: configText(values),
})
const NO = { system: null, user: null, local: null, env: null, project: {} }

describe("a table", () => {
  test("a table that keeps every rule has no problems", () => {
    expect(tableProblems(TABLE)).toEqual([])
  })

  test("a key that is a prefix of another is refused when the table is defined", () => {
    expect(() =>
      defineTable({
        lanes: TABLE["lanes.personal"],
        "lanes.personal": TABLE["lanes.personal"],
      }),
    ).toThrow(/prefix/)
  })

  test("a host-code setting that admits the project is a problem", () => {
    const bad: AnySetting = {
      ...TABLE.packages,
      rule: { kind: "join", layers: ["user", { project: "accepted" }] },
    }
    expect(tableProblems({ packages: bad }).join("\n")).toMatch(
      /runs code on the host.*admits project/,
    )
  })
})

describe("decoding a layer", () => {
  test("a key no setting has is refused as unknown", () => {
    const layer = decodeLayer(TABLE, "user", "u.json", textRead({ zz: 1 }))
    expect(layer.refusals).toEqual([
      { layer: "user", file: "u.json", key: "zz", why: "unknown", detail: "" },
    ])
  })

  test("a key this layer may not set is refused, and not decoded", () => {
    const layer = decodeLayer(
      TABLE,
      "project",
      "p.json",
      textRead({ packages: ["/abs/x"] }),
    )
    expect(layer.refusals.map(r => [r.key, r.why])).toEqual([
      ["packages", "not-here"],
    ])
    expect(layer.values).toEqual({})
  })

  test("a value its kind refuses is malformed, with the kind's words", () => {
    const layer = decodeLayer(
      TABLE,
      "user",
      "u.json",
      textRead({ "agents.budget": 0 }),
    )
    expect(layer.refusals).toEqual([
      {
        layer: "user",
        file: "u.json",
        key: "agents.budget",
        why: "malformed",
        detail: "is not a whole number of at least 1",
      },
    ])
  })

  test("a value where settings live below is malformed unless it is an object", () => {
    const layer = decodeLayer(
      TABLE,
      "user",
      "u.json",
      textRead({ lanes: true }),
    )
    expect(layer.refusals.map(r => [r.key, r.why, r.detail])).toEqual([
      ["lanes", "malformed", "is not an object"],
    ])
  })

  test("a file that is not JSON is refused whole", () => {
    const layer = decodeLayer(TABLE, "user", "u.json", {
      kind: "text",
      text: "{ nope",
    })
    expect(layer.state).toBe("broken")
    expect(layer.refusals.map(r => [r.key, r.why])).toEqual([["", "broken"]])
  })

  test("a missing file is a layer with nothing in it, and no refusal", () => {
    const layer = decodeLayer(TABLE, "user", "u.json", { kind: "missing" })
    expect([layer.state, layer.refusals]).toEqual(["missing", []])
  })

  test("a variable's value its kind refuses is refused, naming the variable", () => {
    expect(decodeEnv(TABLE, { TEST_MODEL: "nope" }).refusals).toEqual([
      {
        layer: "env",
        file: "TEST_MODEL",
        key: "model",
        why: "malformed",
        detail: "is not provider/id",
      },
    ])
  })
})

describe("settling", () => {
  test("a pick's value says which file it came from", () => {
    const user = decodeLayer(
      TABLE,
      "user",
      "u.json",
      textRead({ model: "a/b" }),
    )
    const local = decodeLayer(
      TABLE,
      "local",
      "l.json",
      textRead({ model: "c/d" }),
    )
    expect(settle(TABLE, { ...NO, user, local }).settled.model).toEqual({
      value: "c/d",
      unlimited: "c/d",
      origins: [{ kind: "file", layer: "local", file: "l.json" }],
      limits: [],
    })
  })

  test("a variable beats every file, and names itself as the origin", () => {
    const user = decodeLayer(
      TABLE,
      "user",
      "u.json",
      textRead({ model: "a/b" }),
    )
    const env = decodeEnv(TABLE, { TEST_MODEL: "e/f" })
    expect(settle(TABLE, { ...NO, user, env }).settled.model.origins).toEqual([
      { kind: "env", name: "TEST_MODEL" },
    ])
  })

  test("a join holds every layer's entries, in layer order", () => {
    const user = decodeLayer(
      TABLE,
      "user",
      "u.json",
      textRead({ skills: ["b", "a"] }),
    )
    const accepted = decodeProject(
      TABLE,
      projectCopy("accepted", "p", textRead({ skills: ["a", "c"] })),
    )
    const settled = settle(TABLE, { ...NO, user, project: { accepted } })
    expect(settled.settled.skills.value).toEqual(["b", "a", "c"])
    expect(settled.settled.skills.origins.length).toBe(2)
  })

  test("a limit narrows, and says where it came from", () => {
    const system = decodeLayer(
      TABLE,
      "system",
      "s.json",
      textRead({ "agents.budget": 10 }),
    )
    const user = decodeLayer(
      TABLE,
      "user",
      "u.json",
      textRead({ "agents.budget": 50 }),
    )
    expect(
      settle(TABLE, { ...NO, system, user }).settled["agents.budget"],
    ).toEqual({
      value: 10,
      unlimited: 50,
      origins: [{ kind: "file", layer: "user", file: "u.json" }],
      limits: [{ kind: "file", layer: "system", file: "s.json" }],
    })
  })

  test("a system file's false turns a flag off for everyone", () => {
    const system = decodeLayer(
      TABLE,
      "system",
      "s.json",
      textRead({ "lanes.personal": false }),
    )
    const user = decodeLayer(
      TABLE,
      "user",
      "u.json",
      textRead({ "lanes.personal": true }),
    )
    expect(
      settle(TABLE, { ...NO, system, user }).settled["lanes.personal"].value,
    ).toBe(false)
  })

  test("a setting read from one copy of the project ignores another copy", () => {
    const accepted = decodeProject(
      TABLE,
      projectCopy("accepted", "p", textRead({ "lanes.personal": true })),
    )
    expect(
      settle(TABLE, { ...NO, project: { accepted } }).settled["lanes.personal"]
        .value,
    ).toBe(false)
  })

  test("the report carries every layer's refusals, each once", () => {
    const read = textRead({ zz: 1 })
    const working = decodeProject(TABLE, projectCopy("working", "p", read))
    const accepted = decodeProject(TABLE, projectCopy("accepted", "p", read))
    expect(
      settle(TABLE, { ...NO, project: { working, accepted } }).refusals.length,
    ).toBe(1)
  })
})

describe("places", () => {
  test("each place defaults under the home directory", () => {
    expect(configPlaces({}, "/home/ada", sessionNameFor("proj"))).toEqual({
      dirs: {
        config: "/home/ada/.config/pinetrie",
        data: "/home/ada/.local/share/pinetrie",
      },
      systemCandidates: ["/etc/xdg/pinetrie/pinetrie.json"],
      user: "/home/ada/.config/pinetrie/pinetrie.json",
      local: "/home/ada/.config/pinetrie/sessions/proj/pinetrie.json",
      credentials: "/home/ada/.local/share/pinetrie/auth.json",
      models: "/home/ada/.config/pinetrie/models.json",
    })
  })

  test("the XDG variables move each place, and a relative one is ignored", () => {
    const places = configPlaces(
      {
        XDG_CONFIG_HOME: "/c",
        XDG_DATA_HOME: "relative",
        XDG_CONFIG_DIRS: "/s1:rel:/s2",
      },
      "/home/ada",
      null,
    )
    expect([
      places.user,
      places.dirs.data,
      places.systemCandidates,
      places.local,
    ]).toEqual([
      "/c/pinetrie/pinetrie.json",
      "/home/ada/.local/share/pinetrie",
      ["/s1/pinetrie/pinetrie.json", "/s2/pinetrie/pinetrie.json"],
      null,
    ])
  })
})
