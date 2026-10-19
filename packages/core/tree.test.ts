import { describe, expect, test } from "vitest"
import {
  cardIdFor,
  entriesById,
  entry,
  FIXTURE_THREAD,
  fromParents,
  lineMessage,
  personMessage,
  threadOfEntry,
  toolResultMessage,
} from "./fixtures.ts"
import {
  agentActivity,
  ancestry,
  atEntry,
  baseKnown,
  callSubject,
  canvasIdFor,
  conflictAskTime,
  type EntryLike,
  entryId,
  entryMessage,
  entryThread,
  indexTree,
  knownToolId,
  type MessageAt,
  type MessagePart,
  messageImages,
  messageToolCalls,
  messageWriters,
  newestOnPath,
  type PinnedView,
  pinnedInView,
  projectRail,
  projectSpine,
  projectTranscript,
  ROOT,
  runPrompt,
  type Sha256,
  type SpineNode,
  startsRun,
  storedImage,
  type TextEdit,
  type ThreadId,
  TOOL_IDS,
  type ToolCall,
  tailEdit,
  textCardId,
  threadEnd,
  threadFirstMessage,
  threadIdFor,
  threadOfSend,
  transcriptCalls,
  treeRoot,
  turnEntry,
  turnMerged,
  writerId,
} from "./index.ts"

/**
 * A tree from `child: parent` pairs. Ids are uuidv7-like: the digit prefix
 * sorts by age, so "2-…" is older than "3-…". Every entry is a chat message.
 */
const tree = (parents: Record<string, string | null>) =>
  fromParents(parents, id => personMessage(id, { author: "A" }))

// A trunk T1 -> T2 -> T3, a branch A off T1, a branch B off T2. The trunk's
// continuation is older than each branch.
const forks = tree({
  "1-t1": null,
  "2-t2": "1-t1",
  "3-t3": "2-t2",
  "4-a1": "1-t1",
  "5-a2": "4-a1",
  "6-b1": "2-t2",
  "7-b2": "6-b1",
})
const ids = (nodes: readonly { id: string }[]) => nodes.map(n => n.id)

describe("indexTree and ancestry", () => {
  test("children are sorted by id, whatever the insertion order", () => {
    const shuffled = entriesById(Object.values(forks).toReversed())
    expect(indexTree(shuffled).childrenOf.get(entryId("1-t1"))).toEqual([
      "2-t2",
      "4-a1",
    ])
  })
  test("roots and orphans are reported", () => {
    const i = indexTree({
      ...forks,
      ...tree({ "9-x": "missing", "8-r": null }),
    })
    expect([i.roots, i.orphans]).toEqual([["1-t1", "8-r"], ["9-x"]])
  })
  test("treeRoot walks up to the root; an orphan is its own root", () => {
    const i = indexTree({
      ...forks,
      ...tree({ "9-x": "missing", "a-y": "9-x" }),
    })
    expect(treeRoot(i, entryId("7-b2"))).toBe("1-t1")
    expect(treeRoot(i, entryId("1-t1"))).toBe("1-t1")
    expect(treeRoot(i, entryId("a-y"))).toBe("9-x")
    expect(treeRoot(i, entryId("nope"))).toBeNull()
  })
  test("a cycle stops ancestry and is reported", () => {
    const cyclic = tree({ x: "y", y: "x" })
    expect(ancestry(indexTree(cyclic), entryId("x"))).toEqual({
      path: ["x", "y"],
      cycleAt: "x",
    })
  })
})

describe("messageWriters", () => {
  test("each writer once, in order of their first message", () => {
    const ada = writerId("w-ada")
    const bea = writerId("w-bea")
    const by = (writer: typeof ada) => personMessage("", { author: "", writer })
    const i = indexTree(
      entriesById([
        entry("1-a", null, by(bea)),
        entry("2-b", "1-a", by(ada)),
        entry("3-c", "2-b", by(bea)),
        entry("4-d", "3-c"),
      ]),
    )
    expect(
      messageWriters(i, [
        entryId("4-d"),
        entryId("3-c"),
        entryId("2-b"),
        entryId("1-a"),
      ]),
    ).toEqual([bea, ada])
    expect(messageWriters(i, [entryId("3-c"), entryId("2-b")])).toEqual([
      ada,
      bea,
    ])
  })
})

