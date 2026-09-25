// e2e — drive the WHOLE system without a browser.
//
// This is the CI-runnable proof. It uses client/session-view.ts unmodified —
// the same module the browser bundle uses — and reads the document through
// `@pineta/reads`, the same reads the host decides from. Node's global
// WebSocket stands in for the browser's. What is NOT exercised: any browser
// runtime.
//
//   pnpm run e2e        offline: the model IS called, but its words are not checked
//   pnpm run e2e:live   also asserts on what the model says

import { readStreaming } from "@pineta/client/projection"
import { connectSession, type SessionClient } from "@pineta/client/session"
import {
  ancestry,
  atEntry,
  ERR,
  entryId,
  findSeqKeys,
  followTip,
  type Position,
  projectSpine,
  projectTranscript,
  ROOT,
} from "@pineta/core"
import { decodeChat } from "@pineta/marginalia"
import type { Outcome } from "@pineta/protocol/codec"
import {
  readLanes,
  readOutbox,
  readParticipantNames,
  readReferences,
  readRenderableEntries,
  readTreeIndex,
} from "@pineta/reads"
import {
  readActiveRun,
  readEntries,
  readEntryMessage,
  readLaneNames,
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
  `=== Pineta — end to end (${LIVE ? "LIVE model" : "offline"}) ===\n`,
)

const host = await startHost({ port: 0, log: m => console.log(m) })
console.log(`[e2e] host at ${host.httpUrl}\n`)

// ── helpers ───────────────────────────────────────────────────────────────

const codeOf = (o: Outcome) => (o.kind === "refused" ? o.code : "")
const runOf = (o: Outcome) => (o.kind === "started" ? o.runId : "")
const tree = () => readTreeIndex(host.doc)
const lanes = () => readLanes(host.doc, tree())
const at = (id: string | null): Position =>
  id === null ? ROOT : atEntry(entryId(id))
/** Nothing running, and nothing waiting to run. */
const idle = () =>
  waitFor(
    () =>
      Object.keys(host.doc.activeRuns()).length === 0 &&
      readOutbox(host.doc).length === 0,
    120_000,
  )
/** The id of the message whose text is exactly `text`. */
const idOf = (text: string): string | null =>
  Object.values(readRenderableEntries(host.doc)).find(
    e =>
      e.message !== undefined &&
      projectTranscript(tree(), e.id).at(-1)?.text === text,
  )?.id ?? null
/** The path to `tip`, as "role:text" (chat as "Name:text"). */
const shape = (tip: string | null) =>
  projectTranscript(tree(), tip).map(m =>
    m.role === "chat" ? `${m.author}:${m.text}` : m.role,
  )
const connect = (peerId: string, onChange?: () => void) =>
  connectSession({ url: host.wsUrl, WebSocket, peerId, onChange })

/**
 * Invariants of ADR-0020, checked after every section:
 *   - every lane is a thread's (`t-…`); none is named after a person;
 *   - no two lanes share a tip: a lane's tip is its thread's end;
 *   - a lane only advances: its earlier tip is on its current tip's path.
 */
const seenTips = new Map<string, string>()
function invariants(section: string) {
  const all = readLaneNames(host.doc)
  const tips = all
    .map(l => readLaneTip(host.doc, l))
    .filter((t): t is string => t !== null)
  const moved = all.filter(l => {
    const before = seenTips.get(l)
    const now = readLaneTip(host.doc, l)
    return (
      before !== undefined &&
      now !== null &&
      !ancestry(tree(), now).path.includes(before)
    )
  })
  for (const l of all) {
    const t = readLaneTip(host.doc, l)
    if (t !== null) seenTips.set(l, t)
  }
  ok(
    all.every(l => l.startsWith("t-")) &&
      new Set(tips).size === tips.length &&
      moved.length === 0,
    `${section}: lanes are threads', tips unique, none moved (${all.length} lanes)`,
  )
}

