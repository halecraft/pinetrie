// e2e — drive the WHOLE skeleton without a browser.
//
// This is the CI-runnable proof. It uses client/session-view.ts unmodified —
// the same module the browser bundle uses — so what is exercised is the real
// client path, with Node's global WebSocket standing in for the browser's.
// What is NOT exercised: any browser runtime. Stated plainly in the findings.
//
//   node e2e/e2e.mjs              offline: transport + docs + protocol, no model call
//   PINETA_LIVE=1 node e2e/e2e.mjs   also drives a REAL turn against a real model

import { readRenderableEntries } from "@pineta/client/projection"
import { connectSession } from "@pineta/client/session"
import {
  atEntry,
  ERR,
  entryId,
  findSeqKeys,
  projectSpine,
  projectTranscript,
  ROOT,
} from "@pineta/core"
import type { Outcome } from "@pineta/protocol/codec"
import {
  hasLaneRecord,
  readEntries,
  readLaneTip,
  writeEntry,
} from "@pineta/schema"
import { startHost } from "../host/index.ts"
import { createChecks, waitFor } from "./harness.ts"

const LIVE = process.env.PINETA_LIVE === "1"
const PROMPT = "Say exactly: PINETA-OK"

const { ok, report } = createChecks()
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

console.log(
  `=== Pineta walking skeleton — end to end (${LIVE ? "LIVE model" : "offline"}) ===\n`,
)

const host = await startHost({ port: 0, log: m => console.log(m) })
console.log(`[e2e] host at ${host.httpUrl}\n`)

// --- layer: browser client module over a real websocket -------------------
const streamSamples: string[] = []
const client = await connectSession({
  url: host.wsUrl,
  WebSocket,
  peerId: "e2e-client",
  onChange: v => {
    if (v.streaming) streamSamples.push(v.streaming.text)
  },
})
ok(
  true,
  "client connected over a real websocket and opened the session document",
)

// --- layer: Line command channel, rejection path --------------------------
/** Outcome, read the way these checks need it. */
const accepted = (o: Outcome) => o.kind !== "refused"
const codeOf = (o: Outcome) => (o.kind === "refused" ? o.code : "")
const runOf = (o: Outcome) => (o.kind === "started" ? o.runId : "")
/** A lane's tip, read from the host's document. */
const tipOf = (lane: string) => readLaneTip(host.doc, lane)

const rejected = await client.prompt("   ")
ok(
  !accepted(rejected) && codeOf(rejected) === "empty_prompt",
  `empty prompt structurally rejected: ${codeOf(rejected)}`,
)

const hello = await client.prompt("hello")
ok(
  accepted(hello) && runOf(hello) !== "",
  `prompt accepted, runId issued (${runOf(hello).slice(-8)})`,
)

if (!LIVE) {
  console.log(
    "\n  (offline mode: the accepted prompt above DOES call the model —",
  )
  console.log("   set PINETA_LIVE=1 to assert on its content)\n")
}

// --- layer: harness + storage + replication -------------------------------
const gotEntries = await waitFor(
  () => client.view().transcript.length >= 2,
  120_000,
)
ok(
  gotEntries >= 0,
  `committed entries replicated to the client (${gotEntries}ms)`,
)

const view = client.view()
ok(
  view.laneName?.startsWith("w-"),
  `lane name carries writer identity, not "main": ${view.laneName}`,
)
// Identity comes from the transport: the host must have recorded this
// client's work under exactly the lane name the client derived for itself.
ok(
  hasLaneRecord(host.doc, client.laneName),
  "the host keyed this client's work to the client's own lane",
)

const roles = view.transcript.map(m => m.role)
ok(
  roles[0] === "user" && roles[1] === "assistant",
  `transcript ordered by parentId walk: [${roles.join(", ")}]`,
)
const userTurn = view.transcript[0]
const assistantTurn = view.transcript[1]
ok(
  userTurn?.text === "hello",
  `user turn round-tripped: ${JSON.stringify(userTurn?.text)}`,
)
ok(
  (assistantTurn?.text.length ?? 0) > 0,
  `assistant replied (${assistantTurn?.text.length ?? 0} chars)`,
)

// --- ADR-0014: streaming went through Schema.text() -----------------------
ok(
  streamSamples.length > 0,
  `client observed ${streamSamples.length} live streaming updates`,
)
const monotonic = streamSamples.every((s, i) => {
  const previous = streamSamples[i - 1]
  return previous === undefined || s.startsWith(previous)
})
ok(
  monotonic,
  "streamed text grew monotonically (insert(at, delta), never a whole-value replace)",
)
ok(client.view().streaming === null, "pendingText cleared on commit")

