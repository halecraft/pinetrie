import {
  type AgentCandidate,
  type ThreadId,
  type ThreadName,
  writerId,
} from "@pinetrie/core"
import { expect, test } from "vitest"
import { mentionCompletion } from "./mentions.ts"

const agent = (name: string, member = false): AgentCandidate => ({
  thread: `t-${name}` as ThreadId,
  name: name as ThreadName,
  member,
})
const agents = [agent("amber-fox"), agent("slate-owl", true)]
const participants = ["Ada Lovelace", "Bea", "cy"]
const reader = (email: string, name?: string) => ({
  me: writerId(email),
  nameOf: new Map(name === undefined ? [] : [[writerId(email), name]]),
})
const someone = reader("zed@example.com")

/** The labels offered with the caret at the text's end, or at `|`. */
const offered = (typed: string, as = someone) => {
  const caret = typed.includes("|") ? typed.indexOf("|") : typed.length
  return (
    mentionCompletion({
      text: typed.replace("|", ""),
      caret,
      participants,
      agents,
      reader: as,
    })?.options.map(o => o.label) ?? null
  )
}

test("a bare @ offers the agent, members, people, then other threads", () => {
  expect(offered("hi @")).toEqual([
    "@agent",
    "@slate-owl",
    "@adalovelace",
    "@bea",
    "@cy",
    "@amber-fox",
  ])
})

test("a handle starting with what is typed comes before one holding it", () => {
  // `a` starts `agent`, `adalovelace` and `amber-fox`, and is in `slate-owl` and `bea`.
  expect(offered("@a")).toEqual([
    "@agent",
    "@adalovelace",
    "@amber-fox",
    "@slate-owl",
    "@bea",
  ])
  expect(offered("@ox")).toEqual(["@amber-fox"])
})

test("you are not offered, by your name or your e-mail's", () => {
  expect(offered("@b", reader("b@x", "Bea"))).toEqual(["@amber-fox"])
  expect(offered("@c", reader("cy@example.com"))).toEqual(["@adalovelace"])
})

test("nothing outside a mention, in code, or past a whole handle", () => {
  expect(offered("hi")).toBeNull()
  expect(offered("|@a")).toBeNull()
  expect(offered("ada@ex")).toBeNull()
  expect(offered("`@a`|")).toBeNull()
  expect(offered("see `@a|`")).toBeNull()
  expect(offered("@bea")).toBeNull()
  expect(offered("@zz")).toBeNull()
})

test("the caret inside a handle offers by what precedes it, and replaces it whole", () => {
  const list = mentionCompletion({
    text: "ask @amb please",
    caret: 7,
    participants,
    agents,
    reader: someone,
  })
  expect(list?.start).toBe(4)
  expect(list?.end).toBe(8)
  expect(list?.options.map(o => o.label)).toEqual(["@amber-fox"])
})

test("a chosen handle is followed by a space unless one is there", () => {
  const insert = (text: string) =>
    mentionCompletion({ text, caret: 3, participants, agents, reader: someone })
      ?.options[0]?.insert
  expect(insert("@am")).toBe("@amber-fox ")
  expect(insert("@am now")).toBe("@amber-fox")
})

test("an option says whose it is", () => {
  const said = (typed: string) =>
    mentionCompletion({
      text: typed,
      caret: typed.length,
      participants,
      agents,
      reader: someone,
    })?.options.map(o => o.description)
  expect(said("@ag")).toEqual(["this thread's agent"])
  expect(said("@lov")).toEqual(["Ada Lovelace"])
  expect(said("@slate")).toEqual(["member"])
  expect(said("@amber")).toEqual(["another thread's agent"])
})

test("two people with one handle are offered once", () => {
  const list = mentionCompletion({
    text: "@b",
    caret: 2,
    participants: ["B.ea", "Bea", "bea"],
    agents: [],
    reader: someone,
  })
  expect(list?.options.map(o => o.label)).toEqual(["@bea"])
})