describe("projectRail", () => {
  const rows = projectRail(indexTree(forks), entryId("1-t1"))
  const trackOf = (id: string) => rows.find(r => r.id === id)?.track
  test("a child in its parent's thread continues its track; one in another thread takes a new track", () => {
    expect([trackOf("1-t1"), trackOf("2-t2"), trackOf("3-t3")]).toEqual([
      0, 0, 0,
    ])
    expect(trackOf("4-a1")).toBe(1)
    expect(trackOf("6-b1")).toBe(2)
  })
  test("a branch's track is its first message's rank by id, so a new branch moves no other", () => {
    // A branch off A's first message: the fourth branch made, so track 3,
    // though the trunk's track 0 has ended by then in depth-first order. A
    // newer branch off T2 is drawn before A's, and still takes the next number.
    const sub = projectRail(
      indexTree({ ...forks, ...tree({ "8-s1": "4-a1" }) }),
      entryId("1-t1"),
    )
    expect(sub.find(r => r.id === "8-s1")?.track).toBe(3)
    const newer = projectRail(
      indexTree({ ...forks, ...tree({ "8-s1": "4-a1", "9-n1": "2-t2" }) }),
      entryId("1-t1"),
    )
    for (const r of sub)
      expect(newer.find(n => n.id === r.id)?.track).toBe(r.track)
    expect(newer.find(r => r.id === "9-n1")?.track).toBe(4)
  })
  test("rows are depth-first, children in id order, each with its parent's track", () => {
    expect(ids(rows)).toEqual([
      "1-t1",
      "2-t2",
      "3-t3",
      "6-b1",
      "7-b2",
      "4-a1",
      "5-a2",
    ])
    expect(rows.find(r => r.id === "6-b1")).toMatchObject({
      parentId: "2-t2",
      head: true,
    })
    expect(rows.find(r => r.id === "3-t3")).toMatchObject({ head: false })
  })
  test("the same entries in another insertion order give the same rows", () => {
    const shuffled = entriesById(Object.values(forks).toReversed())
    expect(projectRail(indexTree(shuffled), entryId("1-t1"))).toEqual(rows)
  })
  test("draws only its root's tree, from track 0", () => {
    const i = indexTree({ ...forks, ...tree({ "8-r1": null, "9-r2": "8-r1" }) })
    expect(ids(projectRail(i, entryId("8-r1")))).toEqual(["8-r1", "9-r2"])
    expect(projectRail(i, entryId("8-r1"))[0]).toMatchObject({
      track: 0,
      parentId: null,
    })
    expect(ids(projectRail(i, entryId("1-t1")))).toEqual(ids(rows))
  })
  test("a non-message entry has no row; its child attaches to the message above", () => {
    // Both in the trunk's thread, as the trunk's lane writes them.
    const trunk = threadOfEntry("1-t1")
    const withCompaction = {
      ...forks,
      ...entriesById([
        entry("8-c", "3-t3", undefined, { type: "compaction", thread: trunk }),
        entry("9-after", "8-c", personMessage("9-after"), { thread: trunk }),
      ]),
    }
    const r = projectRail(indexTree(withCompaction), entryId("1-t1"))
    expect(r.some(x => x.id === "8-c")).toBe(false)
    expect(r.find(x => x.id === "9-after")).toMatchObject({
      parentId: "3-t3",
      track: 0,
    })
  })
})

describe("agentActivity", () => {
  test("the agent is idle with no running lane; a lane runs once it has a tip", () => {
    expect(agentActivity([])).toEqual([])
    const runs = agentActivity([
      { lane: threadIdFor("a"), tip: entryId("5-a2") },
      { lane: threadIdFor("b"), tip: entryId("7-b2") },
      { lane: threadIdFor("new"), tip: null },
    ])
    expect(runs.map(r => [r.lane, r.tip])).toEqual([
      ["t-a", "5-a2"],
      ["t-b", "7-b2"],
    ])
  })
})

