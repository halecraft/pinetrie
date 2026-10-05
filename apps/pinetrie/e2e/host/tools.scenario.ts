// e2e/host/tools — the agent reads, writes, edits and runs, visibly (ADR-0022).

import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Store } from "@kyneta/exchange"
import { subscribe } from "@kyneta/schema"
import {
  cardId,
  laneNameForThread,
  projectSpine,
  ROOT,
  rootDocId,
  runId,
} from "@pinetrie/core"
import { scriptedModel } from "@pinetrie/pi"
import { SESSION_DOC_ID } from "@pinetrie/protocol/messages"
import { readParticipantNames, readPlaces, readStops } from "@pinetrie/reads"
import { beginRun, readStreams } from "@pinetrie/schema"
import { openStore } from "../../host/store.ts"
import type { Checks } from "../checks.ts"
import {
  committedProject,
  entriesOf,
  idleNow,
  join,
  lanesOf,
  noQueued,
  queueCard,
  rootAt,
  rootRecordsOf,
  startSuiteHost,
  treeOf,
  waitFor,
} from "../harness.ts"
import type { Scenario } from "../scenario.ts"

import {
  at,
  idOfIn,
  LATE_LOAD_MS,
  START_AGENT,
  sessionBytes,
  sleep,
  slowToLoad,
  storedLines,
  storedRecords,
} from "./support.ts"

export const scenario: Scenario = {
  run: ({ check }) => run(check),
}

