// What the types make impossible to write. Each `@ts-expect-error` fails
// `pnpm run typecheck` if the line below it ever compiles.

import { expect, test } from "vitest"
import {
  choice,
  configPlaces,
  decodeLayer,
  decodeProject,
  defineTable,
  flag,
  hostCode,
  join,
  limited,
  list,
  pick,
  projectCopy,
  settle,
  text,
} from "./index.ts"

const path = list(text(s => s, "is not text"))
const MISSING = { kind: "missing" } as const

test("a limit on a kind with no meet does not compile", () => {
  const icons = pick(choice(["a", "b"]), {
    fallback: "a",
    describe: "x",
    order: ["user"],
  })
  // @ts-expect-error: a choice has no meet, so it cannot be limited
  expect(() => limited(icons, ["system"])).toThrow()
})

test("a host-code setting that names a project or local layer does not compile", () => {
  expect(() => [
    join(hostCode(path), {
      describe: "x",
      // @ts-expect-error: host code may come only from system and user
      layers: ["user", { project: "accepted" }],
    }),
    pick(hostCode(flag()), {
      fallback: false,
      describe: "x",
      // @ts-expect-error: host code may come only from system and user
      order: ["local"],
    }),
  ]).not.toThrow()
})

test("a join on a kind that cannot add does not compile", () => {
  const cannotAdd = choice(["a"])
  expect(() =>
    // @ts-expect-error: a choice has no join
    join(cannotAdd, { describe: "x", layers: ["user"] }),
  ).toThrow()
})

const TABLE = defineTable({
  model: pick(
    text(s => s, "x"),
    {
      fallback: "",
      describe: "x",
      order: ["user", { project: "accepted" }],
    },
  ),
  names: pick(
    text(s => s, "x"),
    {
      fallback: "",
      describe: "x",
      order: ["user", { project: "working" }],
    },
  ),
})

test("one layer's values handed in as another's do not compile", () => {
  const project = decodeLayer(TABLE, "project", "p", MISSING)
  const working = decodeProject(TABLE, projectCopy("working", "p", MISSING))
  const none = { system: null, local: null, env: null }
  expect(() => [
    // @ts-expect-error: the project layer's values are not the user's
    settle(TABLE, { ...none, user: project, project: {} }),
    // @ts-expect-error: the working copy is not accepted work's
    settle(TABLE, { ...none, user: null, project: { accepted: working } }),
  ]).not.toThrow()
})

test("a folder's name handed in as a session's does not compile", () => {
  expect(
    // @ts-expect-error: only the registry's plans make a session's name
    configPlaces({}, "/home/ada", "website").local,
  ).toBe("/home/ada/.config/pinetrie/sessions/website/pinetrie.json")
})