describe("threads: where each starts and ends, and where a send lands", () => {
  // 1-q is Wu's question, starting thread q; below it the agent's reply, a
  // remark, and questions. Every entry names its thread, q unless said.
  const say = (
    id: string,
    parentId: string | null,
    extra: {
      readonly writer: string
      readonly compelled: boolean
      readonly thread?: string
    },
  ) =>
    entry(
      id,
      parentId,
      personMessage(id, {
        writer: writerId(extra.writer),
        compelled: extra.compelled,
      }),
      { thread: threadIdFor(extra.thread ?? "q") },
    )
  const Q = threadIdFor("q")
  const entries = entriesById([
    say("1-q", null, { writer: "wu", compelled: true }),
    entry("2-r", "1-q", { role: "assistant", content: "r" }, { thread: Q }),
    say("3-plain", "2-r", { writer: "bo", compelled: false }),
    say("4-mine", "3-plain", { writer: "wu", compelled: true }),
  ])
  const at = (id: string) => atEntry(entryId(id))

  const me = writerId("wu")
  const lane = (tip: string | null, name: ThreadId = Q) => ({
    name,
    tip: tip === null ? null : entryId(tip),
    running: false,
    waiting: 0,
    askedBy: null,
    lastWaiting: null,
    heldBy: null,
  })
  const end = (seen: string, thread: ThreadId = Q): MessageAt => ({
    kind: "end",
    thread,
    seen: entryId(seen),
  })
  const branch = (thread: string, from: string | null): MessageAt => ({
    kind: "branch",
    thread: threadIdFor(thread),
    at: from === null ? null : entryId(from),
    canvas: canvasIdFor("01a0ffd2-0000-7000-8000-00000000000c"),
  })

  test("threadEnd: the thread's entry with no child in its own thread, past a newer branch", () => {
    const i = indexTree({
      ...entries,
      ...entriesById([
        say("5-next", "4-mine", { writer: "wu", compelled: false }),
        say("6-b", "4-mine", { writer: "bo", compelled: false, thread: "b" }),
        say("7-b2", "6-b", { writer: "bo", compelled: false, thread: "b" }),
      ]),
    })
    expect(threadEnd(i, Q)).toBe("5-next")
    expect(threadEnd(i, threadIdFor("b"))).toBe("7-b2")
    expect(i.firstOf.get(threadIdFor("b"))).toBe("6-b")
    expect(threadEnd(i, threadIdFor("none"))).toBeNull()
  })

  test("a branch's context entry, older than its parent thread's next entry, is the branch's", () => {
    // Under 4-mine: b's first run wrote its canvas entry, then its prompt;
    // later q's next run wrote its own canvas entry, then its prompt and
    // reply. The canvas entries carry no message a column draws.
    const B = threadIdFor("b")
    const canvasEntry = (id: string, parentId: string, thread: ThreadId) =>
      entry(
        id,
        parentId,
        {
          role: "canvas",
          content: "",
          canvas: { canvas: canvasIdFor("c"), title: "c", lines: [], more: 0 },
        },
        { thread },
      )
    const i = indexTree({
      ...entries,
      ...entriesById([
        canvasEntry("5-cb", "4-mine", B),
        say("6-b", "5-cb", { writer: "bo", compelled: true, thread: "b" }),
        canvasEntry("7-cq", "4-mine", Q),
        say("8-next", "7-cq", { writer: "wu", compelled: true }),
        entry(
          "9-a",
          "8-next",
          { role: "assistant", content: "a" },
          { thread: Q },
        ),
      ]),
    })
    expect(threadEnd(i, Q)).toBe("9-a")
    expect(threadEnd(i, B)).toBe("6-b")
    expect(entryThread(i, entryId("5-cb"))).toBe(B)
    expect(i.firstOf.get(B)).toBe("5-cb")
    expect(threadFirstMessage(i, B)).toBe("6-b")
    expect(threadFirstMessage(i, Q)).toBe("1-q")
    expect(threadFirstMessage(i, threadIdFor("none"))).toBeNull()
    // On the rail the trunk carries on in its own track, the branch in one
    // of its own, though the branch's first entry is the older child.
    const rail = projectRail(i, entryId("1-q"))
    const trackOf = (id: string) => rail.find(r => r.id === id)?.track
    expect([trackOf("4-mine"), trackOf("8-next"), trackOf("9-a")]).toEqual([
      0, 0, 0,
    ])
    expect(trackOf("6-b")).toBe(1)
  })

  test("a cycle inside a thread gives it no first entry and no end", () => {
    const i = indexTree(
      entriesById([
        say("1-x", "2-y", { writer: "wu", compelled: false, thread: "c" }),
        say("2-y", "1-x", { writer: "wu", compelled: false, thread: "c" }),
      ]),
    )
    expect(threadEnd(i, threadIdFor("c"))).toBeNull()
    expect(threadFirstMessage(i, threadIdFor("c"))).toBeNull()
  })

  test("entryThread: the thread its row names; null for an entry the index lacks", () => {
    const i = indexTree({
      ...entries,
      ...entriesById([
        say("6-b", "2-r", { writer: "bo", compelled: false, thread: "b" }),
        say("7-b2", "6-b", { writer: "bo", compelled: false, thread: "b" }),
      ]),
    })
    expect(entryThread(i, entryId("4-mine"))).toBe(Q)
    expect(entryThread(i, entryId("2-r"))).toBe(Q)
    expect(entryThread(i, entryId("7-b2"))).toBe(threadIdFor("b"))
    expect(entryThread(i, entryId("9-gone"))).toBeNull()
  })

  test("a thread with two first entries keeps the older, and with two ends the newer, so replicas agree", () => {
    const i = indexTree({
      ...entries,
      ...entriesById([
        say("5-dup", null, { writer: "bo", compelled: false }),
        say("6-also", "3-plain", { writer: "bo", compelled: false }),
      ]),
    })
    expect(i.firstOf.get(Q)).toBe("1-q")
    expect(threadEnd(i, Q)).toBe("6-also")
  })

  test("threadOfSend: an end send lands at its thread's end, in its lane; a branch starts at its fork", () => {
    const i = indexTree(entries)
    const lanes = [lane("4-mine")]
    expect(threadOfSend(i, lanes, { at: end("1-q"), me })).toMatchObject({
      end: at("4-mine"),
      lane: { kind: "lane", name: Q },
    })
    expect(threadOfSend(i, lanes, { at: branch("new", "4-mine"), me })).toEqual(
      {
        kind: "thread",
        end: at("4-mine"),
        lane: { kind: "none" },
        race: null,
      },
    )
    expect(
      threadOfSend(i, lanes, { at: branch("new", null), me }),
    ).toMatchObject({ end: ROOT })
    // A thread with an entry, or a lane, is taken; an unknown entry is none.
    expect(threadOfSend(i, lanes, { at: branch("q", "4-mine"), me }).kind).toBe(
      "taken",
    )
    expect(
      threadOfSend(i, lanes, { at: branch("new", "9-gone"), me }).kind,
    ).toBe("unknown")
    expect(
      threadOfSend(i, lanes, { at: end("1-q", threadIdFor("no")), me }).kind,
    ).toBe("unknown")
  })

  test("threadOfSend: what the sender saw off its thread is refused", () => {
    const i = indexTree({
      ...entries,
      ...entriesById([
        say("6-b", "2-r", { writer: "bo", compelled: false, thread: "b" }),
      ]),
    })
    expect(threadOfSend(i, [], { at: end("6-b"), me }).kind).toBe("unknown")
  })

  test("threadOfSend: before its first entry, a thread's lane holds its fork", () => {
    const i = indexTree(entries)
    const b = threadIdFor("b")
    expect(
      threadOfSend(i, [lane("2-r", b)], { at: end("2-r", b), me }),
    ).toMatchObject({ end: at("2-r"), lane: { kind: "lane", name: b } })
  })

  test("threadOfSend race: an agent reply, a plain remark and my own question are not a race", () => {
    expect(
      threadOfSend(indexTree(entries), [], { at: end("1-q"), me }),
    ).toMatchObject({ race: null })
  })

  test("threadOfSend race: another writer's compelled message on the thread is; in a branch, not; a queued card's never", () => {
    const raced = indexTree({
      ...entries,
      ...entriesById([
        say("5-theirs", "4-mine", { writer: "bo", compelled: true }),
      ]),
    })
    expect(threadOfSend(raced, [], { at: end("1-q"), me })).toMatchObject({
      race: { by: "w-bo" },
    })
    expect(threadOfSend(raced, [], { at: end("5-theirs"), me })).toMatchObject({
      race: null,
    })
    expect(
      threadOfSend(raced, [], { at: { kind: "queue", thread: Q }, me }),
    ).toMatchObject({ end: at("5-theirs"), race: null })
    // Bob asks in a branch at 2-r; my thread continues through 6-mine.
    const forked = indexTree({
      ...entries,
      ...entriesById([
        say("5-fork", "2-r", { writer: "bo", compelled: true, thread: "b" }),
        say("6-mine", "4-mine", { writer: "wu", compelled: false }),
      ]),
    })
    expect(threadOfSend(forked, [], { at: end("1-q"), me })).toMatchObject({
      end: at("6-mine"),
      race: null,
    })
  })
})

