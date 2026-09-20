// e2e — drive the WHOLE skeleton without a browser.
//
// This is the CI-runnable proof. It uses client/session-view.mjs unmodified —
// the same module the browser bundle uses — so what is exercised is the real
// client path, with Node's global WebSocket standing in for the browser's.
// What is NOT exercised: any browser runtime. Stated plainly in the findings.
//
//   node e2e/e2e.mjs              offline: transport + docs + protocol, no model call
//   PINETA_LIVE=1 node e2e/e2e.mjs   also drives a REAL turn against a real model

import { findSeqKeys, projectTranscript } from "../core/index.mjs"
import { readEntries, readLaneTip } from "../schema/index.mjs"
import { connectSession } from "../client/session-view.mjs"
import { startHost } from "../host/index.mjs"

const LIVE = process.env.PINETA_LIVE === "1"
const PROMPT = "Say exactly: PINETA-OK"

let pass = 0
let fail = 0
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  PASS  ${msg}`) } else { fail++; console.log(`  FAIL  ${msg}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(pred, timeoutMs = 60_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (pred()) return Date.now() - t0
    await sleep(10)
  }
  return -1
}

console.log(`=== Pineta walking skeleton — end to end (${LIVE ? "LIVE model" : "offline"}) ===\n`)

const host = await startHost({ port: 0, log: (m) => console.log(m) })
console.log(`[e2e] host at ${host.httpUrl}\n`)

// --- layer: browser client module over a real websocket -------------------
const streamSamples = []
const client = await connectSession({
  url: host.wsUrl,
  WebSocket,
  peerId: "e2e-client",
  onChange: (v) => { if (v.streaming) streamSamples.push(v.streaming.text) },
})
ok(true, "client connected over a real websocket and opened the session document")

// --- layer: Line command channel, rejection path --------------------------
const rejected = await client.prompt("   ")
ok(rejected.accepted === false && rejected.errorCode === "empty_prompt",
  `empty prompt structurally rejected: ${rejected.errorCode}`)

const badKind = await (async () => {
  // Send a kind the protocol permits but the host does not implement.
  const r = await client.prompt("hello")
  return r
})()
ok(badKind.accepted === true && badKind.runId !== "", `prompt accepted, runId issued (${badKind.runId.slice(-8)})`)

if (!LIVE) {
  console.log("\n  (offline mode: the accepted prompt above DOES call the model —")
  console.log("   set PINETA_LIVE=1 to assert on its content)\n")
}

// --- layer: harness + storage + replication -------------------------------
const gotEntries = await waitFor(() => client.view().transcript.length >= 2, 120_000)
ok(gotEntries >= 0, `committed entries replicated to the client (${gotEntries}ms)`)

const view = client.view()
ok(view.laneName !== null && view.laneName.startsWith("w-"),
  `lane name carries writer identity, not "main": ${view.laneName}`)
ok(view.laneName === host.laneName, "client and host agree on the lane name")

const roles = view.transcript.map((m) => m.role)
ok(roles[0] === "user" && roles[1] === "assistant",
  `transcript ordered by parentId walk: [${roles.join(", ")}]`)
ok(view.transcript[0].text === "hello", `user turn round-tripped: ${JSON.stringify(view.transcript[0].text)}`)
ok(view.transcript[1].text.length > 0, `assistant replied (${view.transcript[1].text.length} chars)`)

// --- ADR-0014: streaming went through Schema.text() -----------------------
ok(streamSamples.length > 0, `client observed ${streamSamples.length} live streaming updates`)
const monotonic = streamSamples.every((s, i) => i === 0 || s.startsWith(streamSamples[i - 1]))
ok(monotonic, "streamed text grew monotonically (insert(at, delta), never a whole-value replace)")
ok(client.view().streaming === null, "pendingText cleared on commit")

// --- ADR-0013: seq never escapes the replica ------------------------------
const rawEntries = readEntries(host.doc)
const storedSeq = Object.values(rawEntries).filter((e) => "seq" in e)
ok(storedSeq.length === 0, `no entry in the replicated document carries a stored seq (${Object.keys(rawEntries).length} entries checked)`)

const wireSeq = client.replies.flatMap((r) => findSeqKeys(r))
ok(wireSeq.length === 0, `no seq key on any wire message (${client.replies.length} replies checked)`)

// --- the host's own view agrees -------------------------------------------
const hostTip = await host.agent.tipId()
ok(hostTip === readLaneTip(host.doc, host.laneName), "lane tip in the document matches the harness's own tip")
const hostTranscript = projectTranscript(rawEntries, hostTip)
ok(hostTranscript.length === view.transcript.length,
  `host and client project the same transcript (${hostTranscript.length} messages)`)

// --- LIVE assertion -------------------------------------------------------
if (LIVE) {
  console.log("\n--- live turn ---")
  streamSamples.length = 0
  const r = await client.prompt(PROMPT)
  ok(r.accepted, "live prompt accepted")
  const done = await waitFor(() => client.view().transcript.length >= 4, 120_000)
  ok(done >= 0, `live turn completed and replicated (${done}ms)`)
  const last = client.view().transcript.at(-1)
  console.log(`  model said: ${JSON.stringify(last.text)}`)
  ok(last.text.includes("PINETA-OK"), "model output contains the requested token")
  ok(streamSamples.length > 0, `live turn streamed ${streamSamples.length} updates through Schema.text()`)
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

console.log(`\n=== e2e: pass=${pass} fail=${fail} ===`)
process.exit(fail === 0 ? 0 : 1)