// --- ADR-0013: seq never escapes the replica ------------------------------
// The doc stores entries as opaque JSON; re-type once, at the read boundary.
const rawEntries = readEntries(host.doc)
const storedSeq = Object.values(rawEntries).filter(
  e => e !== null && typeof e === "object" && "seq" in e,
)
// A scan over an empty set proves nothing, so assert the sample first.
ok(
  Object.keys(rawEntries).length > 0,
  `the stored-seq scan has something to scan (${Object.keys(rawEntries).length} entries)`,
)
ok(
  storedSeq.length === 0,
  `no entry in the replicated document carries a stored seq (${Object.keys(rawEntries).length} entries checked)`,
)

const wireSeq = client.replies.flatMap(r => findSeqKeys(r))
ok(
  client.replies.length > 0,
  `the wire-seq scan has something to scan (${client.replies.length} replies)`,
)
ok(
  wireSeq.length === 0,
  `no seq key on any wire message (${client.replies.length} replies checked)`,
)

// --- the host's own view agrees -------------------------------------------
// Read through the DOCUMENT, as the client does. There is deliberately no
// way to read a tip through the agent, so observing cannot create a lane.
const hostTip = tipOf(client.laneName)
ok(hostTip !== null, "the client's lane has a tip in the host's document")
// Project through the SAME reader the client uses. `rawEntries` is the stored
// form (typed columns + sealed payload, ADR-0015); it is right for the seq
// scan above and wrong for rendering, because `message` lives in the payload.
const hostTranscript = projectTranscript(
  readRenderableEntries(host.doc),
  hostTip,
)
ok(
  hostTranscript.length === view.transcript.length,
  `host and client project the same transcript (${hostTranscript.length} messages)`,
)

// --- a fork created THROUGH THE PROTOCOL -----------------------------------
//
// The user-facing path: a branch command names a parent, the host navigates
// there, and the turn forks from it. Distinct from the foreign write below,
// which simulates a branch arriving from another replica (S3). Both matter;
// they exercise different halves.
{
  const trunkBefore = projectTranscript(
    readRenderableEntries(host.doc),
    tipOf(client.laneName),
  )
  const forkFrom = trunkBefore[0]?.id ?? null
  ok(forkFrom !== null, "found an entry to branch from")
  if (forkFrom !== null) {
    const reply = await client.prompt("BRANCH-OK", entryId(forkFrom))
    ok(
      accepted(reply),
      `branch command accepted${accepted(reply) ? "" : `: ${codeOf(reply)}`}`,
    )

    const movedTip = tipOf(client.laneName)
    ok(
      movedTip !== null && movedTip !== trunkBefore.at(-1)?.id,
      "the lane tip moved onto the branch",
    )

    // THE assertion. Everything softer than this passes for a plain prompt
    // too: appending at the tip also moves the tip, and projectSpine from an
    // OLD tip reports any later append as a branch, because those entries are
    // children of that tip but not on its path. Only parentage distinguishes
    // "forked from the entry I named" from "appended where it always would".
    const after = readRenderableEntries(host.doc)
    const parentOfNew = Object.values(after)
      .filter(e => !trunkBefore.some(t => t.id === e.id))
      .map(e => e.parentId)
    ok(
      parentOfNew.includes(forkFrom),
      `the new turn attaches to the entry we named, not the lane tip (${JSON.stringify(parentOfNew)} contains ${forkFrom})`,
    )

    const trunkTip = trunkBefore.at(-1)?.id ?? null
    const { spine } = projectSpine(readRenderableEntries(host.doc), trunkTip)
    ok(
      spine.length === trunkBefore.length,
      `the trunk transcript is unchanged (${spine.length} vs ${trunkBefore.length})`,
    )
  }
}

// --- coming back from an Aside --------------------------------------------
//
// Without this a branch is one-way: navigateTree moves the lane onto the
// branch and nothing moves it back. Proven by PARENTAGE, as the branch was:
// the next turn must attach to the trunk tip we returned to.
{
  const entries = readRenderableEntries(host.doc)
  const trunkTip = hostTranscript.at(-1)?.id ?? null
  ok(trunkTip !== null, "remembered the trunk tip before the aside")
  if (trunkTip !== null) {
    const back = await client.navigate(atEntry(entryId(trunkTip)))
    ok(
      accepted(back),
      `navigate back to the trunk accepted${accepted(back) ? "" : `: ${codeOf(back)}`}`,
    )
    ok(tipOf(client.laneName) === trunkTip, "the lane tip is back on the trunk")

    const known = new Set(Object.keys(readRenderableEntries(host.doc)))
    const resumed = await client.prompt("RESUMED")
    ok(accepted(resumed), "a prompt after returning is accepted")
    await waitFor(
      () => Object.keys(readRenderableEntries(host.doc)).length > known.size,
    )
    const fresh = Object.values(readRenderableEntries(host.doc)).filter(
      e => !known.has(e.id),
    )
    ok(
      fresh.some(e => e.parentId === trunkTip),
      "the next turn resumes the TRUNK, not the aside",
    )
    void entries
  }

  // Unlike a run, navigation is awaited before the reply, so pi's refusal
  // comes back as a structured rejection rather than a host log line.
  const bogus = await client.navigate(atEntry(entryId("no-such-entry")))
  ok(
    !accepted(bogus) && codeOf(bogus) === ERR.UNKNOWN_TARGET,
    `an unknown target is REJECTED back to the client (${codeOf(bogus)})`,
  )
}

