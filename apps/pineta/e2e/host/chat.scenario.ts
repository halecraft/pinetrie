// e2e/host/chat — one host and its clients over real websockets: a first turn
// on pi's agent, its reply streamed to the clients, and a conversation the
// agent is asked into, which it reads with every speaker named. Which thread
// a message joins, who it is for, and when a lane is busy are decided by
// pure functions and unit-tested (`@pineta/marginalia`'s `chat.test.ts`,
// `@pineta/core`, the host's `commands/chat.test.ts`, `queue.test.ts`).

import { subscribe } from "@kyneta/schema"
import { type EntryId, projectTranscript, ROOT } from "@pineta/core"
import { readPlaces } from "@pineta/reads"
import { readStreams } from "@pineta/schema"
import type { Checks } from "../checks.ts"
import {
  idleNow,
  join,
  lanesOf,
  suiteModel,
  treeOf,
  waitFor,
  withHost,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"
import { at, START_AGENT, START_CHAT } from "./support.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  const script = suiteModel()
  await withHost(
    { model: { kind: "scripted", script }, log: () => {} },
    async host => {
      const tree = () => treeOf(host)
      const idle = () => waitFor(() => idleNow(host), 60_000)
      /** The path to `tip`, as "role:text" (chat as "Name:text"). */
      const shape = (tip: EntryId | null) =>
        projectTranscript(tree(), tip).map(m =>
          m.role === "chat" ? `${m.author}:${m.text}` : m.role,
        )

      // Every reply stream's text at each change of the host's document, so
      // growth is seen however many changes a client's sync folds together.
      const samples: string[] = []
      const unsample = subscribe(host.live, () => {
        for (const s of readStreams(host.live))
          if (s.kind === "reply") samples.push(s.text)
      })
      const client = await join(host, "e2e-client", "chat")
      await client.chat("hello", ROOT, START_AGENT)
      await idle()
      unsample()
      const lane = lanesOf(host, tree(), readPlaces(host.places))[0]
      const first = shape(lane?.tip ?? null)
      check(
        "the thread reads the message, then the agent's reply",
        first.length === 2 &&
          first[0]?.endsWith(":hello") &&
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
      const alice = await join(host, "alice", "chat")
      const bob = await join(host, "bob", "chat")
      await Promise.all([alice.setName("Alice"), bob.setName("Bob")])
      const plum = await alice.chat("the secret word is PLUM", ROOT, START_CHAT)
      const one = await bob.chat(
        "one",
        at(plum.kind === "appended" ? plum.id : null),
      )
      script.use([{ reply: context => context.slice(0, -1).join("\n") }])
      await bob.chat(
        "@agent who told us a secret word?",
        at(one.kind === "appended" ? one.id : null),
      )
      await idle()
      const asked = lanesOf(host, tree(), readPlaces(host.places)).find(l =>
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
}
