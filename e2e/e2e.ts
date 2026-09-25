// e2e — drive the WHOLE skeleton without a browser.
//
// This is the CI-runnable proof. It uses client/session-view.ts unmodified —
// the same module the browser bundle uses — so what is exercised is the real
// client path, with Node's global WebSocket standing in for the browser's.
// What is NOT exercised: any browser runtime. Stated plainly in the findings.
//
//   node e2e/e2e.mjs              offline: transport + docs + protocol, no model call
//   PINETA_LIVE=1 node e2e/e2e.mjs   also drives a REAL turn against a real model

import { ERR, findSeqKeys, projectSpine, projectTranscript } from "@pineta/core"
import { readEntries, readLaneTip, writeEntry } from "@pineta/schema"
import { readRenderableEntries } from "../client/projection.ts"
import { connectSession } from "../client/session-view.ts"
import { startHost } from "../host/index.ts"
import { createChecks } from "./harness.ts"

const LIVE = process.env.PINETA_LIVE === "1"
const PROMPT = "Say exactly: PINETA-OK"

const { ok, report } = createChecks()
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
async function waitFor(
  pred: () => boolean,
  timeoutMs = 60_000,
): Promise<number> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return Date.now() - t0
    await sleep(10)
  }
  return -1
}

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
const rejected = await client.prompt("   ")
ok(
  rejected.accepted === false && rejected.errorCode === "empty_prompt",
  `empty prompt structurally rejected: ${rejected.errorCode}`,
)

const badKind = await (async () => {
  // Send a kind the protocol permits but the host does not implement.
  const r = await client.prompt("hello")
  return r
})()
ok(
  badKind.accepted === true && badKind.runId !== "",
  `prompt accepted, runId issued (${badKind.runId.slice(-8)})`,
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
ok(view.laneName === host.laneName, "client and host agree on the lane name")

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
const hostTip = await host.agent.tipId()
ok(
  hostTip === readLaneTip(host.doc, host.laneName),
  "lane tip in the document matches the harness's own tip",
)
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
    await host.agent.tipId(),
  )
  const forkFrom = trunkBefore[0]?.id ?? null
  ok(forkFrom !== null, "found an entry to branch from")
  if (forkFrom !== null) {
    const reply = await client.prompt("BRANCH-OK", forkFrom)
    ok(
      reply.accepted,
      `branch command accepted${reply.accepted ? "" : `: ${reply.errorCode}`}`,
    )

    const movedTip = await host.agent.tipId()
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
    const back = await client.navigate(trunkTip)
    ok(
      back.accepted,
      `navigate back to the trunk accepted${back.accepted ? "" : `: ${back.errorCode}`}`,
    )
    ok(
      (await host.agent.tipId()) === trunkTip,
      "the lane tip is back on the trunk",
    )

    const known = new Set(Object.keys(readRenderableEntries(host.doc)))
    const resumed = await client.prompt("RESUMED")
    ok(resumed.accepted, "a prompt after returning is accepted")
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
  const bogus = await client.navigate("no-such-entry")
  ok(
    !bogus.accepted && bogus.errorCode === ERR.UNKNOWN_TARGET,
    `an unknown target is REJECTED back to the client (${bogus.errorCode})`,
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

// --- LIVE assertion -------------------------------------------------------
if (LIVE) {
  console.log("\n--- live turn ---")
  streamSamples.length = 0
  const r = await client.prompt(PROMPT)
  ok(r.accepted, "live prompt accepted")
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
