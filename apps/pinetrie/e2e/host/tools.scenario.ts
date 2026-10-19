// e2e/host/tools — the agent reads, writes, edits and runs, visibly.

import { randomBytes } from "node:crypto"
import { existsSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Store } from "@kyneta/exchange"
import { subscribe } from "@kyneta/schema"
import {
  indexAsks,
  projectSpine,
  ROOT,
  rootDocId,
  runId,
  threadIdFor,
  transcriptCalls,
} from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { readParticipantNames, readPlaces } from "@pinetrie/reads"
import { readStreams } from "@pinetrie/schema"
import { beginRun } from "@pinetrie/schema/fixtures"
import { openStore } from "../../host/store.ts"
import type { Checks } from "../checks.ts"
import { gateClose, gateCommand, gateFeed, newGate } from "../gate.ts"
import {
  at,
  committedProject,
  composeCard,
  heldEntries,
  heldLanes,
  heldTree,
  idleNow,
  idOfText,
  join,
  noQueued,
  queueCard,
  START_AGENT,
  setUpAccepted,
  waitFor,
} from "../harness.ts"
import { cleanUp, inLane, inLaneQuiet, type LaneHosts } from "../lane-hosts.ts"
import type { Scenario } from "../scenario.ts"

import {
  LATE_LOAD_MS,
  rootBytes,
  slowToLoad,
  storedLines,
  storedRecords,
} from "./support.ts"

export const scenario: Scenario = {
  lanes: true,
  run: ({ check }, { lanes }) => run(check, lanes),
}

