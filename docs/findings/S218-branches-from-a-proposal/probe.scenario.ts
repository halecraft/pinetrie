import { chmodSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
// A disposable probe: N agent branches started at once from one entry of an
// agent thread; N branches opened one after another; what a second person's
// copy holds of a branch opened and not sent. Run from
// apps/pinetrie/e2e/lanes/ as a scenario (`PINETRIE_SCENARIO`); PROBE_N sets
// N, and PROBE_FOLDER=1 serves a folder with no repo.

import {
  indexAsks,
  projectTranscript,
  ROOT,
  runOf,
  type ThreadId,
  threadEnd,
} from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import {
  readAccepted,
  readLaneRecords,
  readPlaces,
  readThreads,
} from "@pinetrie/reads"
import { canvasOf, yourCard } from "@pinetrie/rules"
import { newThreadId } from "@pinetrie/session"
import type { Checks } from "../checks.ts"
import {
  at,
  composeAt,
  join,
  START_AGENT,
  taskHolding,
  treeOf,
  waitFor,
} from "../harness.ts"
import { inLane, type LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => run(check, lanes),
}

function plainFolder(files: Readonly<Record<string, string>>): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pinetrie-folder-")))
  chmodSync(dir, 0o755)
  for (const [name, text] of Object.entries(files))
    writeFileSync(path.join(dir, name), text)
  return dir
}

const N = Number(process.env.PROBE_N ?? "5")

