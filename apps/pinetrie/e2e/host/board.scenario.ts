// e2e/host/board — moving a root on the board (ADR-0122), archiving it in
// the archive (ADR-0029), and titling one (ADR-0045), through the
// command Line. What each decides is unit-tested (`@pinetrie/rules`'
// `board.test.ts`, `archive.test.ts` and `mark.test.ts`, the host's
// `commands/*.test.ts`); this proves the dispatcher routes each command to
// it, a new root lands where its chat says, and the records reach another
// client.

import { DISCARDED, entryId, ROOT, type TaskId } from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import type { Outcome } from "@pinetrie/protocol/codec"
import {
  readArchived,
  readMarks,
  readPlaces,
  readWorkflow,
} from "@pinetrie/reads"
import { newRootId, newTaskId, newThreadId } from "@pinetrie/session"
import type { Checks } from "../checks.ts"
import {
  archivedFor,
  boardStateOf,
  join,
  START_CHAT,
  taskHolding,
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
        await ada.chat("first root", ROOT, { ...START_CHAT, state: doing.id }),
      )
      const r2 = appended(await ada.chat("second root", ROOT, START_CHAT))
      // Each root's task, which its first message opened (ADR-0116).
      const idOf = (entry: string): TaskId | "" => {
        try {
          return taskHolding(host, entryId(entry))
        } catch {
          return ""
        }
      }
      await waitFor(() => idOf(r1) !== "" && idOf(r2) !== "", 10_000)
      const [id1, id2] = [
        taskHolding(host, entryId(r1)),
        taskHolding(host, entryId(r2)),
      ]
      const cards = readPlaces(host.places)
      const states = [boardStateOf(cards, id1), boardStateOf(cards, id2)]
      check(
        "a new root lands in the state its chat names, else the first open one",
        states[0] === doing.id && states[1] === backlog.id,
        JSON.stringify(states),
      )

      const closed = await ada.request({
        kind: "move-task",
        task: id1,
        from: doing.id,
        to: done.id,
        before: null,
      })
      const seen = await waitFor(() => archivedFor(bea).has(id1), 10_000)
      const refused = await bea.chat("too late", { kind: "entry", id: r1 })
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
        kind: "move-task",
        task: id1,
        from: doing.id,
        to: backlog.id,
        before: null,
      })
      const reopened = await bea.request({
        kind: "move-task",
        task: id1,
        from: done.id,
        to: backlog.id,
        before: null,
      })
      const accepted = await bea.chat("back again", { kind: "entry", id: r1 })
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

      const titled = await bea.mark(entryId(r2), "Tab names")
      const mark = readMarks(host.session).get(id2)
      check(
        "a task is titled, by its writer",
        titled.kind === "marked" &&
          mark?.title === "Tab names" &&
          mark.by === bea.writer,
        titled.kind,
      )
      // A task is a card (ADR-0126): a move on the board is its mover's,
      // undone by their undo key outside any task.
      const forward = await ada.request({
        kind: "move-task",
        task: id2,
        from: backlog.id,
        to: doing.id,
        before: null,
      })
      const back = await ada.undoMoves(null, "undo")
      check(
        "a move on the board is undone by its mover's undo key outside any task, the task back in its state",
        forward.kind === "moved" &&
          back.kind === "undone" &&
          boardStateOf(readPlaces(host.places), id2) === backlog.id,
        `${forward.kind} ${back.kind}`,
      )

      // A new tab closed unsent goes to its closer's trash with its task,
      // and the undo key outside any task brings both back.
      const tab = newThreadId()
      const tabTask = newTaskId()
      const opened = await ada.request({
        kind: "open-thread",
        thread: tab,
        root: newRootId(),
        task: tabTask,
        start: { kind: "new-task", state: null },
      })
      const shut = await ada.moveCard(
        { card: tab, from: { kind: "canvas", task: tabTask }, to: DISCARDED },
        undefined,
        null,
        tabTask,
      )
      const trashed = readPlaces(host.places).find(c => c.id === tabTask)?.place
      const undone = await ada.undoMoves(null, "undo")
      const now = readPlaces(host.places)
      check(
        "an unsent new tab closed is undone whole by its closer's undo key outside any task: its task and its thread back",
        opened.kind === "moved" &&
          shut.kind === "accepted" &&
          trashed?.kind === "trash" &&
          undone.kind === "undone" &&
          boardStateOf(now, tabTask) === backlog.id &&
          now.find(c => c.id === tab)?.place.kind === "canvas",
        `${opened.kind} ${shut.kind} ${trashed?.kind} ${undone.kind}`,
      )
      await Promise.all([ada.close(), bea.close()])
    },
  )
}