// --- a fork, written as another replica would write it (S3) ----------------
//
// The only command today is `prompt`, so a branch cannot be created through
// the protocol. Writing the entry directly is not a contrivance: it is exactly
// the S3 foreign-write scenario, which is what a branch from another device
// looks like on arrival. The parent must exist, or KynetaStorage's reconcile
// takes its unresolved-parents path and throws.
const branchesBefore = projectSpine(
  readRenderableEntries(host.doc),
  hostTip,
).spine.reduce((n, node) => n + node.branches.length, 0)
const forkParent = hostTranscript.at(-2)?.id ?? hostTranscript[0]?.id ?? null
ok(forkParent !== null, "found a parent to fork from")
if (forkParent !== null) {
  writeEntry(host.doc, {
    id: `aside-${Math.random().toString(36).slice(2, 10)}`,
    parentId: forkParent,
    type: "message",
    timestamp: Date.now(),
    fromId: null,
    payload: {
      message: { role: "user", content: "an aside", timestamp: Date.now() },
    },
  })

  const { spine } = projectSpine(readRenderableEntries(host.doc), hostTip)
  // A DELTA, and counting BRANCHES rather than branched nodes: the protocol
  // branch above already forked from this same parent, so a per-node count
  // would not move when a second branch joins the same node.
  const branchesAfter = spine.reduce((n, node) => n + node.branches.length, 0)
  ok(
    branchesAfter === branchesBefore + 1,
    `the foreign write adds one more branch (${branchesBefore} -> ${branchesAfter})`,
  )
  const foreign = spine
    .flatMap(n => n.branches)
    .find(b => b.rootId.startsWith("aside-"))
  ok(
    foreign?.messageCount === 1,
    `the foreign branch summarises its subtree (${foreign?.messageCount} message)`,
  )
  ok(
    spine.length === hostTranscript.length,
    `the fork does NOT join the spine (${spine.length} vs ${hostTranscript.length})`,
  )
}

