// e2e/host/send — one host and its clients over real websockets: a first turn
// on pi's agent, its reply streamed to the clients, and a conversation the
// agent is asked into, which it reads with every speaker named. Which thread
// a message joins, who it is for, and when a lane is busy are decided by
// pure functions and unit-tested (`@pinetrie/rules`' `chat.test.ts`,
// `@pinetrie/core`, the host's `commands/send.test.ts`, `queue.test.ts`).
// Last, a host whose config names no model starts, and says why.

import { subscribe } from "@kyneta/schema"
import { type EntryId, ROOT } from "@pinetrie/core"
import { readPlaces, readSetup } from "@pinetrie/reads"
import { readStreams } from "@pinetrie/schema"
import { projectTranscript } from "@pinetrie/threads"
import type { Checks } from "../checks.ts"
import {
  at,
  heldLanes,
  heldTree,
  join,
  START_AGENT,
  START_CHAT,
  suiteModel,
  untilSent,
  waitFor,
  withHost,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  const script = suiteModel()
  await withHost(
    { model: { kind: "scripted", script }, log: () => {} },
    async host => {
      const tree = () => heldTree(host)
      /** The path to `tip`, as "role:text" (chat as "Name:text"). */
      const shape = (tip: EntryId | null) =>
        projectTranscript(tree(), tip).map(m =>
          m.role === "person" ? `${m.author}:${m.text}` : m.role,
        )

      // Every reply stream's text at each change of the host's document, so
      // growth is seen however many changes a client's sync folds together.
      const samples: string[] = []
      const unsample = subscribe(host.live, () => {
        for (const s of readStreams(host.live))
          if (s.kind === "reply") samples.push(s.text)
      })
      const client = await join(host, "e2e-client", "send")
      await untilSent(
        host,
        await client.send("@agent hello", ROOT, START_AGENT),
        60_000,
      )
      unsample()
      const lane = heldLanes(host, tree(), readPlaces(host.places))[0]
      const first = shape(lane?.tip ?? null)
      check(
        "the thread reads the message, then the agent's reply",
        first.length === 2 &&
          first[0]?.endsWith(":@agent hello") &&
          first[1] === "assistant",
        first.join(" | "),
      )
      check(
        "the client saw live streaming updates",
        new Set(samples).size > 1,
        `${samples.length}`,
      )

      // A conversation, then @agent in it: the run reads every speaker,
      // attributed. The reply echoes what the model was given before the
      // prompt.
      const alice = await join(host, "alice", "send")
      const bob = await join(host, "bob", "send")
      await Promise.all([
        alice.request({ kind: "name", name: "Alice" }),
        bob.request({ kind: "name", name: "Bob" }),
      ])
      const plum = await alice.send("the secret word is PLUM", ROOT, START_CHAT)
      const one = await bob.send(
        "one",
        at(plum.kind === "appended" ? plum.id : null),
      )
      script.use([{ reply: context => context.slice(0, -1).join("\n") }])
      await untilSent(
        host,
        await bob.send(
          "@agent who told us a secret word?",
          at(one.kind === "appended" ? one.id : null),
        ),
        60_000,
      )
      const asked = heldLanes(host, tree(), readPlaces(host.places)).find(l =>
        projectTranscript(tree(), l.tip).some(m =>
          m.text.includes("who told us"),
        ),
      )
      const given =
        projectTranscript(tree(), asked?.tip ?? null).at(-1)?.text ?? ""
      check(
        "the agent is given every speaker's messages, attributed",
        given.includes("Alice: the secret word is PLUM") &&
          given.includes("Bob: one"),
      )
      await Promise.all([client.close(), alice.close(), bob.close()])
    },
  )

  // A host whose config names no model: it starts all the same, and its
  // setup record says why it has none, for the page and the composer.
  await withHost(
    { model: { kind: "configured" }, log: () => {} },
    async host => {
      await waitFor(() => readSetup(host.session) !== null, 10_000)
      const model = readSetup(host.session)?.model
      check(
        "a host with no model starts, and its setup record says why",
        model?.kind === "none" && model.why === "unset",
      )
    },
  )
}