// ── the first turn ────────────────────────────────────────────────────────
const streamSamples: string[] = []
const client: SessionClient = await connect("e2e-client", () => {
  for (const lane of readLaneNames(host.doc)) {
    const s = readStreaming(host.doc, lane)
    if (s !== null) streamSamples.push(s.text)
  }
})
ok(true, "client connected over a real websocket and opened the document")

const rejected = await client.chat("   ", ROOT)
ok(
  codeOf(rejected) === ERR.EMPTY_MESSAGE,
  `an empty message is structurally rejected: ${codeOf(rejected)}`,
)

// The root is a working session, so a first message runs the agent: the
// first compelled message in a thread creates that thread's lane.
const hello = await client.chat("hello", ROOT)
ok(
  runOf(hello) !== "",
  `a first message starts a run (${runOf(hello).slice(-8)})`,
)
await idle()

const firstLanes = readLaneNames(host.doc)
ok(
  firstLanes.length === 1 && firstLanes[0]?.startsWith("t-") === true,
  `the thread got a lane of its own: ${firstLanes.join(",")}`,
)
ok(
  !firstLanes.some(l => l.includes(client.peerId)),
  "no lane is named after the person who wrote",
)
const trunk = firstLanes[0] ?? ""
const trunkTip = () => readLaneTip(host.doc, trunk)
const first = shape(trunkTip())
ok(
  first.length === 2 &&
    first[0]?.endsWith(":hello") &&
    first[1] === "assistant",
  `the thread reads the message, then the agent's reply: [${first.join(", ")}]`,
)
const helloEntry = projectTranscript(tree(), trunkTip())[0]
const helloMsg =
  helloEntry === undefined
    ? undefined
    : readEntryMessage(host.doc, helloEntry.id)
ok(
  decodeChat(helloMsg?.present ? helloMsg.message : undefined)?.author ===
    client.writer,
  "the message records its writer, from the transport",
)

// ADR-0014: the stream went through Schema.text(), and cleared on commit.
ok(
  streamSamples.length > 0,
  `the client saw ${streamSamples.length} live streaming updates`,
)
ok(
  streamSamples.every((s, i) => {
    const previous = streamSamples[i - 1]
    return previous === undefined || s.startsWith(previous) || s.length < 2
  }),
  "streamed text grew monotonically (insert(at, delta), never a whole-value replace)",
)
ok(readActiveRun(host.doc, trunk) === undefined, "the stream cleared on commit")

// ADR-0013: seq never escapes the replica.
const rawEntries = readEntries(host.doc)
ok(
  Object.keys(rawEntries).length > 0 &&
    Object.values(rawEntries).every(
      e => !(e !== null && typeof e === "object" && "seq" in e),
    ),
  `no stored entry carries a seq (${Object.keys(rawEntries).length} checked)`,
)
ok(
  client.replies.length > 0 &&
    client.replies.flatMap(r => findSeqKeys(r)).length === 0,
  `no seq key on any wire message (${client.replies.length} checked)`,
)

// The client's replica projects what the host's does.
await waitFor(
  () =>
    projectTranscript(readTreeIndex(client.doc), trunkTip()).length ===
    first.length,
)
ok(
  projectTranscript(readTreeIndex(client.doc), trunkTip()).length ===
    first.length,
  "the client's replica projects the same thread as the host's",
)
invariants("first turn")

// ── replying continues the thread's own lane ──────────────────────────────
{
  const before = trunkTip()
  const more = await client.chat("and again", at(before))
  ok(runOf(more) !== "", "a reply at the thread's end runs on its lane")
  await idle()
  ok(
    readLaneNames(host.doc).length === 1 &&
      projectTranscript(tree(), trunkTip()).some(m => m.text === "and again"),
    "no new lane: the thread's lane advanced past its old end",
  )
  invariants("reply")
}