/** The calls a spine node carries: an assistant message's, none for another. */
const calls = (node: SpineNode | undefined): readonly ToolCall[] =>
  node === undefined ? [] : transcriptCalls(node)

describe("tool calls: paired with their results on the path", () => {
  const call = (id: string, name: string, args: unknown): MessagePart => ({
    type: "toolCall",
    id,
    name,
    arguments: args,
  })
  const entries = entriesById([
    entry("1-q", null, { role: "user", content: "what is in notes?" }),
    entry("2-a", "1-q", {
      role: "assistant",
      content: [call("c1", "read", { path: "notes.txt" })],
    }),
    entry(
      "3-r",
      "2-a",
      toolResultMessage({
        toolCallId: "c1",
        content: [{ type: "text", text: "MANGO" }],
      }),
    ),
    entry("4-a", "3-r", { role: "assistant", content: "It says MANGO." }),
    // A sibling branch answering the same call id: not on the main path.
    entry(
      "5-r",
      "2-a",
      toolResultMessage({
        toolCallId: "c1",
        content: [{ type: "text", text: "elsewhere" }],
        isError: true,
      }),
    ),
  ])
  const i = indexTree(entries)

  test("a call and its result on one path pair; a message with only calls keeps them", () => {
    const { spine } = projectSpine(i, entryId("4-a"))
    expect(spine.map(n => n.id)).toEqual(["1-q", "2-a", "4-a"])
    expect(calls(spine[1])).toEqual([
      {
        id: "c1",
        name: "read",
        subject: "notes.txt",
        result: { text: "MANGO", isError: false, images: [] },
      },
    ])
  })
  test("a result's stored images are on its call", () => {
    const image: MessagePart = {
      type: "image",
      mimeType: "image/png",
      sha256: "a".repeat(64) as Sha256,
      width: 40,
      height: 30,
    }
    const read = indexTree({
      ...entries,
      ...entriesById([
        entry("6-a", "4-a", {
          role: "assistant",
          content: [call("c6", "read", { path: "shot.png" })],
        }),
        entry(
          "7-r",
          "6-a",
          toolResultMessage({
            toolCallId: "c6",
            content: [
              { type: "text", text: "Read image file [image/png]" },
              image,
            ],
          }),
        ),
        entry("8-a", "7-r", { role: "assistant", content: "A red square." }),
      ]),
    })
    expect(calls(projectSpine(read, entryId("8-a")).spine.at(-2))).toEqual([
      {
        id: "c6",
        name: "read",
        subject: "shot.png",
        result: {
          text: "Read image file [image/png]",
          isError: false,
          images: [
            {
              sha256: "a".repeat(64) as Sha256,
              mimeType: "image/png",
              width: 40,
              height: 30,
            },
          ],
        },
      },
    ])
  })
  test("a call carries its whole subject, every line of it", () => {
    const command = "pnpm test\necho done"
    const long = indexTree({
      ...entries,
      ...entriesById([
        entry("9-a", "4-a", {
          role: "assistant",
          content: [call("c9", "bash", { command })],
        }),
      ]),
    })
    expect(calls(projectSpine(long, entryId("9-a")).spine.at(-1))).toEqual([
      {
        id: "c9",
        name: "bash",
        subject: command,
      },
    ])
  })
  test("a result off the path does not pair", () => {
    // Path to 5-r: its result pairs; path to 2-a alone: no result yet.
    expect(
      calls(projectSpine(i, entryId("2-a")).spine[1])[0]?.result,
    ).toBeUndefined()
    expect(calls(projectSpine(i, entryId("5-r")).spine[1])[0]?.result).toEqual({
      text: "elsewhere",
      isError: true,
      images: [],
    })
  })
  test("a branch's message count ignores tool results", () => {
    const { spine } = projectSpine(i, entryId("1-q"))
    expect(spine[0]?.branches).toEqual([{ rootId: "2-a", messageCount: 2 }])
  })
})

