// e2e — drive the WHOLE system without a browser.
//
// This is the CI-runnable proof. It uses client/session-view.ts unmodified —
// the same module the browser bundle uses — and reads the document through
// `@pineta/reads`, the same reads the host decides from. Node's global
// WebSocket stands in for the browser's. What is NOT exercised: any browser
// runtime.
//
//   pnpm run e2e        offline: every host's model is scripted
//   pnpm run e2e:live   also asks a real model once, and checks its words
//
// Every section but the live one runs on a scripted model, so its steps are
// repeatable, cost nothing and need no key (ADR-0041). No section uses the
// person's pi setup.

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { request as httpRequest } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { Exchange, type Store, whenPeer } from "@kyneta/exchange"
import { batch, subscribe } from "@kyneta/schema"
import { WebsocketClientTransport } from "@kyneta/websocket-transport/browser"
import type { SessionClient } from "@pineta/client/session"
import {
  ancestry,
  atEntry,
  type CardId,
  cardId,
  ERR,
  entryId,
  findSeqKeys,
  followTip,
  type ImageRef,
  laneNameForThread,
  messageText,
  NOBODY,
  type Position,
  projectRail,
  projectSpine,
  projectTranscript,
  ROOT,
  writerId,
} from "@pineta/core"
import { decodeChat, displayName, yourCard } from "@pineta/marginalia"
import { newId as newHeldId, scriptedModel, sha256Of } from "@pineta/pi"
import { decodeReply, encodeIntent, type Outcome } from "@pineta/protocol/codec"
import { Control } from "@pineta/protocol/line"
import {
  CONTROL_TOPIC,
  HOST_PRINCIPAL,
  PRESENCE_DOC_ID,
  SESSION_DOC_ID,
} from "@pineta/protocol/messages"
import {
  readArchive,
  readBanners,
  readCards,
  readCommands,
  readLaneRecords,
  readLanes,
  readMarks,
  readOffers,
  readOutbox,
  readParticipantNames,
  readProject,
  readReading,
  readRenderableEntries,
  readSeats,
  readTreeIndex,
  readTyping,
} from "@pineta/reads"
import {
  cardDocId,
  readActiveRun,
  readEntries,
  readEntryMessage,
  readLaneNames,
  readLaneTip,
  readStreams,
  rowMessage,
  writeEntry,
} from "@pineta/schema"
import { WebSocket as WsClient } from "ws"
import { startHost } from "../host/index.ts"
import { lineDocPrefix } from "../host/lines.ts"
import { openStore } from "../host/store.ts"
import { createChecks } from "./checks.ts"
import { committedProject, join, suiteModel, waitFor } from "./harness.ts"
import {
  BLUE_PNG,
  GREEN_PNG,
  imageSize,
  RED_PNG,
  YELLOW_PNG,
} from "./images.ts"

const LIVE = process.env.PINETA_LIVE === "1"
const PROMPT = "Say exactly: PINETA-OK"
/** The suites' own real model: never the person's pi setup, which costs them. */
const LIVE_MODEL = {
  kind: "named",
  provider: "cerebras",
  model: "qwen-3.8-27b",
} as const

const { ok, report } = createChecks()
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

console.log(
  `=== Pineta — end to end (${LIVE ? "LIVE model" : "offline"}) ===\n`,
)

const script = suiteModel()
const host = await startHost({
  port: 0,
  model: { kind: "scripted", script },
  log: m => console.log(m),
})
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
/**
 * A document's records in a Kyneta store, and their payloads' size, read
 * through the store itself: it owns its SQLite file, so no second connection
 * may read it (S47). The store also holds each client's command Line, which
 * the host does not compact (see `settle`), so callers count one document.
 */
const storedRecords = async (
  store: Store,
  docId: string,
): Promise<{ records: number; bytes: number }> => {
  let records = 0
  let bytes = 0
  for await (const r of store.loadAll(docId)) {
    records++
    bytes += r.kind === "entry" ? r.payload.data.length : 0
  }
  return { records, bytes }
}
/** Whether any of the session's records in `store` holds `text`. */
const recordsHold = async (store: Store, text: string): Promise<boolean> => {
  for await (const r of store.loadAll(SESSION_DOC_ID))
    if (
      r.kind === "entry" &&
      Buffer.from(r.payload.data as Uint8Array | string)
        .toString("latin1")
        .includes(text)
    )
      return true
  return false
}
/** Every command Line document a store holds. */
const storedLines = async (store: Store): Promise<string[]> => {
  const ids: string[] = []
  for await (const id of store.listDocIds(lineDocPrefix(CONTROL_TOPIC)))
    ids.push(id)
  return ids
}
/**
 * How late `slowToLoad` makes a load: several times a host's start (12 to
 * 57 ms measured), so a host that does not wait for the load is still seen
 * with the document empty.
 */
const LATE_LOAD_MS = 300
/**
 * `store`, with `docId`'s first load taking `ms` longer. Kyneta's hydration
 * reads `currentMeta` before `loadAll`, so only the first `currentMeta` of
 * `docId` waits: compaction's `loadAll` and other documents' loads do not. A
 * proxy, so everything else, its seat included, is the store's own.
 */
