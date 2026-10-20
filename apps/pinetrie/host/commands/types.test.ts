// What the types make impossible to write. Each `@ts-expect-error` fails
// `pnpm run typecheck` if the line below it ever compiles.

import { type CardId, type Send, threadIdFor, writerId } from "@pinetrie/core"
import {
  type CardPlan,
  type PlaceStep,
  planSendMessage,
  planUndoAnswer,
} from "@pinetrie/rules"
import { expect, test } from "vitest"
import { ROOT_ID } from "../fakes.ts"
import { type SendDeps, sendMessage } from "./send.ts"

test("a send the gate did not clear does not compile", () => {
  const unchecked: Send = {
    kind: "send",
    text: "x",
    root: ROOT_ID,
    at: { kind: "queue", thread: threadIdFor("t") },
    mentions: [],
    card: null,
    pinned: [],
    base: null,
    state: null,
  }
  const deps = {} as SendDeps
  const call = () =>
    // @ts-expect-error: only `planGate` makes the `Cleared<Send>` it takes
    sendMessage(deps, writerId("ada@x.io"), "s-1", unchecked)
  expect(call).toBeTypeOf("function")
})

test("a card plan built in the shell does not compile", () => {
  const build = (): CardPlan => ({
    kind: "steps",
    // @ts-expect-error: only a plan in `card-commands.ts` stamps `Planned` lists
    before: [],
    // @ts-expect-error: only a plan in `card-commands.ts` stamps `Planned` lists
    steps: [],
    drain: [],
    history: null,
    // @ts-expect-error: only a plan in `card-commands.ts` stamps `Planned` lists
    after: [],
    names: false,
  })
  expect(build).toBeTypeOf("function")
})

test("a card plan's steps with one more step do not compile", () => {
  const edit = (
    plan: Extract<CardPlan, { kind: "steps" }>,
    extra: PlaceStep,
  ): CardPlan => ({
    ...plan,
    // @ts-expect-error: a new list is unbranded, so the shell cannot add a step
    steps: [...plan.steps, extra],
  })
  expect(edit).toBeTypeOf("function")
})

test("an undo's answer for a revert no plan let through does not compile", () => {
  const answer = (cards: readonly CardId[]) =>
    planUndoAnswer(
      // @ts-expect-error: only `planUndo` makes the `UndoRevert` it takes
      { kind: "revert", cards, lift: [], placesId: "places" },
      { kind: "none" },
      [],
    )
  expect(answer).toBeTypeOf("function")
})

test("a send planned from a reach no plan made does not compile", () => {
  const plan = (facts: Parameters<typeof planSendMessage>[0]) =>
    planSendMessage({
      ...facts,
      // @ts-expect-error: only `planSendReach` makes the `SendReach` it takes
      reach: {
        kind: "reach",
        thread: facts.reach.thread,
        mode: facts.reach.mode,
        recorded: facts.reach.recorded,
        command: facts.reach.command,
        named: facts.reach.named,
      },
    })
  expect(plan).toBeTypeOf("function")
})