// ── branch: a fork made on purpose ────────────────────────────────────────
{
  const helloId = idOf("hello")
  const trunkBefore = shape(trunkTip())
  const known = new Set(Object.keys(readEntries(host.doc)))
  const fork = await client.chat("BRANCH-OK", at(helloId), "branch")
  ok(runOf(fork) !== "", `a compelled branch starts a run (${fork.kind})`)
  await idle()
  const fresh = Object.values(readEntries(host.doc)).filter(
    e => !known.has(e.id),
  )
  ok(
    fresh.some(e => e.parentId === helloId),
    "the branch attaches to the entry named, not the thread's end",
  )
  ok(
    readLaneNames(host.doc).length === 2,
    "a compelled branch is a new line of work: a second lane",
  )
  ok(
    shape(trunkTip()).join("|") === trunkBefore.join("|"),
    "the trunk is unchanged by the branch",
  )
  const lost = await client.chat("into the void", at("no-such-entry"), "branch")
  ok(
    codeOf(lost) === ERR.UNKNOWN_TARGET,
    `a message at an unknown entry is refused (${codeOf(lost) || lost.kind})`,
  )
  invariants("branch")
}

// ── a fork written as another replica would write it (S3) ─────────────────
{
  const tip = trunkTip()
  const spineBefore = projectSpine(tree(), tip).spine
  const branchesBefore = spineBefore.reduce((n, x) => n + x.branches.length, 0)
  const parent = projectTranscript(tree(), tip).at(-2)?.id ?? null
  ok(parent !== null, "found a parent to fork from")
  if (parent !== null) {
    writeEntry(host.doc, {
      id: `aside-${Math.random().toString(36).slice(2, 10)}`,
      parentId: parent,
      type: "message",
      timestamp: Date.now(),
      fromId: null,
      payload: {
        message: { role: "user", content: "an aside", timestamp: Date.now() },
      },
    })
    const { spine } = projectSpine(tree(), tip)
    const branchesAfter = spine.reduce((n, x) => n + x.branches.length, 0)
    ok(
      branchesAfter === branchesBefore + 1,
      `the foreign write adds one branch (${branchesBefore} -> ${branchesAfter})`,
    )
    ok(
      spine.length === spineBefore.length,
      "the foreign fork does NOT join the spine",
    )
  }
}

// ── two threads run at once; one thread takes one message at a time ──────
{
  const a = await connect("writer-a")
  const b = await connect("writer-b")
  let bothActive = false
  const watch = setInterval(() => {
    if (Object.keys(host.doc.activeRuns()).length >= 2) bothActive = true
  }, 5)
  const [ra, rb] = await Promise.all([
    a.chat("WRITER-A says hello", ROOT),
    b.chat("WRITER-B says hello", ROOT),
  ])
  ok(
    runOf(ra) !== "" && runOf(rb) !== "",
    "two new conversations each start their own run",
  )
  await idle()
  clearInterval(watch)
  ok(bothActive, "two threads' lanes were running at the same moment")
  const sent = (text: string) => {
    const tip = lanes().find(l =>
      projectTranscript(tree(), l.tip).some(m => m.text === text),
    )?.tip
    return projectTranscript(tree(), tip ?? null)
      .filter(m => m.role !== "assistant")
      .map(m => m.text)
  }
  ok(
    sent("WRITER-A says hello").join() === "WRITER-A says hello" &&
      sent("WRITER-B says hello").join() === "WRITER-B says hello",
    "each thread holds its own message and not the other's",
  )
  invariants("concurrency")
  await Promise.all([a.close(), b.close()])
}