async function run(check: Checks["check"], lanes: LaneHosts): Promise<void> {
  // A second host with a scripted model, tools in a temporary directory, and its
  // session in a SQLite file, so every step is repeatable and spends nothing.
  {
    const work = await committedProject("pinetrie-tools-", {
      "notes.txt": "the secret word is MANGO\n",
    })
    const dbFile = path.join(
      mkdtempSync(path.join(tmpdir(), "pinetrie-db-")),
      "pinetrie.db",
    )
    const script = scriptedModel()
    // The suite opens the store itself, so it can read it while the host runs.
    let opened = openStore(dbFile)
    let stored = opened.store
    const open = (log: (m: string) => void, store: Store = stored) =>
      lanes.startHost({
        model: { kind: "scripted", script },
        project: { dir: work, tools: true },
        store: { ...opened, store },
        log,
      })
    let th = await open(() => {})
    const tidle = () => waitFor(() => idleNow(th), 60_000)
    const ttree = () => heldTree(th)
    const tlane = () => heldLanes(th, ttree(), readPlaces(th.places))[0]
    // Every open stream at each change of the host's document.
    const watched: ReturnType<typeof readStreams>[] = []
    const watch = () =>
      subscribe(th.live, () => watched.push([...readStreams(th.live)]))
    let unwatch = watch()
    const u = await join(th, "uma", "tools")
    await u.request({ kind: "name", name: "Uma" })
    await setUpAccepted(th.session, u)

    // 1. Read a file, then answer.
    script.use([
      { text: "Let me look.", tool: "read", args: { path: "notes.txt" } },
      { text: "It says MANGO." },
    ])
    await u.send("what is in notes?", ROOT, START_AGENT)
    await tidle()

    // 2. Write a file, then edit it: the disk changes.
    script.use([
      { tool: "write", args: { path: "new.txt", content: "alpha\n" } },
      {
        tool: "edit",
        args: {
          path: "new.txt",
          edits: [{ oldText: "alpha", newText: "beta" }],
        },
      },
      { text: "done" },
    ])
    const lane = tlane()
    await u.send("make new.txt", at(lane?.tip ?? null), { thread: lane?.name })
    await tidle()
    // In its lane's own copy: the project is the person's working copy,
    // which no lane writes.
    const inItsLane =
      lane === undefined ? "" : await inLane(lane.name, "cat new.txt")
    check(
      "the agent wrote a file, then edited it, in its lane, leaving the project as it was",
      inItsLane === "beta\n" && !existsSync(path.join(work, "new.txt")),
      JSON.stringify(inItsLane),
    )

    // 3. A long command streams live, as edits, and leaves no stream behind.
    // Its 400 lines are fed in batches, each streamed before the next.
    const fed = Array.from(
      { length: 400 },
      (_, k) => `line ${k + 1} ${randomBytes(150).toString("base64")}`,
    )
    const printed = fed.reduce((a, l) => a + l.length + 1, 0)
    const long = newGate("long")
    script.use([
      { tool: "bash", args: { command: gateCommand(long) } },
      { text: "ran it" },
    ])
    watched.length = 0
    const l3 = tlane()
    await u.send("run it", at(l3?.tip ?? null), { thread: l3?.name })
    const liveTexts = () =>
      watched
        .flat()
        .filter(s => s.kind === "tool")
        .map(s => s.text)
    if (l3 !== undefined)
      for (let at = 0; at < fed.length; at += 80) {
        const batch = fed.slice(at, at + 80)
        await inLaneQuiet(l3.name, gateFeed(long, batch))
        await waitFor(
          () => (liveTexts().at(-1) ?? "").includes(batch.at(-1) ?? ""),
          10_000,
        )
      }
    if (l3 !== undefined) await inLaneQuiet(l3.name, gateClose(long))
    await tidle()
    const resultText = () =>
      projectSpine(ttree(), tlane()?.tip ?? null)
        .spine.flatMap(transcriptCalls)
        .at(-1)?.result?.text ?? ""
    // The last live update may land after the run is idle: wait for the one
    // the result ends with.
    await waitFor(() => {
      const last = liveTexts().at(-1) ?? ""
      return last.length > 0 && resultText().includes(last.slice(-300))
    }, 5_000)
    const toolTexts = liveTexts()
    const lastLive = toolTexts.at(-1) ?? ""
    const result = resultText()
    check(
      "a running command's output streamed live",
      toolTexts.length > 3 &&
        lastLive.length > 0 &&
        result.includes(lastLive.slice(-300)),
      `${toolTexts.length} updates), matching its result`,
    )
    // The run's end compacted its root's document: the
    // store holds the document as it stands, not the run's edits. Whole-value
    // streams are guarded by `planStream`'s unit test, since compaction would
    // hide them here.
    await th.quiet()
    const ranIn = l3 === undefined ? null : th.docs.rootOfLane(l3.name)
    const ranDoc = ranIn === null ? null : th.rootsRead().get(ranIn)
    const compacted =
      ranIn === null
        ? { records: Number.POSITIVE_INFINITY, bytes: 0 }
        : await storedRecords(stored, rootDocId(ranIn))
    const ranBytes = ranDoc == null ? 0 : rootBytes(ranDoc)
    check(
      "after the run, the store holds the compacted session",
      compacted.records <= 3 && compacted.bytes <= 2 * ranBytes,
      `${compacted.records} records, ${Math.round(compacted.bytes / 1024)} KB for a ${Math.round(ranBytes / 1024)} KB root (${Math.round(printed / 1024)} KB printed)`,
    )

    // 4. Two assistant messages in one run: two reply streams, one at a time.
    script.use([
      { text: "First.", tool: "read", args: { path: "notes.txt" } },
      { text: "Second." },
    ])
    watched.length = 0
    const l4 = tlane()
    await u.send("look again", at(l4?.tip ?? null), { thread: l4?.name })
    await tidle()

    // 5. Stop ends a running command; a message for the busy thread is
    // answered busy, and nothing is written.
    const bob = await join(th, "bob", "tools")
    await bob.request({ kind: "name", name: "Bob" })
    // A command that never ends on its own: only the stop ends it.
    script.use([
      { tool: "bash", args: { command: gateCommand(newGate("held")) } },
      { text: "after" },
    ])
    const l5 = tlane()
    await u.send("sleep", at(l5?.tip ?? null), { thread: l5?.name })
    await waitFor(
      () => readStreams(th.live).some(s => s.kind === "tool"),
      10_000,
    )
    const waiting = await bob.send("@Uma noted", at(tlane()?.tip ?? null), {
      thread: l5?.name,
    })
    const stopped =
      l5 === undefined
        ? undefined
        : await u.request({ kind: "stop", lane: l5.name })
    await tidle()
    const aborted = projectSpine(ttree(), tlane()?.tip ?? null)
      .spine.flatMap(transcriptCalls)
      .at(-1)
    check(
      "stop ended the command at once, recorded as aborted",
      waiting.kind === "busy" &&
        stopped?.kind === "stopped" &&
        aborted?.result?.isError === true &&
        aborted.result.text.includes("aborted"),
      `${aborted?.result?.text.slice(-20) ?? "none"}`,
    )
    if (l5 !== undefined) await u.request({ kind: "stop", lane: l5.name })
    await u.request({ kind: "stop", lane: threadIdFor("no-such-lane") })
    // Who stopped it is a fact in its thread: pi's
    // entries say only that the run was aborted. The run's end appends it,
    // the thread's last entry, and the asks name the stopper from it.
    // Stopping it again, idle, queues nothing.
    const sleepAsk = idOfText(th, "sleep")
    const stopFacts = () =>
      Object.values(ttree().entries).filter(
        e => e.message?.role === "fact" && e.message.stopped !== undefined,
      )
    await waitFor(() => stopFacts().length > 0, 10_000)
    const tip = tlane()?.tip ?? null
    const fact = tip === null ? undefined : ttree().entries[tip]?.message
    check(
      "the stop is recorded under its ask, naming who stopped it",
      fact?.role === "fact" &&
        fact.stopped?.prompt === sleepAsk &&
        fact.stopped?.by === u.writer &&
        sleepAsk !== null &&
        indexAsks(ttree()).stoppedBy.get(sleepAsk) === u.writer &&
        stopFacts().length === 1,
      `${fact?.role ?? "none"} by ${fact?.role === "fact" ? (fact.stopped?.by ?? "none") : "none"}, ${stopFacts().length} stop fact(s)`,
    )

    // Resume: a new run whose prompt is the host's carry-on
    // message, which the model reads. Held, so a second press finds it busy.
    script.use([{ reply: context => context.at(-1) ?? "" }])
    const carrying = script.hold("asked you to carry on")
    const carried =
      l5 === undefined
        ? undefined
        : await u.request({ kind: "carry-on", lane: l5.name })
    await waitFor(() => carrying.reached, 10_000)
    const again =
      l5 === undefined
        ? undefined
        : await bob.request({ kind: "carry-on", lane: l5.name })
    carrying.finish()
    await tidle()
    const [prompt, reply] = projectSpine(
      ttree(),
      tlane()?.tip ?? null,
    ).spine.slice(-2)
    check(
      "Resume starts a run whose prompt is the carry-on message, and a second press is refused busy",
      carried?.kind === "started" &&
        again?.kind === "refused" &&
        again.code === "busy" &&
        prompt?.role === "carry-on" &&
        prompt.text === "↻ resumed by Uma" &&
        reply?.text.startsWith("Uma asked you to carry on") === true,
      `${carried?.kind}, then ${again?.kind}; ${prompt?.role}: ${reply?.text.slice(0, 40)}`,
    )

    // 6. Restart over the same store: everything is there, and a card queued
    // while the lane ran is popped by the new host's startup, since no run's
    // end will. The run is the document's record alone, which a stopping
    // host leaves and a starting one clears (`planClear`).
    const before = {
      entries: Object.keys(heldEntries(th)).length,
      lanes: heldLanes(th, ttree(), readPlaces(th.places)).map(
        l => `${l.name}@${l.tip}`,
      ),
      names: [...readParticipantNames(th.session).values()].sort(),
    }
    const l6 = tlane()
    const heldText = "@Bob queued across a restart"
    if (l6 !== undefined && l6.tip !== null) {
      beginRun(th.live, l6.name, runId("r-held"))
      const held = await composeCard(
        u,
        { entry: l6.tip, lane: l6.name },
        heldText,
      )
      void queueCard(u, held, l6.name)
      await waitFor(
        () =>
          th.cardText(held) === heldText &&
          readPlaces(th.places).some(
            c => c.id === held && c.place.kind === "queued",
          ),
        5_000,
      )
    }
    // Written after the last compaction, so the store the next host opens holds
    // more than the compacted session: its startup must compact again.
    await u.request({ kind: "name", name: "Uma, again" })
    unwatch()
    // Bob leaves; Uma is still connected when the host stops.
    const bobSeat = bob.exchange.peerId

    await bob.close()
    await waitFor(
      async () => !(await storedLines(stored)).some(id => id.includes(bobSeat)),
      5_000,
    )
    await th.quiet()
    const beforeRestart = await storedRecords(stored, SESSION_DOC_ID)
    await th.shutdown()
    await u.close()
    // The session loads late, so a host that did not wait for it would start
    // from an empty session, and leave the queued card unpopped.
    opened = openStore(dbFile)
    stored = opened.store
    th = await open(() => {}, slowToLoad(stored, SESSION_DOC_ID, LATE_LOAD_MS))
    const linesAfter = await storedLines(stored)
    check(
      "a starting host keeps no command Line from before: no client can resume one",
      linesAfter.length === 0,
      `${linesAfter.length} stored`,
    )
    unwatch = watch()
    await waitFor(() => idOfText(th, heldText) !== null, 15_000)
    await th.quiet()
    const afterRestart = await storedRecords(stored, SESSION_DOC_ID)
    // One whole document, and fewer records than it opened: what the host
    // writes once it has compacted (the proposed changes' refresh, read from
    // the repo) follows it.
    check(
      "a starting host compacts the session it opened",
      beforeRestart.records > 2 &&
        afterRestart.entireties === 1 &&
        afterRestart.records < beforeRestart.records,
      `${beforeRestart.records} records -> ${afterRestart.records}`,
    )
    const after = {
      entries: Object.keys(heldEntries(th)).length - 1,
      lanes: heldLanes(th, ttree(), readPlaces(th.places)).map(
        l => `${l.name}@${l.tip}`,
      ),
      names: [...readParticipantNames(th.session).values()].sort(),
    }
    check(
      "after a restart the session is all there, and the queued card was popped",
      JSON.stringify(after.names) ===
        JSON.stringify(
          before.names.map(n => (n === "Uma" ? "Uma, again" : n)).sort(),
        ) &&
        after.entries === before.entries &&
        noQueued(th),
      `${after.entries} entries`,
    )
    const u2 = await join(th, "uma", "tools")
    script.use([{ text: "back again" }])
    const l7 = tlane()
    await u2.send("still there?", at(l7?.tip ?? null), {
      thread: l7?.name,
    })
    await tidle()
    unwatch()
    await u2.close()
    // The host's Exchange closes its stores when it shuts down, this one too.
    await th.shutdown()
    await cleanUp(th.session, work)
  }
}