describe("storedImage: only stored references", () => {
  const ref = {
    type: "image",
    mimeType: "image/png",
    sha256: "b".repeat(64),
    width: 40,
    height: 30,
  }

  test("a reference is an image", () => {
    expect(storedImage(ref)).toEqual({
      sha256: ref.sha256,
      mimeType: "image/png",
      width: 40,
      height: 30,
    })
  })
  test.each<[string, unknown]>([
    ["inline bytes", { type: "image", data: "iVBOR", mimeType: "image/png" }],
    ["bytes beside a reference", { ...ref, data: "iVBOR" }],
    ["a malformed hash", { ...ref, sha256: "B".repeat(64) }],
    ["a type no provider takes", { ...ref, mimeType: "image/svg+xml" }],
    ["no width", { ...ref, width: 0 }],
    ["a fractional height", { ...ref, height: 1.5 }],
    ["a text part", { type: "text", text: "x" }],
    ["no part", null],
  ])("%s is not one", (_, part) => {
    expect(storedImage(part)).toBeUndefined()
  })
  test("a message's images are its image parts; text content has none", () => {
    const image = storedImage(ref)
    expect(
      image === undefined
        ? []
        : messageImages(
            toolResultMessage({
              content: [
                { type: "text", text: "x" },
                { type: "image", ...image },
              ],
            }),
          ),
    ).toEqual([image])
    expect(messageImages({ role: "user", content: "hi" })).toEqual([])
  })
})