// ── conversation threads have no lane ─────────────────────────────────────
{
  const alice = await connect("h-alice")
  const bob = await connect("h-bob")
  const [na, nb] = await Promise.all([
    alice.setName("Alice"),
    bob.setName("Bob"),
  ])
  const names = readParticipantNames(host.doc)
  ok(
    na.kind === "named" &&
      nb.kind === "named" &&
      names.get(alice.writer) === "Alice" &&
      names.get(bob.writer) === "Bob",
    "each person's display name is stored by their writer id",
  )

  // A conversation, branched on purpose from the first message, with no lane.
  const helloId = idOf("hello")
  if (helloId !== null)
    await alice.setThreadMode(entryId(helloId), "conversation")
  const lanesBefore = readLaneNames(host.doc).length
  const opened = await alice.chat(
    "the secret word is PLUM",
    at(helloId),
    "branch",
  )
  const plumId = opened.kind === "appended" ? opened.id : null
  ok(plumId !== null, `a plain branch is appended (${opened.kind})`)
  ok(
    readLaneNames(host.doc).length === lanesBefore,
    "a conversation thread has no lane",
  )

  // Five replies at once, all having seen the same end: a chain, not siblings.
  const replies = await Promise.all(
    ["one", "two", "three", "four", "five"].map(t =>
      (t.length % 2 === 0 ? alice : bob).chat(t, at(plumId)),
    ),
  )
  const index = tree()
  const below = (id: string | null) =>
    id === null ? 0 : (index.childrenOf.get(id)?.length ?? 0)
  const chain = ["one", "two", "three", "four", "five"].map(idOf)
  ok(
    replies.every(r => r.kind === "appended") &&
      [plumId, ...chain].every(id => below(id) <= 1),
    "five replies sent at once to one end form a chain, never siblings",
  )
  ok(
    readLaneNames(host.doc).length === lanesBefore,
    "plain chat in a conversation still makes no lane",
  )
  const content = readEntryMessage(host.doc, plumId ?? "")
  ok(
    content.present &&
      (content.message as { content?: unknown }).content ===
        "Alice: the secret word is PLUM",
    "the stored content carries the speaker",
  )

  // Spans cover what the author wrote, not the attributed content.
  if (plumId !== null) {
    const words = "the secret word is PLUM".length
    const inText = await bob.cite(
      { kind: "span", id: entryId(plumId), start: 19, end: words },
      at(plumId),
    )
    const pastText = await bob.cite(
      { kind: "span", id: entryId(plumId), start: 0, end: words + 1 },
      at(plumId),
    )
    ok(
      inText.kind === "referenced" && codeOf(pastText) === ERR.INVALID_SPAN,
      `a span of a chat message is over its text (${inText.kind}, ${codeOf(pastText)})`,
    )
  }

  // The agent, asked in the conversation, gets a lane there, and reads it.
  // The five replies arrived in whatever order: the end is measured, not assumed.
  const end = followTip(tree(), idOf("five") ?? "")
  const ask = await bob.chat(
    "@agent who told us a secret word, and what was it?",
    at(end),
  )
  ok(runOf(ask) !== "", `@agent in a conversation starts a run (${ask.kind})`)
  await idle()
  const asked = lanes().find(l =>
    projectTranscript(tree(), l.tip).some(m => m.text.includes("who told us")),
  )
  const path = shape(asked?.tip ?? null)
  ok(
    readLaneNames(host.doc).length === lanesBefore + 1 &&
      path.includes("Alice:the secret word is PLUM") &&
      path.at(-1) === "assistant",
    `a lane was created at the conversation's end, reading all of it (${path.length} messages)`,
  )
  const askId = idOf("@agent who told us a secret word, and what was it?")
  ok(
    askId !== null &&
      host.doc.entries.get(askId)?.parentId === end &&
      Object.values(readRenderableEntries(host.doc)).filter(e =>
        projectTranscript(tree(), e.id).at(-1)?.text?.includes("who told us"),
      ).length === 1,
    "the compelled message is the run's prompt, exactly once, where Bob was reading",
  )
  if (LIVE) {
    const reply =
      projectTranscript(tree(), asked?.tip ?? null).at(-1)?.text ?? ""
    console.log(`  agent said: ${JSON.stringify(reply)}`)
    ok(
      /plum/i.test(reply) && /alice/i.test(reply),
      "LIVE: the agent answered from both speakers' messages",
    )
  }
  invariants("conversation")
  await Promise.all([alice.close(), bob.close()])
}

