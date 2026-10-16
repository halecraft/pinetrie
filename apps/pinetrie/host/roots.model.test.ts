// Every short sequence of what can happen to the roots' store, each lemma
// checked after every event (`roots.ts`): L1 inside each step, L2 and the
// upkeep's guard after each event, L3 after each wait for the keeper.

import { rootDocId, rootIdFor } from "@pinetrie/core"
import { readRootRecord } from "@pinetrie/reads"
import { ROOT, setRecord } from "@pinetrie/rules"
import { applyRecordWrites, RootDoc } from "@pinetrie/schema"
import { newRootDoc } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { handPeers, hostRoots } from "./fakes.ts"
import type { Lease } from "./roots.ts"

const [A, B] = [
  rootIdFor("01a0ffd2-0000-7000-8000-0000000000aa"),
  rootIdFor("01a0ffd2-0000-7000-8000-0000000000bb"),
]

type Event =
  | { readonly kind: "step"; readonly root: typeof A }
  | { readonly kind: "lease"; readonly root: typeof A }
  | { readonly kind: "release" }
  | { readonly kind: "ask" }
  | { readonly kind: "synced" }
  | { readonly kind: "drop" }
  | { readonly kind: "idle" }

const EVENTS: readonly Event[] = [
  { kind: "step", root: A },
  { kind: "step", root: B },
  { kind: "lease", root: A },
  { kind: "release" },
  { kind: "ask" },
  { kind: "synced" },
  { kind: "drop" },
  { kind: "idle" },
]

/** Every sequence of `EVENTS` of length 1 to `most`. */
function sequences(most: number): readonly (readonly Event[])[] {
  const out: Event[][] = []
  let level: Event[][] = [[]]
  for (let n = 1; n <= most; n++) {
    level = level.flatMap(s => EVENTS.map(e => [...s, e]))
    out.push(...level)
  }
  return out
}

/** Let Kyneta's and the store's microtasks and timers run. */
const settle = () => new Promise(r => setTimeout(r, 0))

async function run(events: readonly Event[]): Promise<readonly string[]> {
  const peers = handPeers()
  const { exchange, keeper, roots, session } = hostRoots({ peers })
  // The directory names A: a tab asks only for a root that has started.
  applyRecordWrites(session, [setRecord(ROOT, readRootRecord(A, newRootDoc()))])
  const mode = (root: typeof A) =>
    exchange.documents.get(rootDocId(root))?.mode ?? "absent"
  const leases: Lease[] = []
  /** A tab holds A: it asked for it, and has it or is taking it. */
  let shown = false
  const broken: string[] = []
  const say = (lemma: string, at: number) =>
    broken.push(`${lemma} after ${JSON.stringify(events.slice(0, at + 1))}`)
  for (const [at, event] of events.entries()) {
    switch (event.kind) {
      case "step":
        await keeper.run(async step => {
          await step.root(event.root)
          await settle()
          if (mode(event.root) !== "interpret") say("L1", at)
        })
        break
      case "lease":
        leases.push(await keeper.run(async step => step.lease(event.root)))
        break
      case "release":
        await leases.shift()?.[Symbol.asyncDispose]()
        break
      case "ask": {
        // A tab asks for A: Kyneta loads it behind the store's back, and
        // the tab is taking it.
        const doc = exchange.get(rootDocId(A), RootDoc)
        peers.set(doc, "pending")
        shown = true
        break
      }
      case "synced":
        if (shown) peers.set(exchange.get(rootDocId(A), RootDoc), "synced")
        break
      case "drop":
        // The tab lets A go: the host hears its copy destroyed.
        if (shown) {
          peers.set(exchange.get(rootDocId(A), RootDoc), "none")
          shown = false
        }
        break
      case "idle":
        await keeper.idle()
        break
    }
    await settle()
    for (const lease of leases)
      if (mode(lease.root) !== "interpret") say("L2", at)
    if (shown && mode(A) !== "interpret") say("the upkeep's guard", at)
    if (event.kind === "idle" && leases.length === 0 && !shown) {
      await keeper.idle()
      if (
        roots.loaded().length > 0 ||
        [A, B].some(r => mode(r) === "interpret")
      )
        say("L3", at)
    }
  }
  for (const lease of leases) await lease[Symbol.asyncDispose]()
  roots.close()
  return broken
}

test("every sequence of three events keeps L1, L2, L3 and the upkeep's guard", async () => {
  const all = sequences(3)
  expect(all).toHaveLength(8 + 8 ** 2 + 8 ** 3)
  const broken: string[] = []
  for (const events of all) broken.push(...(await run(events)))
  expect(broken).toEqual([])
}, 120_000)