describe("callSubject, knownToolId and tailEdit", () => {
  test.each([
    ["read", { path: "a.ts" }, "a.ts"],
    ["bash", { command: "pnpm test\necho done" }, "pnpm test\necho done"],
    ["grep", { pattern: "TODO", path: "src" }, "TODO src"],
    ["find", { pattern: "*.ts" }, "*.ts"],
    ["catch_up", {}, "base"],
    ["split_proposed_changes", {}, undefined],
    ["mystery", { path: "a" }, undefined],
    ["function Object() { [native code] }", { path: "a" }, undefined],
  ])("callSubject(%s, %o) is %s", (name, args, subject) => {
    expect(callSubject(name, args)).toBe(subject)
  })

  test("knownToolId knows every registered tool, and nothing else", () => {
    for (const id of TOOL_IDS) expect(knownToolId(id)).toBe(id)
    expect(knownToolId("mystery")).toBeUndefined()
    expect(knownToolId("function Object() { [native code] }")).toBeUndefined()
  })

  // `text` with `edits` applied in order: what a Kyneta text holds afterwards.
  const applyEdits = (text: string, edits: readonly TextEdit[]): string =>
    edits.reduce(
      (t, e) => t.slice(0, e.at) + e.insert + t.slice(e.at + e.remove),
      text,
    )

  // A tail-kept view: lines 1..n, keeping the last `keep` lines.
  const view = (n: number, keep: number) =>
    Array.from({ length: n }, (_, k) => `line ${k + 1} ${"x".repeat(k % 7)}\n`)
      .slice(-keep)
      .join("")

  test("tailEdit reproduces every snapshot, however the view moved", () => {
    const cases: [string, string][] = [
      ["", "a"],
      ["abc", "abcdef"],
      [view(10, 10), view(14, 10)],
      [view(30, 8), view(31, 8)],
      ["unrelated", "different text"],
      ["abc", ""],
      ["same", "same"],
    ]
    for (const [prev, next] of cases)
      expect(applyEdits(prev, tailEdit(prev, next))).toBe(next)
  })
  test("tailEdit appends as one insert, and a moved tail as a front cut plus an append", () => {
    expect(tailEdit("abc", "abcdef")).toEqual([
      { at: 3, remove: 0, insert: "def" },
    ])
    const prev = view(30, 8)
    const next = view(32, 8)
    const edits = tailEdit(prev, next)
    expect(edits.length).toBe(2)
    expect(edits[0]).toMatchObject({ at: 0, insert: "" })
    expect(edits[1]?.remove).toBe(0)
    // Each edit carries only what changed, never the whole view again.
    expect(edits.reduce((n, x) => n + x.insert.length, 0)).toBeLessThan(
      next.length / 2,
    )
  })
})