async function run(check: Checks["check"], lanes: LaneHosts): Promise<void> {
  const script = scriptedModel({
    answer: { reply: ctx => `done: ${(ctx.at(-1) ?? "").slice(0, 40)}` },
  })
  const folder = process.env.PROBE_FOLDER === "1"
  const section = await lanes.sectionHost({
    ...(folder
      ? { dir: plainFolder({ "a.txt": "base\n" }) }
      : { files: { "a.txt": "base\n" } }),
    model: { kind: "scripted", script },
  })
  const { user, idle, host, close } = section
  try {
    console.log("accepted kind", readAccepted(host.session)?.kind)
    // The parent: an agent run that writes a file, then lists the work.
    script.use([
      { tool: "write", args: { path: "parent.txt", content: "from parent\n" } },
      { text: "LIST: one, two, three" },
    ])
    await user.chat("@agent parent", ROOT, START_AGENT)
    await idle()
    const tree0 = treeOf(host)
    const parent = [...tree0.endOf.keys()][0] as ThreadId
    const parentEnd = threadEnd(tree0, parent)
    const said = projectTranscript(tree0, parentEnd)
    const writeCall = said.find(m => m.role === "assistant")
    const asks = indexAsks(tree0)
    const prompt =
      writeCall === undefined ? undefined : runOf(asks, writeCall.id)
    const last = prompt === undefined ? undefined : asks.last.get(prompt)
    console.log(
      "transcript",
      said.map(m => `${m.id} ${m.role}: ${m.text.slice(0, 40)}`),
    )
    check(
      "item 1: the run's last entry, found from its tool call's entry",
      last !== undefined && last === parentEnd,
      `prompt ${prompt} last ${last} end ${parentEnd}`,
    )
    if (last === undefined) throw new Error("no run end")

    // Item 1 again, after the thread moved on: a person's reply below.
    await user.chat("a reply after the run", at(last), { thread: parent })
    await idle()
    const tree1 = treeOf(host)
    const asks1 = indexAsks(tree1)
    check(
      "item 1: the run's last entry is unchanged after the thread moved on",
      prompt !== undefined &&
        asks1.last.get(prompt) === last &&
        threadEnd(tree1, parent) !== last,
      `${asks1.last.get(prompt ?? ("" as never))} vs end ${threadEnd(tree1, parent)}`,
    )

    // Items 3 and 4: N agent branches sent at once, at the run's last entry.
    const lanesBefore = new Set(readLaneRecords(host.session).keys())
    const ids = Array.from({ length: N }, () => newThreadId())
    const outcomes = await Promise.all(
      ids.map((thread, i) =>
        user.chat(`@agent brief ${i}`, at(last), { mode: "branch", thread }),
      ),
    )
    console.log(
      "outcomes",
      outcomes.map(o => o.kind),
      "sent order",
      ids,
    )
    await idle()
    const tree2 = treeOf(host)
    const laneRecords = readLaneRecords(host.session)
    const newLanes = ids.filter(t => laneRecords.has(t) && !lanesBefore.has(t))
    const answered = ids.filter(t => {
      const end = threadEnd(tree2, t)
      const tail = projectTranscript(tree2, end).at(-1)
      return tail?.role === "assistant" && tail.text.startsWith("done:")
    })
    check(
      "items 3, 4: every branch sent at once gets its own lane and its run answers",
      newLanes.length === N && answered.length === N,
      `${outcomes.map(o => o.kind).join(",")}; lanes ${newLanes.length}/${N}; answered ${answered.length}/${N}`,
    )
    const files = await Promise.all(
      ids.map(t => inLane(t, "cat parent.txt a.txt").catch(e => `ERR ${e}`)),
    )
    check(
      "item 4: every branch's lane holds the parent's files at the fork",
      files.every(f => f === "from parent\nbase\n"),
      JSON.stringify(files),
    )
    const parentFiles = await inLane(parent, "ls").catch(e => `ERR ${e}`)
    check(
      "item 4: the parent's lane is untouched",
      parentFiles.split("\n").filter(Boolean).sort().join() ===
        "a.txt,parent.txt",
      parentFiles,
    )

    // Item 2: three branches opened one after another at the same entry.
    const task = taskHolding(host, last)
    const opened = [newThreadId(), newThreadId(), newThreadId()]
    for (const thread of opened) {
      const o = await user.request({
        kind: "open-thread",
        thread,
        root: readThreads(host.session).get(parent)?.root as never,
        task,
        start: { kind: "branch", at: last },
      })
      if (o.kind === "refused") throw new Error(`open refused ${o.message}`)
    }
    await waitFor(
      () => opened.every(t => readPlaces(host.places).some(c => c.id === t)),
      5_000,
    )
    const canvas = canvasOf(readPlaces(host.places), task).map(c => c.id)
    const order = opened.map(t => canvas.indexOf(t))
    console.log(
      "canvas",
      canvas,
      "parent at",
      canvas.indexOf(parent),
      "opened at",
      order,
    )
    check(
      "item 2: branches opened one after another at one fork land just after the parent",
      order.every(i => i > canvas.indexOf(parent)),
      `parent ${canvas.indexOf(parent)}, opened ${order.join(",")}`,
    )

    // Item 5: the presser's client writes a draft in each opened thread, as
    // a column's composer does; the host sees each as theirs; two are sent.
    const drafts = await Promise.all(
      opened.map((lane, i) =>
        composeAt(user, { entry: last, lane }, `@agent draft ${i}`),
      ),
    )
    await waitFor(
      () => drafts.every(id => readPlaces(host.places).some(c => c.id === id)),
      10_000,
    )
    const hostCards = readPlaces(host.places)
    const yours = opened.map(
      t =>
        yourCard(
          user.writer,
          { kind: "thread", thread: t },
          hostCards,
          treeOf(host),
        )?.id,
    )
    check(
      "item 5: a draft the presser's client writes is their message in each opened thread",
      yours.every((id, i) => id === drafts[i]),
      `${yours.join(",")} vs ${drafts.join(",")}`,
    )
    const sent = await Promise.all(
      [0, 1].map(i =>
        user.chat(`@agent draft ${i}`, at(last), {
          mode: "branch",
          thread: opened[i],
          card: drafts[i] as never,
        }),
      ),
    )
    await idle()
    const tree3 = treeOf(host)
    const after = readPlaces(host.places)
    check(
      "item 5: sending two drafts starts those two, spends their cards, and leaves the third",
      sent.every(o => o.kind === "started") &&
        [0, 1].every(i => tree3.firstOf.has(opened[i] as ThreadId)) &&
        !tree3.firstOf.has(opened[2] as ThreadId) &&
        !after.some(c => c.id === drafts[0] || c.id === drafts[1]) &&
        after.some(c => c.id === drafts[2]),
      `${sent.map(o => o.kind).join(",")}`,
    )

    // Item 6: a second person's copy of the places and threads.
    const bea = await join(host, "bea", `branch-probe-${process.pid}`)
    try {
      await bea.placesSettled()
      await waitFor(
        () => opened.every(t => bea.cards.current().some(c => c.id === t)),
        10_000,
      ).catch(() => {})
      const beaCards = bea.cards.current()
      const seen = opened.filter(t => {
        const c = beaCards.find(x => x.id === t)
        return c?.place.kind === "canvas" && c.place.task === task
      })
      const beaThreads = readThreads(bea.session)
      check(
        "item 6: a branch opened and not sent is on the canvas in another person's copy",
        seen.length === opened.length &&
          opened.every(t => beaThreads.get(t)?.by !== undefined),
        `seen ${seen.length}/${opened.length}; by ${opened.map(t => beaThreads.get(t)?.by).join(",")}`,
      )
    } finally {
      await bea.close().catch(() => {})
    }
  } finally {
    await close()
  }
}