// ── a busy thread: waiting, conflict, queue, branch (ADR-0020, S21) ───────
{
  const alice = await connect("q-alice")
  const bob = await connect("q-bob")
  const carol = await connect("q-carol")
  await Promise.all([
    alice.setName("Alice"),
    bob.setName("Bob"),
    carol.setName("Carol"),
  ])
  // A long answer, so the lane is still running when Bob and Carol send.
  const QUESTION = "name a fruit, then write four sentences about it"
  const start = await alice.chat(QUESTION, ROOT)
  ok(runOf(start) !== "", "Alice's question starts a thread's run")
  await waitFor(() => idOf(QUESTION) !== null)
  const promptId = idOf(QUESTION)
  // A conversation from here: only a mention compels, so Bob's remark is plain.
  if (promptId !== null)
    await alice.setThreadMode(entryId(promptId), "conversation")
  // What Bob and Carol see: the thread ends at Alice's question.
  const bobRemark = await bob.chat("plain remark", at(promptId))
  const carolAsk = await carol.chat("@agent name a colour", at(promptId))
  ok(
    bobRemark.kind === "queued",
    `a plain message to a running lane waits (${bobRemark.kind})`,
  )
  ok(
    carolAsk.kind === "conflict" && carolAsk.by === "Alice",
    `a compelled reply to a busy lane is a conflict, naming who holds it (${carolAsk.kind}${carolAsk.kind === "conflict" ? `: ${carolAsk.by}` : ""})`,
  )
  const queued = await carol.chat("@agent name a colour", at(promptId), "queue")
  ok(
    queued.kind === "queued" && queued.position === 1,
    `queue waits behind the message already waiting (${queued.kind}${queued.kind === "queued" ? ` ${queued.position}` : ""})`,
  )
  ok(readOutbox(host.doc).length === 2, "the outbox shows both, to everyone")
  await idle()
  const thread = lanes().find(l =>
    projectTranscript(tree(), l.tip).some(m => m.text === QUESTION),
  )
  const path = shape(thread?.tip ?? null)
  ok(
    path.join(" → ") ===
      `Alice:${QUESTION} → assistant → Bob:plain remark → Carol:@agent name a colour → assistant`,
    `in send order, with no reply to the plain remark: ${path.join(" → ")}`,
  )

  // A race with the lane idle: Bob saw the end before Carol's question; Carol's
  // compelled message is below it now, so his compelled reply is a conflict.
  const bobAsk = await bob.chat(
    "@agent and a number?",
    at(idOf("plain remark")),
  )
  ok(
    bobAsk.kind === "conflict" && bobAsk.by === "Carol",
    `another writer's compelled message below what I saw is a race (${bobAsk.kind})`,
  )
  // My own question and the agent's reply to it are not a race for me: Dan
  // asks, the reply lands, and Dan follows up from where he last looked.
  const dan = await connect("q-dan")
  await dan.chat("@agent name a car", ROOT)
  await waitFor(() => idOf("@agent name a car") !== null)
  const carId = idOf("@agent name a car")
  await idle()
  const followUp = await dan.chat("@agent and a bike?", at(carId))
  ok(
    runOf(followUp) !== "",
    `following up past my own question and its reply runs, no conflict (${followUp.kind})`,
  )
  await idle()
  await dan.close()

  // Branch, instead of queueing: a separate line of work that runs at once.
  const lanesBefore = readLaneNames(host.doc).length
  let both = false
  const busy = await alice.chat(
    "@agent write four sentences about trees",
    at(thread?.tip ?? null),
  )
  const watch = setInterval(() => {
    if (Object.keys(host.doc.activeRuns()).length >= 2) both = true
  }, 5)
  const branched = await bob.chat(
    "@agent separately: a tree?",
    at(promptId),
    "branch",
  )
  await idle()
  clearInterval(watch)
  ok(
    runOf(busy) !== "" &&
      runOf(branched) !== "" &&
      readLaneNames(host.doc).length === lanesBefore + 1,
    "branching on a conflict starts a new lane where the sender was reading",
  )
  ok(both, "the branch ran while the thread it forked from was running")
  invariants("busy thread")
  await Promise.all([alice.close(), bob.close(), carol.close()])
}