async function run(check: Checks["check"]): Promise<void> {
  // A second host with a scripted model, tools in a temporary directory, and its
  // session in a SQLite file, so every step is repeatable and spends nothing.
  {
    const work = committedProject("pinetrie-tools-", {
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
      startSuiteHost({
        model: { kind: "scripted", script },
        project: { dir: work, tools: true },
        // `verify` runs anywhere: lanes of their own are `e2e:lanes`'s.
        containers: false,
        store,
        blobs: opened.blobs,
        log,
      })
    let th = await open(() => {})
    const tidle = () => waitFor(() => idleNow(th), 60_000)
    const ttree = () => treeOf(th)
    const tlane = () => lanesOf(th, ttree(), readPlaces(th.places))[0]
    // Every open stream at each change of the host's document.
    const watched: ReturnType<typeof readStreams>[] = []
    const watch = () =>
      subscribe(th.live, () => watched.push([...readStreams(th.live)]))
    let unwatch = watch()
    const u = await join(th, "uma", "tools")
    await u.request({ kind: "name", name: "Uma" })

    // 1. Read a file, then answer.
    script.use([
      { text: "Let me look.", tool: "read", args: { path: "notes.txt" } },
      { text: "It says MANGO." },
    ])
    await u.chat("what is in notes?", ROOT, START_AGENT)
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
    await u.chat("make new.txt", at(lane?.tip ?? null), { lane: lane?.name })
    await tidle()
    // This host has no containers, so the lane works directly in the project.
    // A lane of its own is `e2e:lanes`'s.
    const written = path.join(work, "new.txt")
    check(
      "the agent wrote a file, then edited it, working directly in the project",
      lane !== undefined &&
        existsSync(written) &&
        readFileSync(written, "utf8") === "beta\n",
    )

    // 3. A long command streams live, as edits, and leaves no stream behind.
    const lines = 400
    const printed = Array.from(
      { length: lines },
      (_, k) => `line ${k + 1} `.length + 201,
    ).reduce((a, b) => a + b, 0)
    script.use([
      {
        tool: "bash",
        args: {
          command: `for i in $(seq 1 ${lines}); do echo "line $i $(head -c 150 /dev/urandom | base64 | tr -d '\\n')"; sleep 0.005; done`,
        },
      },
      { text: "ran it" },
    ])
    watched.length = 0
    const l3 = tlane()
    await u.chat("run it", at(l3?.tip ?? null), { lane: l3?.name })
    await tidle()
    await sleep(300)
    const toolTexts = watched
      .flat()
      .filter(s => s.kind === "tool")
      .map(s => s.text)
    const lastLive = toolTexts.at(-1) ?? ""
    const result =
      projectSpine(ttree(), tlane()?.tip ?? null)
        .spine.flatMap(n => n.toolCalls ?? [])
        .at(-1)?.result?.text ?? ""
    check(
      "a running command's output streamed live",
      toolTexts.length > 3 &&
        lastLive.length > 0 &&
        result.includes(lastLive.slice(-300)),
      `${toolTexts.length} updates), matching its result`,
    )
    // The run's end compacted its root's document (ADR-0023, ADR-0063): the
    // store holds the document as it stands, not the run's edits. Whole-value
    // streams are guarded by `planStream`'s unit test, since compaction would
    // hide them here.
    await th.quiet()
    const ranIn = l3 === undefined ? null : th.docs.rootOfLane(l3.name)
    const ranDoc = ranIn === null ? null : th.docs.view(ranIn)?.doc
    const compacted =
      ranIn === null
        ? { records: Number.POSITIVE_INFINITY, bytes: 0 }
        : await storedRecords(stored, rootDocId(ranIn))
    const rootBytes = ranDoc == null ? 0 : sessionBytes(ranDoc)
    check(
      "after the run, the store holds the compacted session",
      compacted.records <= 3 && compacted.bytes <= 2 * rootBytes,
      `${compacted.records} records, ${Math.round(compacted.bytes / 1024)} KB for a ${Math.round(rootBytes / 1024)} KB root (${Math.round(printed / 1024)} KB printed)`,
    )

    // 4. Two assistant messages in one run: two reply streams, one at a time.
    script.use([
      { text: "First.", tool: "read", args: { path: "notes.txt" } },
      { text: "Second." },
    ])
    watched.length = 0
    const l4 = tlane()
    await u.chat("look again", at(l4?.tip ?? null), { lane: l4?.name })
    await tidle()

    // 5. Stop ends a running command; a message for the busy thread is
    // answered busy, and nothing is written.
    const bob = await join(th, "bob", "tools")
    await bob.request({ kind: "name", name: "Bob" })
    script.use([
      { tool: "bash", args: { command: "sleep 5; echo late" } },
      { text: "after" },
    ])
    const l5 = tlane()
    const t0 = Date.now()
    await u.chat("sleep", at(l5?.tip ?? null), { lane: l5?.name })
    await waitFor(
      () => readStreams(th.live).some(s => s.kind === "tool"),
      10_000,
    )
    const waiting = await bob.chat("@Uma noted", at(tlane()?.tip ?? null), {
      lane: l5?.name,
    })
    const stopped =
      l5 === undefined
        ? undefined
        : await u.request({ kind: "stop", lane: l5.name })
    await tidle()
    const aborted = projectSpine(ttree(), tlane()?.tip ?? null)
      .spine.flatMap(n => n.toolCalls ?? [])
      .at(-1)
    check(
      "stop ended the command at once, recorded as aborted",
      waiting.kind === "busy" &&
        stopped?.kind === "stopped" &&
        aborted?.result?.isError === true &&
        aborted.result.text.includes("aborted") &&
        Date.now() - t0 < 4_000,
      `${aborted?.result?.text.slice(-20) ?? "none"}`,
    )
    if (l5 !== undefined) await u.request({ kind: "stop", lane: l5.name })
    await u.request({ kind: "stop", lane: laneNameForThread("no-such-lane") })
    // Who stopped it is recorded under the ask (ADR-0056): pi's entries say
    // only that the run was aborted. Stopping it again, idle, records nothing.
    const sleepAsk = idOfIn(th, "sleep")
    const stop =
      sleepAsk === null ? undefined : rootRecordsOf(th, readStops).get(sleepAsk)
    check(
      "the stop is recorded under its ask, naming who stopped it",
      stop?.by === u.writer && rootRecordsOf(th, readStops).size === 1,
      `${stop?.by ?? "none"}, ${rootRecordsOf(th, readStops).size} recorded`,
    )

    // Resume (ADR-0082): a new run whose prompt is the host's carry-on
    // message, which the model reads. Held, so a second press finds it busy.
    script.use([{ reply: context => context.at(-1) ?? "" }])
    const carrying = script.pause("asked you to carry on")
    const carried =
      l5 === undefined
        ? undefined
        : await u.request({ kind: "carry-on", lane: l5.name })
    await waitFor(() => carrying.reached, 10_000)
    const again =
      l5 === undefined
        ? undefined
        : await bob.request({ kind: "carry-on", lane: l5.name })
    carrying.resume()
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
    // host leaves and a starting one clears (`clearStreams`).
    const before = {
      entries: Object.keys(entriesOf(th)).length,
      lanes: lanesOf(th, ttree(), readPlaces(th.places)).map(
        l => `${l.name}@${l.tip}`,
      ),
      names: [...readParticipantNames(th.session).values()].sort(),
    }
    const l6 = tlane()
    const heldText = "@Bob queued across a restart"
    if (l6 !== undefined && l6.tip !== null) {
      beginRun(th.live, l6.name, runId("r-held"))
      const held = cardId(crypto.randomUUID())
      const where = at(l6.tip)
      u.createCard(
        {
          id: held,
          place: {
            kind: "drafting",
            root: rootAt(u, where),
            at: where,
            lane: l6.name,
          },
          carries: { kind: "message", command: null },
          unsent: null,
        },
        heldText,
      )
      void queueCard(u, held, { lane: l6.name, at: where })
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
    await waitFor(() => idOfIn(th, heldText) !== null, 15_000)
    await th.quiet()
    const afterRestart = await storedRecords(stored, SESSION_DOC_ID)
    check(
      "a starting host compacts the session it opened",
      beforeRestart.records > 2 && afterRestart.records <= 2,
      `${beforeRestart.records} records -> ${afterRestart.records}`,
    )
    const after = {
      entries: Object.keys(entriesOf(th)).length - 1,
      lanes: lanesOf(th, ttree(), readPlaces(th.places)).map(
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
    await u2.chat("still there?", at(l7?.tip ?? null), {
      lane: l7?.name,
    })
    await tidle()
    unwatch()
    await u2.close()
    await sleep(100)
    // The host's Exchange closes its stores when it shuts down, this one too.
    await th.shutdown()
  }
}
