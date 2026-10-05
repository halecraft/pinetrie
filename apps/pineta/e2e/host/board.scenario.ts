// e2e/host/board — moving a root on the board (ADR-0085), archiving it in
// the closed state (ADR-0029), and titling one (ADR-0045), through the
// command Line. What each decides is unit-tested (`@pineta/rules`'
// `board.test.ts`, `archive.test.ts` and `mark.test.ts`, the host's
// `commands/*.test.ts`); this proves the dispatcher routes each command to
// it, a new root lands where its chat says, and the records reach another
// client.

import { entryId, ROOT, type RootId } from "@pineta/core"
import { scriptedModel } from "@pineta/pi"
import type { Outcome } from "@pineta/protocol/codec"
import {
  readArchived,
  readBoardPlaces,
  readMarks,
  readRoots,
  readWorkflow,
} from "@pineta/reads"
import type { Checks } from "../checks.ts"
import { join, rootRecordsOf, waitFor, withHost } from "../harness.ts"
import type { Scenario } from "../scenario.ts"
import { START_CHAT } from "./support.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

const appended = (o: Outcome) => (o.kind === "appended" ? o.id : entryId(""))

async function run(check: Checks["check"]): Promise<void> {
  await withHost(
    { model: { kind: "scripted", script: scriptedModel() }, log: () => {} },
    async host => {
      const ada = await join(host, "ada", "board")
      const bea = await join(host, "bea", "board")
      const workflow = readWorkflow(host.session)
      const [backlog, doing] = workflow?.open ?? []
      const done = workflow?.closed
      if (backlog === undefined || doing === undefined || done === undefined)
        throw new Error("a new host writes the default workflow")

      const r1 = appended(
        await ada.chat("first root", ROOT, { ...START_CHAT, state: doing.id }),
      )
      const r2 = appended(await ada.chat("second root", ROOT, START_CHAT))
      const idOf = (entry: string): RootId =>
        [...readRoots(host.session).values()].find(r => r.entry === entry)
          ?.root ?? ("" as RootId)
      await waitFor(() => idOf(r1) !== "" && idOf(r2) !== "", 10_000)
      const [id1, id2] = [idOf(r1), idOf(r2)]
      const places = readBoardPlaces(host.session)
      check(
        "a new root lands in the state its chat names, else the first open one",
        places.get(id1)?.state === doing.id &&
          places.get(id2)?.state === backlog.id,
        JSON.stringify([places.get(id1)?.state, places.get(id2)?.state]),
      )

      const closed = await ada.request({
        kind: "move-root",
        root: id1,
        from: doing.id,
        to: done.id,
        before: null,
      })
      const seen = await waitFor(
        () => readArchived(bea.session).has(id1),
        10_000,
      )
      const refused = await bea.chat("too late", { kind: "entry", id: r1 })
      check(
        "a root moved to Done is archived for another client, and a chat into it is refused naming the mover",
        closed.kind === "moved-root" &&
          readArchived(host.session).get(id1)?.by === ada.writer &&
          seen >= 0 &&
          refused.kind === "refused" &&
          refused.message.startsWith("archived by ada"),
        `${closed.kind} ${refused.kind}`,
      )

      const late = await bea.request({
        kind: "move-root",
        root: id1,
        from: doing.id,
        to: backlog.id,
        before: null,
      })
      const reopened = await bea.request({
        kind: "move-root",
        root: id1,
        from: done.id,
        to: backlog.id,
        before: null,
      })
      const accepted = await bea.chat("back again", { kind: "entry", id: r1 })
      check(
        "a move from a state the root has left is refused naming who moved it; moved out of Done, it takes writes again",
        late.kind === "refused" &&
          late.message === "not moved: ada moved it to Done first" &&
          reopened.kind === "moved-root" &&
          accepted.kind === "appended",
        `${late.kind} ${reopened.kind} ${accepted.kind}`,
      )

      const titled = await bea.mark(entryId(r2), "Tab names")
      const mark = rootRecordsOf(host, readMarks).get(r2)
      check(
        "a root is titled, by its writer",
        titled.kind === "marked" &&
          mark?.title === "Tab names" &&
          mark.by === bea.writer,
        titled.kind,
      )
      await Promise.all([ada.close(), bea.close()])
    },
  )
}