describe("pinned cards in the tree", () => {
  const card = (id: string, text: string) => ({
    id: textCardId(id),
    text,
    by: writerId("ada@example.com"),
  })
  const LANE = threadIdFor("x")
  const OTHER = threadIdFor("p")
  const cards = (
    id: string,
    parent: string | null,
    view: PinnedView,
  ): EntryLike =>
    entry(id, parent, { role: "pinned", content: "", pinned: view })
  const first: PinnedView = {
    lane: OTHER,
    cards: [card(cardIdFor("c1"), "a")],
    retired: [],
  }
  const second: PinnedView = {
    lane: LANE,
    cards: [card(cardIdFor("c2"), "b")],
    retired: [{ id: cardIdFor("c1"), line: "a" }],
  }
  // 1-q -> 2-cards(first) -> 3-p1 -> 4-r1 -> 5-cards(second) -> 6-p2 -> 7-r2
  const list = [
    entry("1-q", null, personMessage("q", { author: "A" })),
    cards("2-cards", "1-q", first),
    entry("3-p1", "2-cards", personMessage("p1", { author: "A" })),
    entry("4-r1", "3-p1", { role: "assistant", content: "r1" }),
    cards("5-cards", "4-r1", second),
    entry("6-p2", "5-cards", personMessage("p2", { author: "A" })),
    entry("7-r2", "6-p2", { role: "assistant", content: "r2" }),
  ]
  const index = indexTree(entriesById(list))

  test("a cards entry is no message: not in the transcript, nor the spine, nor a prompt", () => {
    const tip = entryId("7-r2")
    expect(projectTranscript(index, tip).map(m => m.id)).toEqual([
      "1-q",
      "3-p1",
      "4-r1",
      "6-p2",
      "7-r2",
    ])
    expect(ids(projectSpine(index, tip).spine)).toEqual([
      "1-q",
      "3-p1",
      "4-r1",
      "6-p2",
      "7-r2",
    ])
    expect(startsRun(index.entries[entryId("5-cards")])).toBe(false)
    expect(runPrompt(index, tip)).toBe("6-p2")
  })

  test("pinnedInView: the newest cards entry on the path; none above the first", () => {
    expect(pinnedInView(index, entryId("7-r2"))).toEqual(second)
    expect(pinnedInView(index, entryId("4-r1"))).toEqual(first)
    expect(pinnedInView(index, entryId("1-q"))).toBeNull()
    expect(pinnedInView(index, null)).toBeNull()
  })

  test("pinnedInView: a compaction ends the walk; what its retained tail carries is in view, or none", () => {
    const carried: EntryLike = {
      ...entry("8-c", "7-r2", undefined, { type: "compaction" }),
      carried: { pinned: first },
    }
    const after = entry("9-p3", "8-c", personMessage("p3", { author: "A" }))
    const bare = entry("8-d", "7-r2", undefined, { type: "compaction" })
    const afterBare = entry("9-q", "8-d", personMessage("q", { author: "A" }))
    const grown = indexTree(
      entriesById([...list, carried, after, bare, afterBare]),
    )
    expect(pinnedInView(grown, entryId("9-p3"))).toEqual(first)
    // An entry above the compaction was summarised: out of view.
    expect(pinnedInView(grown, entryId("9-q"))).toBeNull()
  })

  test("pinnedInView on a branch's path: the parent's entry, read by another lane", () => {
    const branch = indexTree(
      entriesById([
        ...list,
        entry("8-b", "3-p1", personMessage("b", { author: "A" })),
      ]),
    )
    expect(pinnedInView(branch, entryId("8-b"))?.lane).toBe(OTHER)
  })
})

describe("conflictAskTime", () => {
  const asked = (id: string, parent: string | null, at: number) =>
    entry(id, parent, toolResultMessage({ content: "Asked.", asked: true }), {
      timestamp: at,
    })
  const list = [
    entry("1-p", null, personMessage("p", { author: "A" })),
    asked("2-a", "1-p", 20),
    entry("3-c", "2-a", undefined, { type: "compaction" }),
    entry("4-r", "3-c", toolResultMessage({ content: "No conflict." })),
    asked("5-a", "4-r", 50),
    entry("6-q", "5-a", personMessage("q", { author: "A" })),
  ]
  const index = indexTree(entriesById(list))

  test("the newest ask on the path, by its time; none before the first", () => {
    expect(conflictAskTime(index, entryId("6-q"))).toBe(50)
    expect(conflictAskTime(index, entryId("1-p"))).toBeNull()
    expect(conflictAskTime(index, null)).toBeNull()
  })

  test("an ask stays a fact past a compaction, and a result that did not ask is none", () => {
    expect(conflictAskTime(index, entryId("4-r"))).toBe(20)
  })
})

describe("newestOnPath", () => {
  const list = [
    entry("1-a", null, personMessage("a", { author: "A" })),
    entry("2-c", "1-a", undefined, { type: "compaction" }),
    entry("3-b", "2-c", personMessage("b", { author: "B" })),
  ]
  const index = indexTree(entriesById(list))
  const author = (e: EntryLike) =>
    e.message?.role === "person" ? e.message.author : undefined

  test("the newest entry read, below a compaction", () => {
    expect(newestOnPath(index, entryId("3-b"), author, () => null)).toBe("B")
  })

  test("a compaction ends the walk with its answer, unless the read passes it", () => {
    const skip = (e: EntryLike) => {
      const said = author(e)
      return said === "B" ? undefined : said
    }
    expect(newestOnPath(index, entryId("3-b"), skip, () => "summary")).toBe(
      "summary",
    )
    expect(newestOnPath(index, entryId("3-b"), skip, "pass")).toBe("A")
  })
})