const slowToLoad = (store: Store, docId: string, ms: number): Store => {
  let delayed = false
  return new Proxy(store, {
    get(target, key, receiver) {
      if (key === "currentMeta")
        return async (id: string) => {
          if (id === docId && !delayed) {
            delayed = true
            await sleep(ms)
          }
          return target.currentMeta(id)
        }
      const value = Reflect.get(target, key, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}
/** A session's size as it stands: what a compacted store should hold. */
const sessionBytes = (doc: typeof host.doc): number =>
  JSON.stringify({
    entries: doc.entries(),
    usageRows: doc.usageRows(),
    values: doc.values(),
    lists: doc.lists(),
  }).length
/** In `doc`, the id of the message whose text is exactly `text`. */
const idOfIn = (doc: typeof host.doc, text: string): string | null => {
  const index = readTreeIndex(doc)
  return (
    Object.keys(index.entries).find(
      id => projectTranscript(index, id).at(-1)?.text === text,
    ) ?? null
  )
}
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
const connect = (name: string, onChange?: () => void) =>
  join(host, name, "main", { onChange })
/** An unnamed person's mention handle: their screen label, from their email. */
const handleOfUnnamed = (w: Parameters<typeof displayName>[0]) =>
  displayName(w, undefined)
/** How the two starts send at the root (ADR-0021). */
const START_AGENT = { mode: "branch", asksAgent: true } as const
const START_CHAT = { mode: "branch" } as const
const BRANCH = { mode: "branch" } as const
const entryCount = () => Object.keys(readEntries(host.doc)).length

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
// Every reply stream's text at each change of the host's document, by stream:
// each assistant message is its own stream, so growth is judged within one.
// Sampled on the host's own changes, so every edit is seen, however many a
// client's sync folds together.
const streamSamples = new Map<string, string[]>()
const unsample = subscribe(host.doc, () => {
  for (const s of readStreams(host.doc))
    if (s.kind === "reply")
      streamSamples.set(s.id, [...(streamSamples.get(s.id) ?? []), s.text])
})
const client: SessionClient = await connect("e2e-client")
ok(true, "client connected over a real websocket and opened the document")

// Who a client is comes from the principal its connection named (ADR-0037).
// One that is not an email names nobody: the host refuses its every command.
{
  const stranger = new Exchange({
    principal: "nobody-in-particular",
    transports: [
      new WebsocketClientTransport({
        url: host.wsUrl,
        WebSocket,
        reconnect: { enabled: false },
      }),
    ],
  })
  const hostSeat = await whenPeer(stranger, p => p.principal === HOST_PRINCIPAL)
  const replies = Control.claimReceiver(stranger, hostSeat.peerId)
  Control.sender(stranger, hostSeat.peerId).send(
    encodeIntent("stranger-1", { kind: "name", name: "Stranger" }),
  )
  const reply = await Promise.race([
    (async () => {
      for await (const r of replies) return decodeReply(r)
    })(),
    sleep(5_000).then(() => undefined),
  ])
  await stranger.shutdown()
  ok(
    reply !== undefined && codeOf(reply) === ERR.INVALID_IDENTITY,
    `a client whose principal is not an email is refused (${reply === undefined ? "no reply" : codeOf(reply)})`,
  )
}

const rejected = await client.chat("   ", ROOT)
ok(
  codeOf(rejected) === ERR.EMPTY_MESSAGE,
  `an empty message is structurally rejected: ${codeOf(rejected)}`,
)

// Start Agent: a first message with no mention asks the agent, and the first
// compelled message in a thread creates that thread's lane.
const HELLO_SEND = crypto.randomUUID()
const hello = await client.chat("hello", ROOT, {
  ...START_AGENT,
  id: HELLO_SEND,
})
ok(
  runOf(hello) !== "",
  `a Start Agent message starts a run (${runOf(hello).slice(-8)})`,
)
await idle()
ok(
  tree().bySend.get(HELLO_SEND) === idOf("hello"),
  "the message carries its send's id, so its column can find it",
)
ok(
  client.writer === writerId("e2e-client@main.test") &&
    tree().entries[idOf("hello") ?? ""]?.message?.writer === client.writer,
  "a message's writer is the email its client connected as",
)

const firstLanes = readLaneNames(host.doc)
ok(
  firstLanes.length === 1 && firstLanes[0]?.startsWith("t-") === true,
  `the thread got a lane of its own: ${firstLanes.join(",")}`,
)
ok(
  !firstLanes.some(l => l.includes(client.principal)),
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

// ADR-0014: the stream went through Schema.text(), and none is left once the
// run ends.
unsample()
const samples = [...streamSamples.values()]
ok(
  samples.flat().length > 0,
  `the client saw ${samples.flat().length} live streaming updates`,
)
ok(
  samples.every(texts =>
    texts.every((s, i) => {
      const previous = texts[i - 1]
      return previous === undefined || s.startsWith(previous)
    }),
  ),
  "each reply streamed by appending (edits, never a whole-value replace)",
)
ok(
  readActiveRun(host.doc, trunk) === undefined &&
    readStreams(host.doc).length === 0,
  "when the run ended, the lane had no streams",
)

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
{
  const lanesBefore = readLaneNames(host.doc).length
  const chat = await client.chat("just us here", ROOT, START_CHAT)
  ok(
    chat.kind === "appended" && readLaneNames(host.doc).length === lanesBefore,
    `a Start Chat message makes no lane (${chat.kind})`,
  )
  const rootReply = await client.chat("where does this go?", ROOT)
  ok(
    codeOf(rootReply) === ERR.NO_ANCHOR,
    `only a branch starts at the root; a reply there is refused (${codeOf(rootReply)})`,
  )
}
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
  // The first run's end compacted the session; the thread runs on after it,
  // reading its whole path in order, and a client that stayed connected
  // follows (ADR-0023).
  await host.quiet()
  const path = projectTranscript(tree(), trunkTip()).map(m => m.id)
  const again = await client.chat("after a compaction", at(trunkTip()))
  await idle()
  await host.quiet()
  const next = projectTranscript(tree(), trunkTip()).map(m => m.id)
  ok(
    runOf(again) !== "" &&
      next.slice(0, path.length).join() === path.join() &&
      next.length > path.length,
    `a thread runs on after a compaction, its path in order (${path.length} -> ${next.length} messages)`,
  )
  await waitFor(
    () =>
      projectTranscript(readTreeIndex(client.doc), trunkTip()).length ===
      next.length,
  )
  ok(
    projectTranscript(readTreeIndex(client.doc), trunkTip()).length ===
      next.length,
    "a client connected across compactions follows the thread",
  )
  const late = await connect("after-compactions")
  await waitFor(
    () =>
      Object.keys(late.doc.entries()).length ===
      Object.keys(host.doc.entries()).length,
  )
  ok(
    Object.keys(late.doc.entries()).length ===
      Object.keys(host.doc.entries()).length,
    `a client connecting after compactions receives the whole session (${Object.keys(late.doc.entries()).length} entries)`,
  )
  await late.close()
  invariants("reply")
}

// ── branch: a fork made on purpose ────────────────────────────────────────
{
  const helloId = idOf("hello")
  const trunkBefore = shape(trunkTip())
  const known = new Set(Object.keys(readEntries(host.doc)))
  const fork = await client.chat("@agent BRANCH-OK", at(helloId), BRANCH)
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
  const lost = await client.chat("into the void", at("no-such-entry"), BRANCH)
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
    a.chat("WRITER-A says hello", ROOT, START_AGENT),
    b.chat("WRITER-B says hello", ROOT, START_AGENT),
  ])
  ok(
    runOf(ra) !== "" && runOf(rb) !== "",
    "two new agent threads each start their own run",
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
  // A command Line is between the host and one seat: no client holds
  // another's commands or replies (ADR-0037).
  const othersLines = [a, b].flatMap(c =>
    [...c.exchange.documents.keys()].filter(
      id => id.startsWith("line:") && !id.includes(c.exchange.peerId),
    ),
  )
  ok(
    othersLines.length === 0,
    `no client holds another's command Line (${othersLines.length} held)`,
  )
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

  // A branch is a conversation: made on purpose from the first message, with
  // no lane, though the thread it leaves is agent work (ADR-0021).
  const helloId = idOf("hello")
  const lanesBefore = readLaneNames(host.doc).length
  const opened = await alice.chat(
    "the secret word is PLUM",
    at(helloId),
    BRANCH,
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

  // The agent, asked in the conversation, gets a lane there, and reads it.
  // The five replies arrived in whatever order: the end is measured, not assumed.
  const end = followTip(tree(), idOf("five") ?? "")
  // The reply echoes what the model was given before the prompt, which a
  // real model would read; the prompt itself is left out, so it shows once.
  script.use([{ reply: context => context.slice(0, -1).join("\n") }])
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
  const given = projectTranscript(tree(), asked?.tip ?? null).at(-1)?.text ?? ""
  ok(
    given.includes("Alice: the secret word is PLUM") &&
      given.includes("Bob: one"),
    "the agent is given every speaker's messages, attributed",
  )
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
  const REMARK = "@Carol plain remark"
  // Its reply is paused, so the lane is still running when Bob and Carol send.
  const QUESTION = "name a fruit, then write four sentences about it"
  const answering = script.pause(QUESTION)
  const start = await alice.chat(QUESTION, ROOT, START_AGENT)
  ok(runOf(start) !== "", "Alice's question starts a thread's run")
  await waitFor(() => answering.reached, 10_000)
  const promptId = idOf(QUESTION)
  // This thread is agent work; Bob's remark names Carol, so it is for her only.
  // What Bob and Carol see: the thread ends at Alice's question.
  const bobRemark = await bob.chat(REMARK, at(promptId))
  const carolAsk = await carol.chat("@agent name a colour", at(promptId))
  ok(
    bobRemark.kind === "queued",
    `a plain message to a running lane waits (${bobRemark.kind})`,
  )
  ok(
    carolAsk.kind === "conflict" && carolAsk.by === alice.writer,
    `a compelled reply to a busy lane is a conflict, naming who holds it (${carolAsk.kind}${carolAsk.kind === "conflict" ? `: ${carolAsk.by}` : ""})`,
  )
  const queued = await carol.chat("@agent name a colour", at(promptId), {
    mode: "queue",
  })
  ok(
    queued.kind === "queued" && queued.position === 1,
    `queue waits behind the message already waiting (${queued.kind}${queued.kind === "queued" ? ` ${queued.position}` : ""})`,
  )
  ok(readOutbox(host.doc).length === 2, "the outbox shows both, to everyone")
  answering.resume()
  await idle()
  const thread = lanes().find(l =>
    projectTranscript(tree(), l.tip).some(m => m.text === QUESTION),
  )
  const path = shape(thread?.tip ?? null)
  ok(
    path.join(" → ") ===
      `Alice:${QUESTION} → assistant → Bob:${REMARK} → Carol:@agent name a colour → assistant`,
    `in send order, with no reply to the plain remark: ${path.join(" → ")}`,
  )

  // A race with the lane idle: Bob saw the end before Carol's question; Carol's
  // compelled message is below it now, so his compelled reply is a conflict.
  const bobAsk = await bob.chat("@agent and a number?", at(idOf(REMARK)))
  ok(
    bobAsk.kind === "conflict" && bobAsk.by === carol.writer,
    `another writer's compelled message below what I saw is a race (${bobAsk.kind})`,
  )
  // My own question and the agent's reply to it are not a race for me: Dan
  // asks, the reply lands, and Dan follows up from where he last looked.
  const dan = await connect("q-dan")
  await dan.chat("@agent name a car", ROOT, START_CHAT)
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
  const trees = script.pause("write four sentences about trees")
  const aside = script.pause("separately: a tree?")
  const busy = await alice.chat(
    "@agent write four sentences about trees",
    at(thread?.tip ?? null),
  )
  const branched = await bob.chat(
    "@agent separately: a tree?",
    at(promptId),
    BRANCH,
  )
  await waitFor(() => trees.reached && aside.reached, 10_000)
  const both = Object.keys(host.doc.activeRuns()).length >= 2
  trees.resume()
  aside.resume()
  await idle()
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

// ── mentions pick the addressee (ADR-0021) ────────────────────────────────
{
  const w = await connect("m-writer")
  await w.setName("Wes")
  await idle()
  const send = async (text: string) => {
    const r = await w.chat(text, at(trunkTip()))
    await idle()
    return r
  }
  // The trunk has a lane: a message naming no one asks the agent.
  const toBob = await send("@Bob look at this")
  ok(
    toBob.kind === "appended",
    `in agent work, a message naming only a person is for them: no run (${toBob.kind})`,
  )
  const unnamed = handleOfUnnamed(client.writer)
  const toUnnamed = await send(`@${unnamed} see above`)
  ok(
    toUnnamed.kind === "appended",
    `someone unnamed is mentioned by the label the screen shows, @${unnamed} (${toUnnamed.kind})`,
  )
  const unknown = await send("bump @types/node please")
  ok(
    runOf(unknown) !== "",
    `a handle naming no participant is ignored: the agent is still asked (${unknown.kind})`,
  )
  const both = await send("@agent @Bob thoughts?")
  ok(runOf(both) !== "", `@agent with a person asks the agent (${both.kind})`)
  invariants("mentions")
  await w.close()
}

// ── stepping down at the end (ADR-0021) ───────────────────────────────────
{
  const w = await connect("s-writer")
  const T = trunkTip()
  const lanesBefore = readLaneNames(host.doc).length
  // A branch at the lane's tip is a conversation continuing from its end.
  const down = await w.chat("off the record", at(T), BRANCH)
  const convId = down.kind === "appended" ? down.id : null
  ok(
    convId !== null &&
      host.doc.entries.get(convId)?.parentId === T &&
      trunkTip() === T &&
      readLaneNames(host.doc).length === lanesBefore,
    `a plain branch at a lane's tip is a lane-less child of it; the lane stays (${down.kind})`,
  )
  // The conversation is now the newest leaf below T. A send naming the lane
  // still continues the lane: the agent thread's column knows its thread.
  const trunkLane = lanes().find(l => l.name === trunk)?.name
  const onLane = await w.chat("@agent go on", at(T), {
    ...(trunkLane === undefined ? {} : { lane: trunkLane }),
  })
  await idle()
  const goOn = idOf("@agent go on")
  ok(
    runOf(onLane) !== "" &&
      goOn !== null &&
      host.doc.entries.get(goOn)?.parentId === T &&
      ancestry(tree(), trunkTip()).path.includes(goOn),
    `a send naming the lane runs on it, past the newer conversation (${onLane.kind})`,
  )
  const inConv = await w.chat("still here", at(convId))
  ok(
    inConv.kind === "appended" &&
      host.doc.entries.get(inConv.id)?.parentId === convId,
    `a reply in the conversation stays in it (${inConv.kind})`,
  )
  const asked = await w.chat("@agent summarise us", at(idOf("still here")))
  await idle()
  const second = lanes().find(l =>
    projectTranscript(tree(), l.tip).some(
      m => m.text === "@agent summarise us",
    ),
  )
  ok(
    runOf(asked) !== "" &&
      readLaneNames(host.doc).length === lanesBefore + 1 &&
      second?.tip != null &&
      ancestry(tree(), second.tip).path.includes(T ?? ""),
    "@agent in the conversation makes its own lane, reading the agent thread above",
  )
  const count = entryCount()
  const nowhere = await w.chat("lost", at(trunkTip()), {
    lane: laneNameForThread("no-such-lane"),
  })
  ok(
    codeOf(nowhere) === ERR.UNKNOWN_TARGET && entryCount() === count,
    `a send naming an unknown lane is refused, writing nothing (${codeOf(nowhere)})`,
  )
  invariants("stepping down")
  await w.close()
}

// ── LIVE: what the model says ─────────────────────────────────────────────
if (LIVE) {
  console.log("\n--- live turn ---")
  const live = await startHost({
    port: 0,
    model: LIVE_MODEL,
    log: () => {},
  })
  const asker = await join(live, "asker", "live")
  const r = await asker.chat(PROMPT, ROOT, START_AGENT)
  ok(runOf(r) !== "", "live prompt accepted")
  await waitFor(() => Object.keys(live.doc.activeRuns()).length === 0, 120_000)
  const [lane] = readLaneNames(live.doc)
  const last = projectTranscript(
    readTreeIndex(live.doc),
    lane === undefined ? null : readLaneTip(live.doc, lane),
  ).at(-1)
  console.log(`  model said: ${JSON.stringify(last?.text)}`)
  ok(
    last?.role === "assistant" && last.text.includes("PINETA-OK"),
    "the model's reply contains the requested token",
  )
  // A pasted image reaches a real model (ADR-0042): it says what it shows.
  const uploaded = await fetch(`${live.httpUrl}blob`, {
    method: "POST",
    headers: { "content-type": "image/png" },
    body: new Uint8Array(RED_PNG),
  })
  const red = (await uploaded.json()) as ImageRef
  const shown = await asker.chat(
    `What colour is this image? Answer in one word. ![square](/blob/${red.sha256})`,
    ROOT,
    START_AGENT,
  )
  await waitFor(() => Object.keys(live.doc.activeRuns()).length === 0, 120_000)
  // A Start Agent message begins a thread of its own: its lane is the new one.
  const imageLane = readLaneNames(live.doc).find(l => l !== lane)
  const seenBy = projectTranscript(
    readTreeIndex(live.doc),
    imageLane === undefined ? null : readLaneTip(live.doc, imageLane),
  ).at(-1)
  console.log(`  model said of the image: ${JSON.stringify(seenBy?.text)}`)
  ok(
    runOf(shown) !== "" &&
      seenBy?.role === "assistant" &&
      /red/i.test(seenBy.text),
    "a real model reads a pasted image: it names its colour",
  )
  await asker.close()
  await live.shutdown()

  // A banner drawn by the real image model: a square icon, as the request's
  // `aspect_ratio` of 1:1 asks (ADR-0053).
  const bannerConfig = path.join(
    mkdtempSync(path.join(tmpdir(), "pineta-live-banner-")),
    "config.json",
  )
  writeFileSync(bannerConfig, JSON.stringify({ banner: { enabled: true } }))
  const bannerLog: string[] = []
  const drawing = await startHost({
    port: 0,
    model: LIVE_MODEL,
    userConfig: bannerConfig,
    log: line => bannerLog.push(line),
  })
  const painter = await join(drawing, "painter", "live")
  await painter.chat(
    "Name three birds of spring marshes, in one line.",
    ROOT,
    START_AGENT,
  )
  await waitFor(
    () => Object.keys(drawing.doc.activeRuns()).length === 0,
    120_000,
  )
  await waitFor(() => readBanners(drawing.doc).size > 0, 120_000)
  await drawing.quiet()
  const [banner] = readBanners(drawing.doc).values()
  const served =
    banner === undefined
      ? null
      : await fetch(`${drawing.httpUrl}blob/${banner.sha}`)
  const bytes = served === null ? null : Buffer.from(await served.arrayBuffer())
  const size = bytes === null ? null : imageSize(bytes)
  console.log(
    `  banner: ${JSON.stringify(size)} ${served?.headers.get("content-type")} ${bannerLog.filter(l => l.includes("banner")).join(" | ")}`,
  )
  ok(
    served?.status === 200 && size !== null && size.width === size.height,
    `a real image model draws a thread's banner, square as its request asks (${size?.width}×${size?.height})`,
  )
  await painter.close()
  await drawing.shutdown()
}

invariants("end")

// ── tools: the agent reads, writes, edits and runs, visibly (ADR-0022) ────
// A second host with a scripted model, tools in a temporary directory, and its
// session in a SQLite file, so every step is repeatable and spends nothing.
{
  const work = committedProject("pineta-tools-", {
    "notes.txt": "the secret word is MANGO\n",
  })
  const dbFile = path.join(
    mkdtempSync(path.join(tmpdir(), "pineta-db-")),
    "pineta.db",
  )
  const script = scriptedModel()
  // The suite opens the store itself, so it can read it while the host runs.
  let opened = openStore(dbFile)
  let stored = opened.store
  const open = (log: (m: string) => void, store: Store = stored) =>
    startHost({
      model: { kind: "scripted", script },
      tools: { project: work },
      // `verify` runs anywhere: lanes of their own are `e2e:lanes`'s.
      containers: false,
      store,
      blobs: opened.blobs,
      log,
    })
  let th = await open(() => {})
  const tidle = () =>
    waitFor(
      () =>
        Object.keys(th.doc.activeRuns()).length === 0 &&
        readOutbox(th.doc).length === 0,
      60_000,
    )
  const ttree = () => readTreeIndex(th.doc)
  const tlane = () => readLanes(th.doc, ttree())[0]
  // Every open stream at each change of the host's document.
  const watched: ReturnType<typeof readStreams>[] = []
  const watch = () =>
    subscribe(th.doc, () => watched.push([...readStreams(th.doc)]))
  let unwatch = watch()
  const u = await join(th, "uma", "tools")
  await u.setName("Uma")

  // 1. Read a file, then answer.
  script.use([
    { text: "Let me look.", tool: "read", args: { path: "notes.txt" } },
    { text: "It says MANGO." },
  ])
  const asked = await u.chat("what is in notes?", ROOT, START_AGENT)
  await tidle()
  const spine = projectSpine(ttree(), tlane()?.tip ?? null).spine
  const call = spine.find(n => n.toolCalls !== undefined)?.toolCalls?.[0]
  ok(
    runOf(asked) !== "" &&
      call?.label === "read notes.txt" &&
      call.result?.text.includes("MANGO") === true &&
      call.result.isError === false,
    `a read is stored as a call paired with its result (${call?.label ?? "none"})`,
  )
  const dots = projectRail(ttree(), spine[0]?.id ?? "").length
  ok(
    dots === spine.length && spine.length === 3,
    `the rail has one row per message, none per tool result (${dots})`,
  )

  // 2. Write a file, then edit it: the disk changes.
  script.use([
    { tool: "write", args: { path: "new.txt", content: "alpha\n" } },
    {
      tool: "edit",
      args: { path: "new.txt", edits: [{ oldText: "alpha", newText: "beta" }] },
    },
    { text: "done" },
  ])
  const lane = tlane()
  await u.chat("make new.txt", at(lane?.tip ?? null), { lane: lane?.name })
  await tidle()
  // This host has no containers, so the lane works directly in the project.
  // A lane of its own is `e2e:lanes`'s.
  const written = path.join(work, "new.txt")
  ok(
    lane !== undefined &&
      existsSync(written) &&
      readFileSync(written, "utf8") === "beta\n",
    "the agent wrote a file, then edited it, working directly in the project",
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
  ok(
    toolTexts.length > 3 &&
      lastLive.length > 0 &&
      result.includes(lastLive.slice(-300)),
    `a running command's output streamed live (${toolTexts.length} updates), matching its result`,
  )
  ok(
    readStreams(th.doc).length === 0,
    "when the run ended, the lane had no streams",
  )
  ok(
    readOffers(th.doc).size === 0,
    "a thread working directly has no offer: its work is already in your files",
  )
  // The run's end compacted the session (ADR-0023): the store holds the
  // document as it stands, not the run's edits. Whole-value streams are guarded
  // by `planStream`'s unit test, since compaction would hide them here.
  await th.quiet()
  const compacted = await storedRecords(stored, SESSION_DOC_ID)
  ok(
    compacted.records <= 3 && compacted.bytes <= 2 * sessionBytes(th.doc),
    `after the run, the store holds the compacted session: ${compacted.records} records, ${Math.round(compacted.bytes / 1024)} KB for a ${Math.round(sessionBytes(th.doc) / 1024)} KB session (${Math.round(printed / 1024)} KB printed)`,
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
  const replies = watched.map(open => open.filter(s => s.kind === "reply"))
  ok(
    replies.every(r => r.length <= 1) &&
      !replies
        .flat()
        .some(r => r.text.includes("First") && r.text.includes("Second")) &&
      new Set(replies.flat().map(r => r.id)).size === 2,
    "each assistant message streamed on its own; the first was never shown again",
  )

  // 5. Stop ends a running command; a message waiting is then taken.
  const bob = await join(th, "bob", "tools")
  await bob.setName("Bob")
  script.use([
    { tool: "bash", args: { command: "sleep 5; echo late" } },
    { text: "after" },
  ])
  const l5 = tlane()
  const t0 = Date.now()
  await u.chat("sleep", at(l5?.tip ?? null), { lane: l5?.name })
  await waitFor(() => readStreams(th.doc).some(s => s.kind === "tool"), 10_000)
  const waiting = await bob.chat("@Uma noted", at(tlane()?.tip ?? null), {
    lane: l5?.name,
  })
  const stopped = l5 === undefined ? undefined : await u.stop(l5.name)
  await tidle()
  const aborted = projectSpine(ttree(), tlane()?.tip ?? null)
    .spine.flatMap(n => n.toolCalls ?? [])
    .at(-1)
  ok(
    waiting.kind === "queued" &&
      stopped?.kind === "stopped" &&
      aborted?.result?.isError === true &&
      aborted.result.text.includes("aborted") &&
      Date.now() - t0 < 4_000,
    `stop ended the command at once, recorded as aborted (${aborted?.result?.text.slice(-20) ?? "none"})`,
  )
  ok(
    idOfIn(th.doc, "@Uma noted") !== null && readOutbox(th.doc).length === 0,
    "the message waiting for the lane was taken after the stop",
  )
  const again = l5 === undefined ? undefined : await u.stop(l5.name)
  const nowhere = await u.stop(laneNameForThread("no-such-lane"))
  ok(
    again?.kind === "stopped" && codeOf(nowhere) === ERR.UNKNOWN_TARGET,
    "stopping an idle lane is a no-op; an unknown lane is refused",
  )

  // 6. Restart over the same store: everything is there, and a held message
  // is drained by the new host's startup, since no run's end will.
  const before = {
    entries: Object.keys(th.doc.entries()).length,
    lanes: readLanes(th.doc, ttree()).map(l => `${l.name}@${l.tip}`),
    names: [...readParticipantNames(th.doc).values()].sort(),
  }
  const l6 = tlane()
  if (l6 !== undefined)
    await th.agent.hold({
      kind: "chat",
      id: newHeldId(),
      lane: l6.name,
      details: {
        author: u.writer,
        authorName: "Uma",
        text: "@Bob held across a restart",
        compels: NOBODY,
        sendId: "held-1",
      },
      timestamp: Date.now(),
    })
  // Written after the last compaction, so the store the next host opens holds
  // more than the compacted session: its startup must compact again.
  await u.setName("Uma, again")
  unwatch()
  // Bob leaves; Uma is still connected when the host stops.
  const bobSeat = bob.exchange.peerId
  const umaSeat = u.exchange.peerId
  await bob.close()
  const bobGone = await waitFor(
    async () => !(await storedLines(stored)).some(id => id.includes(bobSeat)),
    5_000,
  )
  await th.quiet()
  const beforeRestart = await storedRecords(stored, SESSION_DOC_ID)
  ok(
    bobGone >= 0 &&
      (await storedLines(stored)).some(id => id.includes(umaSeat)),
    "a client that leaves takes its command Line with it; one still here keeps it",
  )
  await th.shutdown()
  await u.close()
  // The session loads late, so a host that did not wait for it would start
  // from an empty session, and leave the held message undrained.
  opened = openStore(dbFile)
  stored = opened.store
  th = await open(() => {}, slowToLoad(stored, SESSION_DOC_ID, LATE_LOAD_MS))
  const linesAfter = await storedLines(stored)
  ok(
    linesAfter.length === 0,
    `a starting host keeps no command Line from before: no client can resume one (${linesAfter.length} stored)`,
  )
  unwatch = watch()
  await waitFor(
    () => idOfIn(th.doc, "@Bob held across a restart") !== null,
    15_000,
  )
  await th.quiet()
  const afterRestart = await storedRecords(stored, SESSION_DOC_ID)
  ok(
    beforeRestart.records > 3 && afterRestart.records <= 3,
    `a starting host compacts the session it opened (${beforeRestart.records} records -> ${afterRestart.records})`,
  )
  const after = {
    entries: Object.keys(th.doc.entries()).length - 1,
    lanes: readLanes(th.doc, ttree()).map(l => `${l.name}@${l.tip}`),
    names: [...readParticipantNames(th.doc).values()].sort(),
  }
  ok(
    JSON.stringify(after.names) ===
      JSON.stringify(
        before.names.map(n => (n === "Uma" ? "Uma, again" : n)).sort(),
      ) &&
      after.entries === before.entries &&
      readOutbox(th.doc).length === 0,
    `after a restart the session is all there, and the held message was drained (${after.entries} entries)`,
  )
  const u2 = await join(th, "uma", "tools")
  script.use([{ text: "back again" }])
  const l7 = tlane()
  const resumed = await u2.chat("still there?", at(l7?.tip ?? null), {
    lane: l7?.name,
  })
  await tidle()
  ok(
    runOf(resumed) !== "" &&
      projectTranscript(ttree(), tlane()?.tip ?? null).at(-1)?.text ===
        "back again" &&
      before.lanes.every(l => l.split("@")[0] === l7?.name),
    "the thread's lane resumes after a restart and runs again",
  )
  unwatch()
  await u2.close()
  await sleep(100)
  // The host's Exchange closes its stores when it shuts down, this one too.
  await th.shutdown()
}

// ── commands: your pi skills and prompts, /package:name (ADR-0036) ─────────
// A fixture pi directory whose settings list two packages; no containers.
{
  const fixtures = path.join(
    import.meta.dirname,
    "../../../packages/pi/fixtures",
  )
  const project = committedProject("pineta-commands-", { "a.txt": "a\n" })
  const script = scriptedModel()
  const ch = await startHost({
    model: { kind: "scripted", script },
    tools: { project },
    containers: false,
    agentDir: path.join(fixtures, "pi-agent"),
    userConfig: path.join(project, "no-user-config.json"),
    log: () => {},
  })
  const cu = await join(ch, "uma", "containers")
  await cu.setName("Uma")
  const cidle = () =>
    waitFor(
      () =>
        Object.keys(ch.doc.activeRuns()).length === 0 &&
        readOutbox(ch.doc).length === 0,
      60_000,
    )
  await waitFor(() => readCommands(ch.doc).length > 0, 10_000)
  ok(
    readCommands(ch.doc)
      .map(c => c.name)
      .includes("fixture:skill:hello") &&
      readCommands(ch.doc)
        .map(c => c.name)
        .includes("pi-other:skill:hello"),
    "the host lists every command its pi loaded, each under its package",
  )

  // A skill: the model reads pi's block and the arguments; people see what
  // was typed.
  let told = ""
  script.use([
    {
      reply: context => {
        told = context.at(-1) ?? ""
        return "said hello"
      },
    },
  ])
  const sent = await cu.chat("/fixture:skill:hello the world", ROOT, START_CHAT)
  await cidle()
  const hello = path.join(fixtures, "fixture-pkg", "skills", "hello")
  const typed = Object.values(readEntries(ch.doc))
    .map(
      r =>
        rowMessage(r) as {
          details?: { text?: string; command?: { name?: string } }
        },
    )
    .find(m => m.details?.command !== undefined)
  ok(
    sent.kind === "started" &&
      told.includes(
        `<skill name="hello" location="${hello}/SKILL.md">\nReferences are relative to ${hello}.`,
      ) &&
      told.includes("run `scripts/hello.sh`") &&
      told.trimEnd().endsWith("the world") &&
      typed?.details?.text === "/fixture:skill:hello the world" &&
      typed.details.command?.name === "fixture:skill:hello",
    `a skill command gives the model pi's block and its arguments, and is stored as typed (${told.slice(0, 60)})`,
  )

  // A prompt template, with its argument.
  script.use([
    {
      reply: context => {
        told = context.at(-1) ?? ""
        return "greeted"
      },
    },
  ])
  await cu.chat("/fixture:greet Ada", ROOT, START_CHAT)
  await cidle()
  ok(
    told.includes("Greet Ada warmly."),
    `a prompt command gives the model its template, with its arguments (${told})`,
  )

  const unknown = await cu.chat("/fixture:skill:nope", ROOT, START_CHAT)
  ok(
    unknown.kind === "refused" && unknown.code === ERR.UNKNOWN_COMMAND,
    "an unknown command is refused, naming it",
  )
  const plain = await cu.chat("/etc/hosts is odd", ROOT, BRANCH)
  ok(
    plain.kind === "appended",
    "a path at the start of a message is ordinary text",
  )
  await cu.close()
  await ch.shutdown()
}

// ── working directly: a lane in a directory you name (ADR-0032) ─────────────
// No containers here: lanes of their own are `e2e:lanes`'s. A lane asked to
// work directly does so wherever lanes of their own are available or not.
{
  const project = committedProject("pineta-direct-", {
    "shared.txt": "one\n",
  })
  const elsewhere = realpathSync(
    mkdtempSync(path.join(tmpdir(), "pineta-elsewhere-")),
  )
  const script = scriptedModel()
  const dh = await startHost({
    model: { kind: "scripted", script },
    tools: { project },
    containers: false,
    log: () => {},
  })
  const du = await join(dh, "uma", "direct")
  await du.setName("Uma")
  const didle = () =>
    waitFor(
      () =>
        Object.keys(dh.doc.activeRuns()).length === 0 &&
        readOutbox(dh.doc).length === 0,
      60_000,
    )
  const laneWith = (text: string) => {
    const id = idOfIn(dh.doc, text)
    const index = readTreeIndex(dh.doc)
    return readLanes(dh.doc, index).find(
      l => id !== null && ancestry(index, l.tip).path.includes(id),
    )
  }
  ok(
    readProject(dh.doc)?.kind === "direct",
    "a host with no containers says its lanes work directly",
  )

  // In the named directory; a branch below it works there too.
  script.use([
    { tool: "bash", args: { command: "pwd > here.txt" } },
    { text: "here" },
  ])
  await du.chat("work over there", ROOT, {
    ...START_AGENT,
    work: { kind: "direct", dir: elsewhere },
  })
  await didle()
  const direct = laneWith("work over there")
  script.use([{ text: "still here" }])
  await du.chat("@agent and below", at(direct?.tip ?? null), BRANCH)
  await didle()
  const below = laneWith("@agent and below")
  const records = readLaneRecords(dh.doc)
  ok(
    direct !== undefined &&
      existsSync(path.join(elsewhere, "here.txt")) &&
      readFileSync(path.join(elsewhere, "here.txt"), "utf8") ===
        `${elsewhere}\n` &&
      !existsSync(path.join(project, "here.txt")) &&
      below !== undefined &&
      below.name !== direct.name &&
      JSON.stringify(records.get(below.name)?.work) ===
        JSON.stringify({ kind: "direct", dir: elsewhere }),
    "a lane working directly writes in its directory, and a branch below inherits it",
  )

  const nowhere = await du.chat("work nowhere", ROOT, {
    ...START_AGENT,
    work: { kind: "direct", dir: path.join(elsewhere, "missing") },
  })
  ok(
    nowhere.kind === "refused" && nowhere.code === ERR.BAD_DIRECTORY,
    "a thread asked to work directly in a directory that does not exist is refused",
  )
  await du.close()
  await dh.shutdown()
}

// ── cards: what you type, kept on its thread (ADR-0048) ──────────────────────
// Its own host, with a store to restart over.
{
  const dbFile = path.join(
    mkdtempSync(path.join(tmpdir(), "pineta-cards-")),
    "pineta.db",
  )
  const script = scriptedModel()
  const open = () =>
    startHost({
      model: { kind: "scripted", script },
      store: dbFile,
      log: () => {},
    })
  let ch = await open()
  const ada = await join(ch, "ada", "cards")
  const bea = await join(ch, "bea", "cards")
  await Promise.all([ada.setName("Ada"), bea.setName("Bea")])
  const tipOf = () => {
    const l = readLaneNames(ch.doc)[0]
    return l === undefined ? null : readLaneTip(ch.doc, l)
  }
  const cIdle = () =>
    waitFor(
      () =>
        Object.keys(ch.doc.activeRuns()).length === 0 &&
        readOutbox(ch.doc).length === 0,
      30_000,
    )
  const onHost = (id: CardId) => readCards(ch.cards).find(c => c.id === id)
  const drafting = (end: string | null) =>
    ({ kind: "drafting", at: at(end), lane: null }) as const
  const newCard = (
    who: SessionClient,
    end: string | null,
    text: string,
  ): CardId => {
    const id = cardId(crypto.randomUUID())
    who.createCard({ id, owner: who.writer, place: drafting(end) }, text)
    return id
  }

  script.use([{ text: "Ready." }])
  await ada.chat("@agent start", ROOT, START_AGENT)
  await cIdle()
  const end = tipOf()

  // 1. Ada's card at the lane's end reaches Bea, who types in it; after two
  // more messages it is still Ada's card at the new end.
  const c1 = newCard(ada, end, "@agent next: ")
  const beaSees = await waitFor(
    () =>
      readCards(bea.cards).some(c => c.id === c1) &&
      bea.cardText(c1).text() === "@agent next: ",
    5_000,
  )
  bea.cardText(c1).text.insert(13, "write the tests.")
  const typed = "@agent next: write the tests."
  await waitFor(
    () => ada.cardText(c1).text() === typed && ch.cardText(c1) === typed,
    5_000,
  )
  await bea.chat("@Ada one", at(end), { mode: "reply" })
  await bea.chat("@Ada two", at(tipOf()), { mode: "reply" })
  await cIdle()
  const grown = tipOf()
  const idx = readTreeIndex(ch.doc)
  const found = yourCard(
    ada.writer,
    { kind: "end", end: grown ?? "" },
    readCards(ada.cards),
    readLanes(ch.doc, idx),
    idx,
  )
  ok(
    beaSees >= 0 && grown !== end && found?.id === c1,
    "a card at a thread's end reaches the others, and is still its owner's there after the thread grows",
  )

  // 2. Ada sends it: at the new end, with Bea as contributor; the card is spent.
  script.use([{ text: "Tests it is." }])
  const SEND1 = crypto.randomUUID()
  const sent1 = await ada.chat(typed, at(grown), { id: SEND1, card: c1 })
  await cIdle()
  await ch.quiet()
  const index1 = readTreeIndex(ch.doc)
  const sentId = index1.bySend.get(SEND1)
  const sentMsg = sentId === undefined ? undefined : index1.entries[sentId]
  ok(
    sent1.kind === "started" &&
      sentMsg?.parentId === grown &&
      sentMsg.message?.writer === ada.writer &&
      sentMsg.message.contributors?.join() === bea.writer &&
      onHost(c1) === undefined,
    `a card sent is its sender's message, with its other writers, and the card is spent (${sent1.kind})`,
  )

  // 2b. Undo in a card reaches only that card (ADR-0052): A's undo passes
  // over B's newer creation. A sent card's copy is destroyed once the host
  // lets go of it (S64), so its steps no longer stand; undoing past a card's
  // creation keeps the copy, so redo brings it back.
  const kept = newCard(ada, tipOf(), "kept")
  ada.undoFor(kept).typing(() => ada.cardText(kept).text.insert(4, " more"))
  const spentCard = newCard(ada, tipOf(), "@Bea spent")
  await waitFor(
    () =>
      ch.cardText(kept) === "kept more" &&
      ch.cardText(spentCard) === "@Bea spent",
    5_000,
  )
  await ada.undoFor(kept).undo()
  const own = await waitFor(() => ch.cardText(kept) === "kept", 5_000)
  const othersLeft = onHost(spentCard) !== undefined
  await ada.chat("@Bea spent", at(tipOf()), { card: spentCard })
  const dropped = await waitFor(
    () => !ada.exchange.has(cardDocId(spentCard)),
    5_000,
  )
  const sentUndo = await ada.undoFor(spentCard).undo()
  await ada.undoFor(kept).undo()
  const uncreated = await waitFor(() => onHost(kept) === undefined, 5_000)
  await ch.quiet()
  const stillHeld = ada.exchange.has(cardDocId(kept))
  await ada.undoFor(kept).redo()
  const redone = await waitFor(
    () => onHost(kept) !== undefined && ch.cardText(kept) === "kept",
    5_000,
  )
  ok(
    own >= 0 &&
      othersLeft &&
      dropped >= 0 &&
      !sentUndo &&
      uncreated >= 0 &&
      stillHeld &&
      redone >= 0,
    `undo in a card reaches only that card, and a sent card's steps act on nothing; undoing past a card's creation and redoing brings back its record and text (${[own, othersLeft, dropped, sentUndo, uncreated, stillHeld, redone].join()}; ${ch.cardText(kept)})`,
  )
  // Creating another card writes another key and another text, so it clears
  // nothing of the first card's redo: the redo brings it back whole (S64,
  // addendum 3).
  await ada.undoFor(kept).undo()
  await waitFor(() => onHost(kept) === undefined, 5_000)
  const other = newCard(ada, tipOf(), "another")
  await waitFor(() => onHost(other) !== undefined, 5_000)
  const backAfterOther = await ada.undoFor(kept).redo()
  const whole = await waitFor(
    () => onHost(kept) !== undefined && ch.cardText(kept) === "kept",
    5_000,
  )
  ok(
    backAfterOther && whole >= 0,
    `a card's redo past its creation survives another card's creation, and brings it back whole (${backAfterOther}; ${JSON.stringify(ch.cardText(kept))})`,
  )

  // 3. A compelled send to a busy lane is a conflict, and the card stays.
  script.use([{ text: "A long answer." }, { text: "later" }])
  const longOne = script.pause("@agent a long one")
  await bea.chat("@agent a long one", at(tipOf()), { mode: "reply" })
  await waitFor(() => longOne.reached, 10_000)
  const busyEnd = tipOf()
  const c2 = newCard(ada, busyEnd, "@agent me too")
  await waitFor(() => ch.cardText(c2) === "@agent me too", 5_000)
  const raced = await ada.chat("@agent me too", at(busyEnd), { card: c2 })
  ok(
    raced.kind === "conflict" &&
      onHost(c2) !== undefined &&
      ch.cardText(c2) === "@agent me too",
    `a conflict leaves the card and its text (${raced.kind})`,
  )

  // 4. A plain message to the busy lane waits, and its card is spent.
  const c3 = newCard(ada, busyEnd, "@Bea when it is done")
  await waitFor(() => ch.cardText(c3) === "@Bea when it is done", 5_000)
  const held = await ada.chat("@Bea when it is done", at(busyEnd), { card: c3 })
  ok(
    held.kind === "queued" && onHost(c3) === undefined,
    `a card sent to a busy lane waits, and is spent (${held.kind})`,
  )
  longOne.resume()
  await cIdle()

  // 5. Bea sends Ada's card after Ada has left: Bea's message, with Ada,
  // named through her seat's record.
  const c4 = newCard(ada, tipOf(), "@Bea over to you")
  await waitFor(() => ch.cardText(c4) === "@Bea over to you", 5_000)
  await ada.close()
  await sleep(200)
  const SEND4 = crypto.randomUUID()
  const sent4 = await bea.chat("@Bea over to you", at(tipOf()), {
    id: SEND4,
    card: c4,
  })
  await ch.quiet()
  const index4 = readTreeIndex(ch.doc)
  const msg4 = index4.entries[index4.bySend.get(SEND4) ?? ""]
  ok(
    sent4.kind === "appended" &&
      msg4?.message?.writer === bea.writer &&
      msg4.message.contributors?.join() === ada.writer &&
      onHost(c4) === undefined,
    `someone else's card, sent after its owner left, names them as contributor (${sent4.kind})`,
  )

  // 6. A restart sweeps: an empty card, a stored card text with no record,
  // and a seat no text names; a card with text is back.
  const keep = newCard(bea, tipOf(), "kept across a restart")
  const empty = newCard(bea, tipOf(), "")
  const orphan = cardId(crypto.randomUUID())
  bea.cardText(orphan).text.insert(0, "no record")
  const zed = await join(ch, "zed", "cards")
  await waitFor(
    () =>
      ch.cardText(keep) === "kept across a restart" &&
      ch.cardText(orphan) === "no record" &&
      onHost(empty) !== undefined &&
      readSeats(ch.doc).some(s => s.writer === zed.writer),
    5_000,
  )
  await Promise.all([bea.close(), zed.close()])
  await ch.shutdown()
  // The empty card's text loads late, so a host that served before its
  // sweep finished would still hold the card.
  const reopened = openStore(dbFile)
  ch = await startHost({
    model: { kind: "scripted", script },
    store: slowToLoad(reopened.store, cardDocId(empty), LATE_LOAD_MS),
    blobs: reopened.blobs,
    log: () => {},
  })
  // Read as `startHost` returns, before any client could connect.
  ok(
    onHost(empty) === undefined,
    "a starting host has swept before it returns: no empty card is left for a client to find",
  )
  const eve = await join(ch, "eve", "cards")
  await ch.quiet()
  const keepBack = await waitFor(
    () => eve.cardText(keep).text() === "kept across a restart",
    5_000,
  )
  ok(
    keepBack >= 0 &&
      onHost(keep) !== undefined &&
      onHost(c2) !== undefined &&
      onHost(empty) === undefined &&
      !readSeats(ch.doc).some(s => s.writer === zed.writer) &&
      readSeats(ch.doc).some(s => s.writer === bea.writer),
    "a restart keeps cards with text, and sweeps empty ones, unrecorded texts and seats no text names",
  )
  await eve.close()
  await ch.shutdown()
  // Read the store once the host has let it go: it owns its file (S47).
  const stored: string[] = []
  const closed = openStore(dbFile)
  for await (const d of closed.store.listDocIds("card:")) stored.push(d)
  const texts = [c1, c2, c3, c4, keep, empty, orphan].map(id =>
    stored.includes(`card:${id}`),
  )
  ok(
    JSON.stringify(texts) ===
      JSON.stringify([false, true, false, false, true, false, false]),
    `only the texts of cards still live are stored: spent, empty and unrecorded ones are destroyed (${texts.join()})`,
  )
}

// ── the archive: a root put aside for everyone (ADR-0029) ─────────────────
// Its own host, with a store to restart over.
{
  const dbFile = path.join(
    mkdtempSync(path.join(tmpdir(), "pineta-archive-")),
    "pineta.db",
  )
  const script = scriptedModel()
  const open = () =>
    startHost({
      model: { kind: "scripted", script },
      store: dbFile,
      log: () => {},
    })
  let ah = await open()
  const ada = await join(ah, "ada", "archive")
  const bea = await join(ah, "bea", "archive")
  await Promise.all([ada.setName("Ada"), bea.setName("Bea")])
  const aIdle = () =>
    waitFor(
      () =>
        Object.keys(ah.doc.activeRuns()).length === 0 &&
        readOutbox(ah.doc).length === 0,
      30_000,
    )
  const appended = (o: Outcome) => (o.kind === "appended" ? o.id : null)
  const refusal = (o: Outcome) =>
    o.kind === "refused" ? `${o.code}: ${o.message}` : o.kind

  // 1. Two roots. Ada archives the first: the record says so, by her.
  const r1 = appended(await ada.chat("first root", ROOT, START_CHAT)) ?? ""
  const r1b = appended(await bea.chat("more", at(r1))) ?? ""
  const r2 = appended(await bea.chat("second root", ROOT, START_CHAT)) ?? ""
  const archived = await ada.archive("archive", entryId(r1))
  const record = () => readArchive(ah.doc).get(r1)
  ok(
    archived.kind === "archived" &&
      record()?.state === "archived" &&
      record()?.by === ada.writer,
    `a root is archived, by its archiver (${archived.kind})`,
  )

  // 2. Nothing is written in it, and the refusal names who archived it.
  const refusals = [
    await bea.chat("still here?", at(r1b)),
    await bea.mark(entryId(r1b), "a title"),
  ].map(refusal)
  ok(
    refusals.every(r => r === "archived: archived by Ada"),
    `a chat and a title in it are refused (${refusals.join(" | ")})`,
  )

  // 3. A new root is accepted.
  const fresh = await bea.chat("a third root", ROOT, START_CHAT)
  ok(fresh.kind === "appended", `a new root is accepted (${fresh.kind})`)

  // 4. A root the agent is working in, with a message waiting, is not archived.
  script.use([{ text: "an answer" }, { text: "ok" }])
  const answering = script.pause("@agent answer slowly")
  const asked = await bea.chat("@agent answer slowly", at(r2))
  await waitFor(() => answering.reached, 10_000)
  const lane = readLanes(ah.doc, readTreeIndex(ah.doc))[0]
  const waiting = await ada.chat("@Bea meanwhile", at(lane?.tip ?? r2), {
    lane: lane?.name,
  })
  const busy = await ada.archive("archive", entryId(r2))
  const r3 = appended(fresh) ?? ""
  const other = await ada.archive("archive", entryId(r3))
  ok(
    asked.kind === "started" &&
      waiting.kind === "queued" &&
      refusal(busy) === "root_busy: the agent is working here" &&
      other.kind === "archived",
    `a root the agent works in is not archived, another root is (${refusal(busy)}; ${other.kind})`,
  )
  answering.resume()
  await aIdle()

  // 5. Restored, it takes messages again.
  const restored = await bea.archive("restore", entryId(r1))
  const after = await bea.chat("back again", at(r1b))
  ok(
    restored.kind === "restored" &&
      record()?.state === "restored" &&
      record()?.by === bea.writer &&
      after.kind === "appended",
    `a restored root takes messages again (${restored.kind}, ${refusal(after)})`,
  )

  // 6. Marks (ADR-0045): the last title wins, the same title writes nothing,
  // clearing deletes the record, and an archived root takes none.
  const mark = () => readMarks(ah.doc).get(r2)
  const titled = await ada.mark(entryId(r2), "Tab names")
  const byAda = mark()
  ok(
    titled.kind === "marked" &&
      byAda?.title === "Tab names" &&
      byAda.by === ada.writer &&
      byAda.at > 0,
    `a root is titled, by its writer (${refusal(titled)})`,
  )
  await bea.mark(entryId(r2), "Tab titles")
  const byBea = mark()
  const again = await bea.mark(entryId(r2), "Tab titles")
  ok(
    byBea?.title === "Tab titles" &&
      byBea.by === bea.writer &&
      again.kind === "marked" &&
      mark()?.at === byBea.at,
    "a second title replaces the first, and the same title again writes nothing",
  )
  await ada.mark(entryId(r1), "Kept over a restart")
  const cleared = await ada.mark(entryId(r2), null)
  ok(
    cleared.kind === "marked" && mark() === undefined,
    `clearing a title deletes its record (${cleared.kind})`,
  )
  const unknown = await ada.mark(entryId("no-such-entry"), "x")
  const inArchive = await bea.mark(entryId(r3), "x")
  ok(
    refusal(unknown) === "unknown_target: no such entry to title" &&
      refusal(inArchive) === "archived: archived by Ada" &&
      readMarks(ah.doc).get(r3) === undefined,
    `a mark on no entry, and in an archived root, is refused (${refusal(unknown)}; ${refusal(inArchive)})`,
  )

  // 7. The records survive a restart.
  const before = JSON.stringify([...readArchive(ah.doc)])
  await Promise.all([ada.close(), bea.close()])
  await ah.shutdown()
  ah = await open()
  ok(
    JSON.stringify([...readArchive(ah.doc)]) === before &&
      readArchive(ah.doc).get(r3)?.state === "archived",
    "after a restart, every archive record is back",
  )
  ok(
    readMarks(ah.doc).get(r1)?.title === "Kept over a restart",
    "after a restart, a mark is back",
  )
  await ah.shutdown()
}

// ── presence: who is here, per open column, decaying (ADR-0024) ────────────
// Its own host, with a short decay and a store, so leaving is quick to see.
{
  const decay = { presenceMs: 300, typingMs: 300 }
  const dbFile = path.join(
    mkdtempSync(path.join(tmpdir(), "pineta-presence-")),
    "pineta.db",
  )
  const phStore = openStore(dbFile).store
  const ph = await startHost({
    model: { kind: "scripted", script: scriptedModel() },
    store: phStore,
    presenceDecay: decay,
    log: () => {},
  })
  const joinHere = (name: string) =>
    join(ph, name, "presence", { presenceDecay: decay })
  const ada = await joinHere("ada")
  const bea = await joinHere("bea")
  ada.setReading("c1", "e-one")
  ada.setReading("c2", "e-two")
  ada.setTyping("e-two")
  const seen = await waitFor(
    () => readReading(bea.presence).length === 2,
    5_000,
  )
  const reading = readReading(bea.presence)
  ok(
    seen >= 0 &&
      reading.every(([w]) => w === ada.writer) &&
      reading
        .map(([, e]) => e)
        .sort()
        .join() === "e-one,e-two" &&
      readTyping(bea.presence).some(
        ([w, e]) => w === ada.writer && e === "e-two",
      ),
    `each open column is reported, and another client sees them (${reading.length} columns)`,
  )
  // Typing decays with no further keystroke; reading, refreshed, stays.
  const stopped = await waitFor(() => {
    ada.setReading("c1", "e-one")
    ada.setReading("c2", "e-two")
    return !readTyping(bea.presence).some(([w]) => w === ada.writer)
  }, 5_000)
  ok(
    stopped >= 0 && readReading(bea.presence).length === 2,
    "typing decays when the keystrokes stop; refreshed reading stays",
  )
  // A closed column's key is deleted, not left to decay: decay keeps the key
  // holding null, so only a deletion removes it. c1 stays refreshed meanwhile. As
  // the app does, the column stops being refreshed before it is deleted: a
  // write and a deletion of one key in the same millisecond diverge across
  // peers in Kyneta today (docs/pineta.md, open items).
  await sleep(20)
  ada.clearReading("c2")
  const closed = await waitFor(() => {
    ada.setReading("c1", "e-one")
    return (
      !Object.keys(bea.presence.reading()).some(
        k => k.startsWith(`${ada.writer}:`) && k.endsWith(":c2"),
      ) && readReading(bea.presence).length === 1
    )
  }, 5_000)
  ok(closed >= 0, "a closed column's entry is deleted from others' view")
  // Leaving is silence: a client that shuts down decays away.
  await ada.close()
  const left = await waitFor(
    () => readReading(bea.presence).length === 0,
    5_000,
  )
  ok(
    left >= 0,
    "a client that leaves is gone from others' view once its entries decay",
  )
  // Clients may not write the session: the host's policy refuses it.
  batch(bea.doc, d => d.values.set("forged", { value: "bea is the host" }))
  await sleep(500)
  ok(
    ph.doc.values.get("forged") === undefined,
    "a client's direct write to the session is refused by the host",
  )
  await ph.quiet()
  const presenceRows = (await storedRecords(phStore, PRESENCE_DOC_ID)).records
  ok(presenceRows === 0, `presence is never stored (${presenceRows} records)`)
  await bea.close()
  await sleep(100)
  await ph.shutdown()
}

// ── images: pasted, kept by content, read by the model (ADR-0042) ──────────
{
  const dbFile = path.join(
    mkdtempSync(path.join(tmpdir(), "pineta-images-")),
    "pineta.db",
  )
  const script = scriptedModel()
  let opened = openStore(dbFile)
  const GRACE_MS = 1_500
  const start = () =>
    startHost({
      model: { kind: "scripted", script },
      store: opened.store,
      blobs: opened.blobs,
      blobGraceMs: GRACE_MS,
      log: () => {},
    })
  let ih = await start()
  const upload = async (bytes: Buffer): Promise<ImageRef> => {
    const response = await fetch(`${ih.httpUrl}blob`, {
      method: "POST",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(bytes),
    })
    if (response.status !== 201)
      throw new Error(`upload refused: ${response.status}`)
    return (await response.json()) as ImageRef
  }
  const blobAt = (sha: string) => fetch(`${ih.httpUrl}blob/${sha}`)

  // 1. Upload and serve.
  const red = await upload(RED_PNG)
  const served = await blobAt(red.sha256)
  const servedBytes = Buffer.from(await served.arrayBuffer())
  ok(
    red.sha256 === sha256Of(RED_PNG) &&
      red.mimeType === "image/png" &&
      red.width === 40 &&
      red.height === 30 &&
      served.status === 200 &&
      served.headers.get("content-type") === "image/png" &&
      served.headers.get("x-content-type-options") === "nosniff" &&
      served.headers.get("content-security-policy") === "default-src 'none'" &&
      (served.headers.get("cache-control") ?? "").includes("immutable") &&
      servedBytes.equals(RED_PNG),
    "an uploaded PNG is kept by the SHA-256 of its bytes, with its size, and served back as it was",
  )
  ok(
    (await blobAt("0".repeat(64))).status === 404 &&
      (await blobAt("nope")).status === 404,
    "an unknown or malformed blob is a 404",
  )

  // 2. What an upload may be.
  const blobUrlOf = `${ih.httpUrl}blob`
  ok(
    (await rawPost(blobUrlOf, { "content-type": "text/plain" }, "headers")) ===
      415 &&
      (await rawPost(
        blobUrlOf,
        { "content-type": "image/png", "content-length": 33 * 1024 * 1024 },
        "headers",
      )) === 413,
    "an upload that is not an image type, or declares too much, is refused before its body is read",
  )
  ok(
    (await rawPost(
      blobUrlOf,
      { "content-type": "image/png" },
      Buffer.from("not an image at all"),
    )) === 415 &&
      (await rawPost(
        blobUrlOf,
        { "content-type": "image/png", "transfer-encoding": "chunked" },
        Buffer.alloc(33 * 1024 * 1024),
      )) === 413,
    "bytes that are not an image are refused, and a body past 32 MB is cut off",
  )

  // 3. A message shows it; the model reads it after the text.
  const iu = await join(ih, "ivy", "images")
  await iu.setName("Ivy")
  const iidle = () =>
    waitFor(
      () =>
        Object.keys(ih.doc.activeRuns()).length === 0 &&
        readOutbox(ih.doc).length === 0,
      30_000,
    )
  let seen: readonly string[] = []
  script.use([
    {
      reply: context => {
        seen = context
        return "a red one"
      },
    },
  ])
  const asked = `what colour is this? ![red](/blob/${red.sha256})`
  const sentRed = await iu.chat(asked, ROOT, START_AGENT)
  await iidle()
  const chatOf = (text: string) =>
    Object.values(readEntries(ih.doc))
      .map(rowMessage)
      .find(m => decodeChat(m)?.text === text) as
      | { readonly content?: unknown }
      | undefined
  const storedRed = chatOf(asked)
  ok(
    sentRed.kind === "started" &&
      typeof storedRed?.content === "string" &&
      JSON.stringify(decodeChat(storedRed)?.images) === JSON.stringify([red]),
    "a sent message keeps its images as references, and its content as text",
  )
  ok(
    seen.at(-1) === `Ivy: ${asked}[image image/png ${red.sha256}]`,
    `the model reads the message's text, then its image (${seen.at(-1)?.slice(-80)})`,
  )

  // 4. A message that waits for its lane carries its images when drained.
  const green = await upload(GREEN_PNG)
  const replyId = idOfIn(ih.doc, "a red one")
  const paused = script.pause("hold on")
  let seenHeld: readonly string[] = []
  script.use([
    { text: "held" },
    {
      reply: context => {
        seenHeld = context
        return "a green one"
      },
    },
  ])
  const holding = await iu.chat("@agent hold on", at(replyId), {
    mode: "reply",
  })
  await waitFor(() => paused.reached, 10_000)
  const queuedText = `@agent and this? ![green](/blob/${green.sha256})`
  const queued = await iu.chat(queuedText, at(replyId), { mode: "queue" })
  const heldImages = readOutbox(ih.doc).flatMap(h =>
    h.kind === "chat" ? (h.details.images ?? []) : [],
  )
  paused.resume()
  await iidle()
  ok(
    holding.kind === "started" &&
      queued.kind === "queued" &&
      heldImages[0]?.sha256 === green.sha256 &&
      seenHeld.at(-1) === `Ivy: ${queuedText}[image image/png ${green.sha256}]`,
    "a message held for a busy lane keeps its images, and the model reads them when it is drained",
  )

  // 5. An image the host does not store refuses the send.
  const missing = "9".repeat(64)
  const refusedSend = await iu.chat(
    `![gone](/blob/${missing})`,
    at(idOfIn(ih.doc, "a green one")),
    { mode: "reply" },
  )
  ok(
    codeOf(refusedSend) === ERR.IMAGE_MISSING &&
      chatOf(`![gone](/blob/${missing})`) === undefined,
    "a message showing an image the host does not store is refused, and nothing is written",
  )

  // 6. No image bytes in the session's records, compacted.
  await ih.quiet()
  const base64Slice = RED_PNG.toString("base64").slice(20, 70)
  const inRecords = await recordsHold(opened.store, base64Slice)
  ok(!inRecords, "the session's stored records hold no image's bytes")

  // 7. Deleting what nothing shows, after the grace; a card's image stays,
  // across a restart (ADR-0048).
  const blue = await upload(BLUE_PNG)
  const yellow = await upload(YELLOW_PNG)
  const drafted = cardId(crypto.randomUUID())
  const draftedText = `next: ![yellow](/blob/${yellow.sha256})`
  iu.createCard(
    {
      id: drafted,
      owner: iu.writer,
      place: {
        kind: "drafting",
        at: at(idOfIn(ih.doc, "a green one")),
        lane: null,
      },
    },
    draftedText,
  )
  await waitFor(() => ih.cardText(drafted) === draftedText, 5_000)
  await iu.close()
  await sleep(100)
  await ih.shutdown()
  opened = openStore(dbFile)
  ih = await start()
  await sleep(GRACE_MS + 200)
  const iv = await join(ih, "ivy", "images")
  script.use([{ text: "swept" }])
  await iv.chat("@agent anything", at(idOfIn(ih.doc, "a green one")), {
    mode: "reply",
  })
  await iidle()
  await ih.quiet()
  const kept = new Set(opened.blobs.list().map(b => b.sha256))
  ok(
    !kept.has(blue.sha256) &&
      kept.has(red.sha256) &&
      kept.has(green.sha256) &&
      kept.has(yellow.sha256),
    `after the grace, an image nothing shows is deleted; a message's, a held one's and a card's stay, across a restart (${[...kept].map(s => s.slice(0, 6)).join(", ")})`,
  )
  let seenAfter: readonly string[] = []
  script.use([
    {
      reply: context => {
        seenAfter = context
        return "still red"
      },
    },
  ])
  await iv.chat("@agent and the first one?", at(idOfIn(ih.doc, "swept")), {
    mode: "reply",
  })
  await iidle()
  ok(
    (await blobAt(red.sha256)).status === 200 &&
      seenAfter.includes(`Ivy: ${asked}[image image/png ${red.sha256}]`),
    "after a restart on the same file, an image is still served, and still reaches the model",
  )
  await iv.close()
  await sleep(100)
  await ih.shutdown()
}

// ── banners: an image behind each thread's column header ──────────────────
// Turned on by the user config. A scripted model draws a fixed image; the
// grace is short, so the sweep's handling of banners shows.
{
  const project = committedProject("pineta-banners-", { "a.txt": "a\n" })
  const userConfig = path.join(
    mkdtempSync(path.join(tmpdir(), "pineta-banner-config-")),
    "config.json",
  )
  writeFileSync(userConfig, JSON.stringify({ banner: { enabled: true } }))
  const script = scriptedModel({ answer: { text: "noted" } })
  const GRACE_MS = 1_000
  const bh = await startHost({
    model: { kind: "scripted", script },
    tools: { project },
    containers: false,
    userConfig,
    blobGraceMs: GRACE_MS,
    log: () => {},
  })
  const bu = await join(bh, "bea", "banners")
  await bu.setName("Bea")
  const bidle = async () => {
    await waitFor(
      () =>
        Object.keys(bh.doc.activeRuns()).length === 0 &&
        readOutbox(bh.doc).length === 0,
      60_000,
    )
    await bh.quiet()
  }
  const blobAt = (sha: string) => fetch(`${bh.httpUrl}blob/${sha}`)

  // 1. A new thread's banner is made as it is named, while its first run is
  //    still going.
  const planning = script.pause("plan the parser")
  await bu.chat("@agent plan the parser", ROOT, START_AGENT)
  await waitFor(() => planning.reached, 10_000)
  const bannerOfFirst = () => {
    const [first] = readLanes(bh.doc, readTreeIndex(bh.doc))
    return first === undefined ? undefined : readBanners(bh.doc).get(first.name)
  }
  const madeEarly =
    (await waitFor(() => bannerOfFirst() !== undefined, 10_000)) >= 0
  planning.resume()
  await bidle()
  const [lane] = readLanes(bh.doc, readTreeIndex(bh.doc)).map(l => l.name)
  const made = lane === undefined ? undefined : readBanners(bh.doc).get(lane)
  ok(
    madeEarly && made !== undefined && (await blobAt(made.sha)).status === 200,
    "a new thread's banner is made as it is named, before its first run ends, stored and served as an image",
  )

  // 2. The sweep keeps a banner nothing else shows.
  await sleep(GRACE_MS + 200)
  const reply = idOfIn(bh.doc, "noted")
  await bu.chat("@agent and the lexer", at(reply), { mode: "reply" })
  await bidle()
  ok(
    made !== undefined &&
      (await blobAt(made.sha)).status === 200 &&
      readBanners(bh.doc).get(made.lane)?.sha === made.sha,
    "after the grace, a banner's image is kept, and a later run makes no other",
  )

  // 3. `set_banner` sets a pasted image; the one it replaces is swept.
  const response = await fetch(`${bh.httpUrl}blob`, {
    method: "POST",
    headers: { "content-type": "image/png" },
    body: new Uint8Array(RED_PNG),
  })
  const red = (await response.json()) as ImageRef
  script.use([
    {
      tool: "set_banner",
      args: { image: `/blob/${red.sha256}` },
    },
    { text: "set it" },
  ])
  await bu.chat(
    `@agent use this as the banner ![red](/blob/${red.sha256})`,
    at(idOfIn(bh.doc, "noted")),
    { mode: "reply" },
  )
  await bidle()
  const toolSaid = Object.values(readEntries(bh.doc))
    .map(rowMessage)
    .filter(m => (m as { role?: string }).role === "toolResult")
    .map(m => messageText(m as never))
  const now = lane === undefined ? undefined : readBanners(bh.doc).get(lane)
  ok(
    now?.sha === red.sha256 && toolSaid.includes("The banner is set."),
    "set_banner sets a pasted image as the thread's banner, and tells the agent",
  )
  await sleep(GRACE_MS + 200)
  await bu.chat("@agent thanks", at(idOfIn(bh.doc, "set it")), {
    mode: "reply",
  })
  await bidle()
  ok(
    made !== undefined && (await blobAt(made.sha)).status === 404,
    "the banner a new one replaced is swept after the grace",
  )
  await bu.close()
  await sleep(100)
  await bh.shutdown()
}

// ── a tool's image: kept by content, a reference in the session (ADR-0051) ──
{
  const work = committedProject("pineta-tool-images-", { "shot.png": RED_PNG })
  const dbFile = path.join(
    mkdtempSync(path.join(tmpdir(), "pineta-tool-images-db-")),
    "pineta.db",
  )
  const script = scriptedModel()
  let opened = openStore(dbFile)
  const GRACE_MS = 1_500
  const start = () =>
    startHost({
      model: { kind: "scripted", script },
      tools: { project: work },
      containers: false,
      store: opened.store,
      blobs: opened.blobs,
      blobGraceMs: GRACE_MS,
      log: () => {},
    })
  let th = await start()
  const tidle = () =>
    waitFor(
      () =>
        Object.keys(th.doc.activeRuns()).length === 0 &&
        readOutbox(th.doc).length === 0,
      30_000,
    )
  const readCall = () => {
    const tree = readTreeIndex(th.doc)
    const spine = projectSpine(
      tree,
      readLanes(th.doc, tree)[0]?.tip ?? null,
    ).spine
    return spine
      .flatMap(n => n.toolCalls ?? [])
      .find(c => c.label === "read shot.png")
  }
  const red = sha256Of(RED_PNG)
  const tu = await join(th, "tia", "tool-images")

  // pi's pending entries, as each change of the document leaves them: a
  // compaction after the run rewrites the history they were in (S59).
  const pendings: string[] = []
  const unwatch = subscribe(th.doc, () => {
    for (const [key, v] of Object.entries(th.doc.values()))
      if (key.includes("pi.pending.entry")) pendings.push(JSON.stringify(v))
  })

  // 1. A read of a PNG: its result holds a reference, and the model the image.
  let seen: readonly string[] = []
  script.use([
    { tool: "read", args: { path: "shot.png" } },
    {
      reply: context => {
        seen = context
        return "a red square"
      },
    },
  ])
  await tu.chat("what is in shot.png?", ROOT, START_AGENT)
  await tidle()
  const call = readCall()
  const served = await fetch(`${th.httpUrl}blob/${red}`)
  ok(
    call?.subject === "shot.png" &&
      JSON.stringify(call.result?.images) ===
        JSON.stringify([
          { sha256: red, mimeType: "image/png", width: 40, height: 30 },
        ]) &&
      served.status === 200 &&
      Buffer.from(await served.arrayBuffer()).equals(RED_PNG),
    `a read image is stored by content, and its result holds the reference (${JSON.stringify(call?.result?.images)})`,
  )
  ok(
    seen.includes(`Read image file [image/png][image image/png ${red}]`),
    `the model reads the image the result refers to (${seen.at(-1)?.slice(-90)})`,
  )

  // 2. No bytes in the session: not in the entry, nor in pi's pending entry,
  // which a delete leaves in the history until a compaction (S59).
  unwatch()
  await th.quiet()
  const base64Slice = RED_PNG.toString("base64").slice(20, 70)
  ok(
    pendings.some(p => p.includes(red)) &&
      !pendings.some(p => p.includes(base64Slice)),
    `pi's pending entry holds the read image's reference, not its bytes (${pendings.length} seen)`,
  )
  const inRecords = await recordsHold(opened.store, base64Slice)
  ok(
    !inRecords && !JSON.stringify(readEntries(th.doc)).includes(base64Slice),
    "neither the session's records nor its entries hold a read image's bytes",
  )

  // 3. After a restart on the same file and the grace, the sweep keeps it,
  // and it still reaches the model.
  await tu.close()
  await sleep(100)
  await th.shutdown()
  opened = openStore(dbFile)
  th = await start()
  await sleep(GRACE_MS + 200)
  const tv = await join(th, "tia", "tool-images")
  let seenAfter: readonly string[] = []
  script.use([
    {
      reply: context => {
        seenAfter = context
        return "still red"
      },
    },
  ])
  const tip = readLanes(th.doc, readTreeIndex(th.doc))[0]
  await tv.chat("@agent and now?", at(tip?.tip ?? null), {
    lane: tip?.name,
  })
  await tidle()
  await th.quiet()
  ok(
    opened.blobs.list().some(b => b.sha256 === red) &&
      seenAfter.includes(`Read image file [image/png][image image/png ${red}]`),
    "after a restart and the grace, a read image is kept, and still reaches the model",
  )
  await tv.close()
  await sleep(100)
  await th.shutdown()
}

// ── admission: off loopback, only the invite key gets in ───────────────────
{
  const script = scriptedModel()
  const open = await startHost({
    bind: "0.0.0.0",
    key: "k3y",
    model: { kind: "scripted", script },
    log: () => {},
  })
  const status = async (url: string, init?: RequestInit) =>
    (await fetch(url, { redirect: "manual", ...init })).status
  const wsRefused = await new Promise<boolean>(resolve => {
    const ws = new WebSocket(open.wsUrl)
    ws.onopen = () => {
      ws.close()
      resolve(false)
    }
    ws.onerror = () => resolve(true)
  })
  ok(
    (await status(open.httpUrl)) === 403 &&
      (await status(`${open.httpUrl}app.tsx`)) === 403 &&
      wsRefused,
    "without the key: no page, no source file, no websocket",
  )
  ok(
    (await status(`${open.httpUrl}blob/${"0".repeat(64)}`)) === 403 &&
      (await status(`${open.httpUrl}blob`, {
        method: "POST",
        headers: { "content-type": "image/png" },
        body: new Uint8Array(RED_PNG),
      })) === 403 &&
      (await status(`${open.httpUrl}blob/${"0".repeat(64)}`, {
        headers: { cookie: "pineta_key=k3y" },
      })) === 404,
    "without the key, no blob is served or taken; with it, an unknown one is a 404",
  )
  const invited = await fetch(`${open.httpUrl}?key=k3y`, { redirect: "manual" })
  const cookie = invited.headers.get("set-cookie") ?? ""
  ok(
    invited.status === 302 &&
      invited.headers.get("location") === "/" &&
      cookie.includes("pineta_key=k3y") &&
      cookie.includes("HttpOnly"),
    "the invite link sets the key cookie and redirects to the page without the key",
  )
  ok(
    (await status(open.httpUrl, { headers: { cookie: "pineta_key=k3y" } })) ===
      200,
    "with the cookie, the page loads",
  )
  const guest = await join(open, "keyed", "admission", { key: "k3y" })
  const named = await guest.setName("Keyed")
  ok(named.kind === "named", "a client with the key syncs and sends commands")
  await guest.close()
  await sleep(100)
  await open.shutdown()
  ok((await status(host.httpUrl)) === 200, "a loopback host needs no key")

  // On loopback there is no key: a page elsewhere, or a name rebound to this
  // machine, must still not reach the socket (ADR-0042).
  const hostHeader = new URL(host.httpUrl).host
  ok(
    (await upgradeStatus(host.wsUrl, { origin: "https://evil.example" })) ===
      403 &&
      (await upgradeStatus(host.wsUrl, {
        origin: `http://${hostHeader}`,
      })) === 101,
    "on loopback, a websocket from another origin is refused, and from the page's own admitted",
  )
  ok(
    (await upgradeStatus(host.wsUrl, { host: "rebound.example" })) === 403 &&
      (await requestStatus(host.httpUrl, { host: "rebound.example" })) === 403,
    "on loopback, a Host that is not this machine's name is refused: a rebound name",
  )
}

/** The status a websocket upgrade to `url` gets with `headers`: 101 when it opens. */
function upgradeStatus(
  url: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise(resolve => {
    const ws = new WsClient(url, { headers })
    ws.on("open", () => {
      ws.close()
      resolve(101)
    })
    ws.on("unexpected-response", (_req, res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    ws.on("error", () => resolve(0))
  })
}

/**
 * The status a raw POST to `url` gets. With "headers", only the headers are
 * sent, and the body never: a host that waits to read one never answers. A
 * reset connection is -1; no answer in 10 s, 0.
 */
function rawPost(
  url: string,
  headers: Record<string, string | number>,
  body: Buffer | "headers",
): Promise<number> {
  return new Promise(resolve => {
    const done = (status: number) => {
      clearTimeout(timer)
      resolve(status)
      req.destroy()
    }
    const req = httpRequest(url, { method: "POST", headers }, res => {
      res.resume()
      done(res.statusCode ?? 0)
    })
    req.on("error", () => done(-1))
    const timer = setTimeout(() => done(0), 10_000)
    if (body === "headers") req.flushHeaders()
    else req.end(body)
  })
}

/** The status of a plain GET to `url` with `headers`, which fetch may not set (`Host`). */
function requestStatus(
  url: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    httpRequest(url, { headers }, res => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
      .on("error", reject)
      .end()
  })
}

// Shut the client down first, then let the socket settle before tearing down
// the host: otherwise the host's transport decodes a frame against an
// already-disposed pipeline and logs a harmless "Pipeline disposed".
await client.close()
await sleep(100)
await host.shutdown()

report("e2e")