// ── thread rules ──────────────────────────────────────────────────────────
{
  const w = await connect("r-writer")
  const plumId = idOf("the secret word is PLUM")
  const setSession =
    plumId === null
      ? undefined
      : await w.setThreadMode(entryId(plumId), "session")
  ok(setSession?.kind === "threaded", "a thread becomes a working session")
  const inSession = await w.chat(
    "summarise, please",
    at(idOf("five")),
    "branch",
  )
  ok(
    runOf(inSession) !== "",
    `in a working session a plain message runs (${inSession.kind})`,
  )
  await idle()
  const noThread = await w.setThreadMode(entryId("no-such-entry"), "session")
  ok(
    codeOf(noThread) === ERR.UNKNOWN_TARGET,
    `a thread at an unknown entry is refused (${codeOf(noThread)})`,
  )
  invariants("rules")
  await w.close()
}

// ── references (ADR-0017) ─────────────────────────────────────────────────
{
  const pw = await connect("ref-p")
  const qw = await connect("ref-q")
  const cited = idOf("hello")
  ok(cited !== null, "there is a message to cite")
  if (cited !== null) {
    const r = await qw.cite(
      { kind: "entry", id: entryId(cited) },
      at(trunkTip()),
    )
    ok(
      r.kind === "referenced",
      `a citation is written (${codeOf(r) || r.kind})`,
    )
    const back = readReferences(host.doc).to.get(entryId(cited)) ?? []
    ok(
      back.length === 1 && back[0]?.author === qw.writer,
      `the message shows one backlink, authored by its writer (${back.length})`,
    )
    ok(
      back[0]?.from === trunkTip(),
      "the reference is attached where its author was reading",
    )
    const [x, y] = await Promise.all([
      pw.cite({ kind: "entry", id: entryId(cited) }, at(trunkTip())),
      qw.cite({ kind: "entry", id: entryId(cited) }, at(trunkTip())),
    ])
    const after = readReferences(host.doc).to.get(entryId(cited)) ?? []
    ok(
      x.kind === "referenced" && y.kind === "referenced" && after.length === 3,
      `two concurrent citations of one entry both survive (${after.length})`,
    )
    const rooted = await qw.cite({ kind: "entry", id: entryId(cited) }, ROOT)
    ok(
      codeOf(rooted) === ERR.NO_ANCHOR,
      `a citation from the root is refused (${codeOf(rooted)})`,
    )
    const lost = await qw.cite(
      { kind: "entry", id: entryId("no-such-entry") },
      at(trunkTip()),
    )
    ok(
      codeOf(lost) === ERR.UNKNOWN_TARGET,
      `an unknown target is refused (${codeOf(lost)})`,
    )
  }
  await Promise.all([pw.close(), qw.close()])
}

// ── LIVE: what the model says ─────────────────────────────────────────────
if (LIVE) {
  console.log("\n--- live turn ---")
  const known = new Set(readLaneNames(host.doc))
  const r = await client.chat(PROMPT, ROOT)
  ok(runOf(r) !== "", "live prompt accepted")
  await idle()
  const lane = readLaneNames(host.doc).find(l => !known.has(l)) ?? ""
  const last = projectTranscript(tree(), readLaneTip(host.doc, lane)).at(-1)
  console.log(`  model said: ${JSON.stringify(last?.text)}`)
  ok(
    last?.role === "assistant" && last.text.includes("PINETA-OK"),
    "the model's reply contains the requested token",
  )
}

invariants("end")

// Shut the client down first, then let the socket settle before tearing down
// the host: otherwise the host's transport decodes a frame against an
// already-disposed pipeline and logs a harmless "Pipeline disposed".
await client.close()
await sleep(100)
await host.shutdown()

report("e2e")
