// e2e/host/board — moving a root on the board, archiving it in the archive,
// titling one, and an agent's first run moving its canvas to Active, through
// the command Line. What each decides is unit-tested
// (`@pinetrie/rules`' `board.test.ts`, `archive.test.ts` and `mark.test.ts`,
// the host's `commands/*.test.ts`); this proves the dispatcher routes each
// command to it, a new root lands where its chat says, and the records reach
// another client.

import { type CanvasId, entryId, ROOT } from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readArchived,
  readCardHistories,
  readMarks,
  readPlaces,
  readWorkflow,
} from "@pinetrie/reads"
import { newCanvasId, newRootId, newThreadId } from "@pinetrie/session/connect"
import { TRASH_PLACE, threadEnd } from "@pinetrie/threads"
import type { Checks } from "../checks.ts"
import {
  archivedFor,
  at,
  canvasHolding,
  heldTree,
  join,
  START_AGENT,
  START_CHAT,
  taskBoardState,
  untilSent,
  waitFor,
  withHost,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"

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
      const done = workflow?.archive
      if (backlog === undefined || doing === undefined || done === undefined)
        throw new Error("a new host writes the default workflow")

      const r1 = appended(
        await ada.send("first root", ROOT, { ...START_CHAT, state: doing.id }),
      )
      const r2 = appended(await ada.send("second root", ROOT, START_CHAT))
      // Each root's canvas, which its first message opened.
      const idOf = (entry: string): CanvasId | "" => {
        try {
          return canvasHolding(host, entryId(entry))
        } catch {
          return ""
        }
      }
      await waitFor(() => idOf(r1) !== "" && idOf(r2) !== "", 10_000)
      const [id1, id2] = [
        canvasHolding(host, entryId(r1)),
        canvasHolding(host, entryId(r2)),
      ]
      const cards = readPlaces(host.places)
      const states = [taskBoardState(cards, id1), taskBoardState(cards, id2)]
      check(
        "a new root lands in the state its chat names, else Topics",
        states[0] === doing.id && states[1] === backlog.id,
        JSON.stringify(states),
      )

      const closed = await ada.request({
        kind: "move-canvas",
        canvas: id1,
        from: doing.id,
        to: done.id,
        before: null,
      })
      const seen = await waitFor(() => archivedFor(bea).has(id1), 10_000)
      const refused = await bea.send("too late", { kind: "entry", id: r1 })
      check(
        "a root moved to Done is archived for another client, and a chat into it is refused naming the mover",
        closed.kind === "moved" &&
          readArchived(host.session, host.places).get(id1)?.by === ada.writer &&
          seen >= 0 &&
          refused.kind === "refused" &&
          refused.message.startsWith("archived by ada"),
        `${closed.kind} ${refused.kind}`,
      )

      const late = await bea.request({
        kind: "move-canvas",
        canvas: id1,
        from: doing.id,
        to: backlog.id,
        before: null,
      })
      const reopened = await bea.request({
        kind: "move-canvas",
        canvas: id1,
        from: done.id,
        to: backlog.id,
        before: null,
      })
      const accepted = await bea.send("back again", { kind: "entry", id: r1 })
      check(
        "a move from a state the root has left is refused naming who moved it; moved out of Done, it takes writes again",
        late.kind === "unmoved" &&
          late.code === "moved" &&
          late.by === ada.writer &&
          late.place?.kind === "board" &&
          late.place.state === done.id &&
          reopened.kind === "moved" &&
          accepted.kind === "appended",
        `${late.kind} ${reopened.kind} ${accepted.kind}`,
      )

      // While a tab holds a root the host keeps it loaded: let go, the tab
      // asks again, and the host would load it again with no end.
      await host.quiet()
      const heldWhileShown = host.rootsLoaded().length

      const titled = await bea.mark(entryId(r2), "Tab names")
      const mark = readMarks(host.session).get(id2)
      check(
        "a canvas is titled, by its writer",
        titled.kind === "marked" &&
          mark?.title === "Tab names" &&
          mark.by === bea.writer,
        titled.kind,
      )
      // A canvas is a card: a move on the board is its mover's,
      // undone by their undo key outside any canvas.
      const forward = await ada.request({
        kind: "move-canvas",
        canvas: id2,
        from: backlog.id,
        to: doing.id,
        before: null,
      })
      const back = await ada.undoMoves(null, "undo")
      check(
        "a move on the board is undone by its mover's undo key outside any canvas, the canvas back in its state",
        forward.kind === "moved" &&
          back.kind === "undone" &&
          taskBoardState(readPlaces(host.places), id2) === backlog.id,
        `${forward.kind} ${back.kind}`,
      )

      // An agent's first run moves its new canvas from Topics to Active, as
      // the host's own move; moved back by a person, it stays.
      const canvasesNow = () =>
        new Set(
          readPlaces(host.places).flatMap(c =>
            c.kind === "canvas" ? [c.id] : [],
          ),
        )
      const before = canvasesNow()
      await untilSent(
        host,
        await ada.send("@agent start the work", ROOT, START_AGENT),
        60_000,
      )
      const worked = [...canvasesNow()].find(c => !before.has(c))
      const [thread] = readPlaces(host.places).flatMap(c =>
        c.kind === "thread" &&
        c.place.kind === "canvas" &&
        c.place.canvas === worked
          ? [c.id]
          : [],
      )
      if (worked === undefined || thread === undefined)
        throw new Error("an agent's first send opens a canvas")
      const firstState = taskBoardState(readPlaces(host.places), worked)
      const byHost =
        readCardHistories(host.session).get(worked)?.events.at(-1)?.by === null
      const putBack = await ada.request({
        kind: "move-canvas",
        canvas: worked,
        from: doing.id,
        to: backlog.id,
        before: null,
      })
      await untilSent(
        host,
        await ada.send("@agent go on", at(threadEnd(heldTree(host), thread)), {
          thread,
        }),
        60_000,
      )
      check(
        "an agent's first run moves its canvas from Topics to Active, and a person's move back keeps it there",
        firstState === doing.id &&
          byHost &&
          putBack.kind === "moved" &&
          taskBoardState(readPlaces(host.places), worked) === backlog.id,
        `${firstState} ${byHost} ${putBack.kind}`,
      )

      // A new tab closed unsent goes to its closer's trash with its canvas,
      // and the undo key outside any canvas brings both back.
      const tab = newThreadId()
      const tabCanvas = newCanvasId()
      const opened = await ada.request({
        kind: "open-thread",
        thread: tab,
        root: newRootId(),
        canvas: tabCanvas,
        start: { kind: "new-canvas", state: null },
      })
      const shut = await ada.moveCard(
        {
          card: tab,
          from: { kind: "canvas", canvas: tabCanvas },
          to: TRASH_PLACE,
        },
        undefined,
        null,
        tabCanvas,
      )
      const trashed = readPlaces(host.places).find(
        c => c.id === tabCanvas,
      )?.place
      const undone = await ada.undoMoves(null, "undo")
      const now = readPlaces(host.places)
      check(
        "an unsent new canvas closed is undone whole by its closer's undo key outside any canvas: its canvas and its thread back",
        opened.kind === "moved" &&
          shut.kind === "accepted" &&
          trashed?.kind === "trash" &&
          undone.kind === "undone" &&
          taskBoardState(now, tabCanvas) === backlog.id &&
          now.find(c => c.id === tab)?.place.kind === "canvas",
        `${opened.kind} ${shut.kind} ${trashed?.kind} ${undone.kind}`,
      )
      await Promise.all([ada.close(), bea.close()])
      // No tab holds a root now: the next upkeep lets every one go.
      await waitFor(async () => {
        await host.quiet()
        return host.rootsLoaded().length === 0
      }, 10_000)
      check(
        "a root is loaded while a tab holds it, and let go once none does and the host is quiet",
        heldWhileShown > 0 && host.rootsLoaded().length === 0,
        `${heldWhileShown} loaded while shown · ${host.rootsLoaded().length} after`,
      )
    },
  )
}