// --- two writers, one host (ADR-0011) ---------------------------------------
//
// The headline claims of step 3. Before it, every client drove ONE host-owned
// lane: B could move A's lane, and B was refused as busy while A ran.
{
  const seenBy = { a: new Set<string>(), b: new Set<string>() }
  const a = await connectSession({
    url: host.wsUrl,
    WebSocket,
    peerId: "writer-a",
    onChange: v => v.streaming && seenBy.a.add(v.streaming.runId),
  })
  const b = await connectSession({
    url: host.wsUrl,
    WebSocket,
    peerId: "writer-b",
    onChange: v => v.streaming && seenBy.b.add(v.streaming.runId),
  })
  ok(a.laneName !== b.laneName, "two clients have two lanes")

  // Concurrency. Both prompts are sent before either finishes.
  let bothActive = false
  const watch = setInterval(() => {
    const active = host.doc.activeRuns()
    if (a.laneName in active && b.laneName in active) bothActive = true
  }, 5)
  const [ra, rb] = await Promise.all([
    a.prompt("WRITER-A says hello"),
    b.prompt("WRITER-B says hello"),
  ])
  ok(
    accepted(ra) && accepted(rb),
    `both writers' prompts accepted at once (B: ${codeOf(rb) || "ok"})`,
  )
  await waitFor(() => tipOf(a.laneName) !== null && tipOf(b.laneName) !== null)
  await waitFor(() => Object.keys(host.doc.activeRuns()).length === 0)
  clearInterval(watch)
  ok(bothActive, "both lanes were streaming at the same moment")

  // Stream isolation: each window's stream view only ever showed its OWN run.
  ok(
    [...seenBy.a].every(id => id === runOf(ra)) &&
      [...seenBy.b].every(id => id === runOf(rb)),
    `each window streamed only its own run (A saw ${seenBy.a.size}, B saw ${seenBy.b.size})`,
  )

  // Each turn attached to its own lane, proven by parentage.
  const rows = readRenderableEntries(host.doc)
  const pathA = projectTranscript(rows, tipOf(a.laneName)).map(m => m.text)
  const pathB = projectTranscript(rows, tipOf(b.laneName)).map(m => m.text)
  ok(
    pathA.some(t => t.includes("WRITER-A")) &&
      !pathA.some(t => t.includes("WRITER-B")),
    "A's lane holds A's turn and not B's",
  )
  ok(
    pathB.some(t => t.includes("WRITER-B")) &&
      !pathB.some(t => t.includes("WRITER-A")),
    "B's lane holds B's turn and not A's",
  )

  // B navigating must not move A's lane. This is the ADR-0011 hazard.
  const aBefore = tipOf(a.laneName)
  const moved = await b.navigate(ROOT)
  ok(accepted(moved), `B navigates its own lane (${codeOf(moved) || "ok"})`)
  // `aBefore !== null` is required. Without it this passed when every
  // writer shared one lane: A's own lane was never written, so its tip read
  // null before and after, and null === null. Proven by a negative control.
  ok(
    aBefore !== null && tipOf(a.laneName) === aBefore,
    "B navigating did NOT move A's lane",
  )

  // Branching from your own tip is "stay" then a run. pi refuses to navigate
  // to the current tip, so without planAttach this failed as invalid_navigation.
  const aTip = tipOf(a.laneName)
  if (aTip !== null) {
    const own = await a.prompt("from my own tip", entryId(aTip))
    ok(
      accepted(own),
      `branching from your own tip succeeds (${codeOf(own) || "ok"})`,
    )
    await waitFor(() => Object.keys(host.doc.activeRuns()).length === 0)
  }

  // Navigate to the ROOT first, then branch from an entry: the run must attach
  // to the entry. The document tells "no lane" from "lane at root" only because
  // pi records the lane on creation; get that wrong and pi ignores createAt.
  const c = await connectSession({
    url: host.wsUrl,
    WebSocket,
    peerId: "writer-c",
  })
  const toRoot = await c.navigate(ROOT)
  ok(accepted(toRoot), "a new writer can start its lane at the root")
  const forkAt = pathA.length > 0 ? tipOf(a.laneName) : null
  if (forkAt !== null) {
    const known = new Set(Object.keys(readRenderableEntries(host.doc)))
    const fork = await c.prompt("C forks", entryId(forkAt))
    ok(
      accepted(fork),
      `branch after a root navigation accepted (${codeOf(fork) || "ok"})`,
    )
    await waitFor(() => Object.keys(host.doc.activeRuns()).length === 0)
    const fresh = Object.values(readRenderableEntries(host.doc)).filter(
      e => !known.has(e.id),
    )
    ok(
      fresh.some(e => e.parentId === forkAt),
      "it attached to the ENTRY, not the root the lane was created at",
    )
  }

  // A writer with NO lane branching to an unknown entry: lane creation throws
  // in pi, and must still come back as a structured refusal.
  const d = await connectSession({
    url: host.wsUrl,
    WebSocket,
    peerId: "writer-d",
  })
  const lost = await d.prompt("into the void", entryId("no-such-entry"))
  ok(
    codeOf(lost) === ERR.UNKNOWN_TARGET,
    `an unknown target on a NEW lane is refused back (${codeOf(lost) || "accepted"})`,
  )

  await Promise.all([a.close(), b.close(), c.close(), d.close()])
}

// --- LIVE assertion -------------------------------------------------------
if (LIVE) {
  console.log("\n--- live turn ---")
  streamSamples.length = 0
  const r = await client.prompt(PROMPT)
  ok(accepted(r), "live prompt accepted")
  const done = await waitFor(
    () => client.view().transcript.length >= 4,
    120_000,
  )
  ok(done >= 0, `live turn completed and replicated (${done}ms)`)
  const last = client.view().transcript.at(-1)
  console.log(`  model said: ${JSON.stringify(last?.text)}`)
  ok(
    last?.text.includes("PINETA-OK") === true,
    "model output contains the requested token",
  )
  ok(
    streamSamples.length > 0,
    `live turn streamed ${streamSamples.length} updates through Schema.text()`,
  )
}

console.log("\n--- final client view ---")
for (const m of client.view().transcript) {
  console.log(`  ${m.role.padEnd(9)} ${JSON.stringify(m.text.slice(0, 72))}`)
}

// Shut the client down first, then let the socket settle before tearing down
// the host: otherwise the host's transport decodes a frame against an
// already-disposed pipeline and logs a harmless "Pipeline disposed".
await client.close()
await sleep(100)
await host.shutdown()

report("e2e")