describe("one-line messages (isLineRole)", () => {
  test("a host's fact and its base's news show as their one line; a pinned entry does not", () => {
    const index = indexTree(
      entriesById([
        entry("1-p", null, personMessage("p", { author: "A" })),
        entry("2-f", "1-p", lineMessage("fact", "✓ added")),
        entry("3-b", "2-f", lineMessage("behind", "↓ new work")),
        entry("4-c", "3-b", {
          role: "pinned",
          content: "",
          pinned: { lane: FIXTURE_THREAD, cards: [], retired: [] },
        }),
      ]),
    )
    expect(
      projectTranscript(index, entryId("4-c")).map(m => [m.role, m.text]),
    ).toEqual([
      ["person", "p"],
      ["fact", "✓ added"],
      ["behind", "↓ new work"],
    ])
  })
})

describe("baseKnown", () => {
  const C = (s: string) => s as never
  const list = [
    entry("1-p", null, personMessage("p", { author: "A" })),
    entry("2-u", "1-p", { role: "update", content: "u", merged: [C("l1")] }),
    entry("3-b", "2-u", {
      role: "behind",
      content: "b",
      behind: {
        from: { kind: "accepted" },
        to: C("l2"),
        files: [],
        overlap: [],
        conflicts: [],
      },
    }),
    entry(
      "4-r",
      "3-b",
      toolResultMessage({ content: "merged", merged: [C("l3")] }),
    ),
    entry("5-c", "4-r", undefined, { type: "compaction" }),
    entry("6-q", "5-c", personMessage("q", { author: "A" })),
  ]
  const index = indexTree(entriesById(list))

  test("the newest base commit heard of or merged on the path: an update's, a behind entry's, a catch_up result's", () => {
    expect(baseKnown(index, entryId("2-u"))).toEqual(["l1"])
    expect(baseKnown(index, entryId("3-b"))).toEqual(["l2"])
    expect(baseKnown(index, entryId("4-r"))).toEqual(["l3"])
    expect(baseKnown(index, entryId("1-p"))).toBeNull()
  })

  test("none past a compaction: a summarised fact is told again", () => {
    expect(baseKnown(index, entryId("6-q"))).toBeNull()
  })
})

describe("a turn's tail", () => {
  const C = (s: string) => s as never
  const list = [
    entry("1-p", null, personMessage("p", { author: "A" })),
    entry("2-a", "1-p", { role: "assistant", content: "calls" }),
    entry(
      "3-r",
      "2-a",
      toolResultMessage({ content: "merged", merged: [C("l2")] }),
    ),
    entry("4-b", "3-r", lineMessage("behind", "↓ new work")),
    entry("5-a", "4-b", { role: "assistant", content: "next" }),
    entry("6-r", "5-a", toolResultMessage({ toolCallId: "c2", content: "ok" })),
  ]
  const index = indexTree(entriesById(list))

  test("turnEntry climbs past a steered fact to the message whose calls it follows", () => {
    expect(turnEntry(index, entryId("4-b"))).toBe("2-a")
    expect(turnEntry(index, entryId("3-r"))).toBe("2-a")
    expect(turnEntry(index, entryId("5-a"))).toBe("5-a")
  })

  test("turnMerged: a turn whose catch_up result merged; not another", () => {
    expect(turnMerged(index, entryId("4-b"))).toBe(true)
    expect(turnMerged(index, entryId("6-r"))).toBe(false)
  })
})

test("entryMessage: the host's own messages show as their line; pi's system message and an entry with none are none", () => {
  const index = indexTree(
    entriesById([
      entry("1-p", null, personMessage("hi", { author: "A" })),
      entry("2-c", "1-p", lineMessage("carry-on", "↻ resumed by Ada")),
      entry("3-x", "2-c", { role: "system", content: "raw" }),
      entry("4-x", "3-x"),
    ]),
  )
  expect(entryMessage(index, entryId("2-c"))).toEqual({
    id: "2-c",
    thread: FIXTURE_THREAD,
    role: "carry-on",
    text: "↻ resumed by Ada",
  })
  expect(entryMessage(index, entryId("3-x"))).toBeNull()
  expect(entryMessage(index, entryId("4-x"))).toBeNull()
})

test("a call's intent is read from its arguments, for any tool", () => {
  const calls = messageToolCalls({
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "a",
        name: "bash",
        arguments: { intent: " Run the tests ", command: "pnpm test" },
      },
      {
        type: "toolCall",
        id: "b",
        name: "mystery",
        arguments: { intent: "Do it" },
      },
      {
        type: "toolCall",
        id: "c",
        name: "read",
        arguments: { path: "a", intent: 3 },
      },
      {
        type: "toolCall",
        id: "d",
        name: "bash",
        arguments: { intent: " ", command: "ls" },
      },
    ],
  })
  expect(calls.map(c => c.intent)).toEqual([
    "Run the tests",
    "Do it",
    undefined,
    undefined,
  ])
})
