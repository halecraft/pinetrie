import { entryId, runId, threadIdFor, writerId } from "@pinetrie/core"
import { createKeeper } from "@pinetrie/keeper"
import {
  type PiSetup,
  SCRIPTED_DESCRIPTION,
  SCRIPTED_VERDICT,
} from "@pinetrie/pi"
import { readVerdicts } from "@pinetrie/reads"
import {
  DIGEST,
  digestOf,
  endReplyOf,
  pendingVerdict,
  setRecord,
  VERDICT,
} from "@pinetrie/rules"
import { newPresenceDoc, readingKey, seatKey } from "@pinetrie/schema"
import { beginRun, writeEntry, writeLaneTip } from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { createDigests, writePendingVerdict } from "./digests.ts"
import {
  archiveTask,
  basics,
  methods,
  placesFor,
  putTask,
  putValue,
  ROOT_ID,
  record,
  row,
  writesOf,
} from "./fakes.ts"
import { createLater } from "./later.ts"
import type { Records } from "./records.ts"
import { endRun } from "./runs.ts"

const lane = threadIdFor("0123456789abcdef")
/** A failure in a test is the test's failure. */
const failed = (error: unknown) => {
  throw error
}

/** The final digest of Ada's ask, `e-1`, as the host writes it. */
const FINAL = setRecord(
  DIGEST,
  {
    prompt: entryId("e-1"),
    headline: "Fixed the rail",
    points: ["`rail.tsx` draws it"],
    at: 1_000,
    final: true,
  },
  ROOT_ID,
)

/**
 * A lane running Ada's ask \`e-1\`, a long one: its agent wrote \`e-2\` to
 * \`e-4\`.
 */
function running(
  answer: string | null | Promise<string | null> = "Fixing the rail.",
  enabled = true,
) {
  const b = basics()
  writeEntry(b.root, row(entryId("e-1"), null))
  for (const [id, parent, content] of [
    ["e-2", "e-1", "looking"],
    ["e-3", "e-2", "editing"],
    ["e-4", "e-3", "checking"],
  ] as const)
    writeEntry(b.root, row(entryId(id), parent, { role: "assistant", content }))
  writeLaneTip(b.root, lane, entryId("e-4"))
  beginRun(b.live, lane, runId("r-1"))
  const presence = newPresenceDoc()
  // The setup and the scribe in one record, so the order of their calls shows.
  const pi = record<
    Pick<PiSetup, "complete" | "skill"> & Pick<Records, "writeValues">
  >({
    skill: async () => ({ path: "SKILL.md", content: "Summarize.", hash: "h" }),
    complete: async () => ({ text: await answer, tokens: 0 }),
    writeValues: async () => {},
  })
  // The thread on an open task's canvas, so its late writes land.
  putTask(b, lane)
  const keeper = createKeeper()
  const later = createLater({
    basics: b,
    keeper,
    records: pi.port,
    placesWriter: placesFor(b).placesWriter,
    drain: () => {},
  })
  const digests = createDigests({
    basics: b,
    later,
    presence,
    piSetup: pi.port,
    enabled,
  })
  const pending = writePendingVerdict({ basics: b, records: pi.port })
  const read = () =>
    presence.reading.set(
      readingKey(seatKey(writerId("ada@example.com"), "s1"), "c1"),
      "e-2",
    )
  return { b, pi, keeper, digests, pending, read }
}

test("a live digest waits for someone to read the thread", async () => {
  const { pi, keeper, digests, read } = running()
  await digests.step(lane, entryId("e-2"), failed)
  await keeper.idle()
  expect(methods(pi.calls)).toEqual([])
  read()
  await digests.step(lane, entryId("e-2"), failed)
  await keeper.idle()
  expect(methods(pi.calls)).toEqual(["skill", "complete", "writeValues"])
  expect(writesOf(pi.calls)).toEqual([
    setRecord(
      DIGEST,
      {
        prompt: entryId("e-1"),
        headline: "Fixing the rail",
        points: [],
        at: 1_000,
        final: false,
      },
      ROOT_ID,
    ),
  ])
})

test("at the run's end, the final digest, read or not; once written, no more", async () => {
  const { b, pi, keeper, digests } = running(
    "Fixed the rail.\n- `rail.tsx` draws it",
  )
  await digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
  await keeper.idle()
  expect(pi.calls.at(-1)?.args).toEqual([[FINAL]])
  putValue(b, FINAL)
  const before = pi.calls.length
  await digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
  await keeper.idle()
  expect(pi.calls.length).toBe(before)
})

test("a live digest that comes back after the final one is dropped", async () => {
  const late = Promise.withResolvers<string | null>()
  const { b, pi, keeper, digests, read } = running(late.promise)
  read()
  await digests.step(lane, entryId("e-2"), failed)
  // The final one is written while the live one is out.
  putValue(
    b,
    setRecord(
      DIGEST,
      {
        prompt: entryId("e-1"),
        headline: "done",
        points: [],
        at: 1,
        final: true,
      },
      ROOT_ID,
    ),
  )
  late.resolve("still working")
  await keeper.idle()
  expect(methods(pi.calls)).toEqual(["skill", "complete"])
})

test.each([
  {
    left: "a plain message appended",
    rows: [row(entryId("e-5"), "e-4", { role: "chat", content: "fyi" })],
    tip: entryId("e-5"),
    next: false,
  },
  {
    left: "the next run started",
    rows: [
      row(entryId("e-5"), "e-4", { role: "chat", content: "next" }),
      row(entryId("e-6"), "e-5", { role: "assistant", content: "starting" }),
    ],
    tip: entryId("e-6"),
    next: true,
  },
])("a run's end digests the ask it answered, after the drain left $left", async ({
  rows,
  tip,
  next,
}) => {
  const { b, pi, keeper, digests } = running(
    "Fixed the rail.\n- `rail.tsx` draws it",
  )
  endRun(b.live, lane, runId("r-1"))
  for (const r of rows) writeEntry(b.root, r)
  writeLaneTip(b.root, lane, tip)
  if (next) beginRun(b.live, lane, runId("r-2"))
  await digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
  await keeper.idle()
  expect(writesOf(pi.calls)).toEqual([FINAL])
  const asked = pi.calls.find(c => c.method === "complete")?.args[0] as {
    user: string
  }
  expect(asked.user).toContain("looking")
  expect(asked.user).not.toContain("starting")
})

test("a reply in another shape is logged, and a live one writes nothing", async () => {
  const { b, pi, keeper, digests, read } = running(
    "Fixing the rail.\nIt is going well.",
  )
  read()
  await digests.step(lane, entryId("e-2"), failed)
  await keeper.idle()
  expect(methods(pi.calls)).toEqual(["skill", "complete"])
  expect(
    b.lines.filter(l => l.includes("the model's digest is not one")),
  ).toHaveLength(1)
})

test.each([
  ["a refused one", "It went well.\nVery well."],
  ["nothing to add", "Nothing to add."],
])("at the run's end, %s clears the live headline for good", async (_, answer) => {
  const { b, pi, keeper, digests } = running(answer)
  const live = setRecord(
    DIGEST,
    {
      prompt: entryId("e-1"),
      headline: "Fixing the rail",
      points: [],
      at: 1,
      final: false,
    },
    ROOT_ID,
  )
  putValue(b, live)
  await digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
  await keeper.idle()
  const cleared = setRecord(
    DIGEST,
    {
      prompt: entryId("e-1"),
      headline: null,
      points: [],
      at: 1_000,
      final: true,
    },
    ROOT_ID,
  )
  expect(writesOf(pi.calls)).toEqual([cleared])
  putValue(b, cleared)
  const before = pi.calls.length
  await digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
  await keeper.idle()
  expect(pi.calls.length).toBe(before)
})

test("a short ask is not asked about", async () => {
  const { b, pi, keeper, digests } = running()
  const short = entryId("e-7")
  writeEntry(b.root, row(short, "e-4", { role: "chat", content: "and?" }))
  writeEntry(
    b.root,
    row(entryId("e-8"), "e-7", { role: "assistant", content: "done" }),
  )
  await digests.ended(ROOT_ID, lane, short, failed)
  await keeper.idle()
  expect(methods(pi.calls)).toEqual([])
})

test("the scripted model's answer is a digest, so the suites have one", () => {
  expect(digestOf(SCRIPTED_DESCRIPTION)?.headline).toBe(SCRIPTED_DESCRIPTION)
})

// ── a run's verdict ──────────────────────────────────────────────────────────

/** Ada's ask `e-1` is stopping: its verdict is pending, as `runs.ts` writes it. */
async function stopping(
  answer: string | null | Promise<string | null>,
  enabled = true,
) {
  const set = running(answer, enabled)
  await set.pending(lane, entryId("e-1"))
  putValue(set.b, writesOf(set.pi.calls)[0] as Parameters<typeof putValue>[1])
  endRun(set.b.live, lane, runId("r-1"))
  return set
}

test("a run's verdict is pending as it stops, at the run's last entry", async () => {
  const { b } = await stopping(null)
  expect(readVerdicts(b.session).get(lane)).toEqual(
    pendingVerdict(lane, entryId("e-1"), entryId("e-4")),
  )
})

test("at a run's end, one request for the verdict and the final digest, written in one write", async () => {
  const { pi, keeper, digests } = await stopping(
    "needs you: which rail to keep\nFixed the rail.\n- `rail.tsx` draws it",
  )
  const before = pi.calls.length
  await digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
  await keeper.idle()
  expect(methods(pi.calls.slice(before))).toEqual([
    "skill",
    "complete",
    "writeValues",
  ])
  expect(pi.calls.at(-1)?.args).toEqual([
    [
      setRecord(VERDICT, {
        lane,
        ask: entryId("e-1"),
        end: entryId("e-4"),
        verdict: {
          kind: "said",
          said: "needsYou",
          reason: "which rail to keep",
        },
      }),
      FINAL,
    ],
  ])
  const asked = pi.calls.find(c => c.method === "complete")?.args[0] as {
    user: string
  }
  expect(asked.user).toContain(
    "Answer with the verdict line, then the summary.",
  )
})

test("with digests off, a run's end asks for its verdict alone, and no live digest is asked", async () => {
  const { pi, keeper, digests, read } = await stopping("done", false)
  read()
  const before = pi.calls.length
  await digests.step(lane, entryId("e-2"), failed)
  await keeper.idle()
  expect(pi.calls.length).toBe(before)
  await digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
  await keeper.idle()
  expect(writesOf(pi.calls).at(-1)).toEqual(
    setRecord(VERDICT, {
      lane,
      ask: entryId("e-1"),
      end: entryId("e-4"),
      verdict: { kind: "said", said: "done", reason: null },
    }),
  )
  const asked = pi.calls.findLast(c => c.method === "complete")?.args[0] as {
    user: string
  }
  expect(asked.user).toContain("Answer with the verdict line alone.")
})

test.each([
  ["fails", null],
  ["answers in another shape", "All done here."],
])("a request that %s leaves the verdict unclassified, never pending", async (_, answer) => {
  const { pi, keeper, digests } = await stopping(answer, false)
  await digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
  await keeper.idle()
  expect(writesOf(pi.calls).at(-1)).toEqual(
    setRecord(VERDICT, {
      lane,
      ask: entryId("e-1"),
      end: entryId("e-4"),
      verdict: { kind: "unclassified" },
    }),
  )
})

test("a failed run's verdict is its error, and no verdict is asked for", async () => {
  const set = running("done", false)
  writeEntry(
    set.b.root,
    row(entryId("e-5"), "e-4", {
      role: "assistant",
      content: "",
      stopReason: "error",
      errorMessage: "rate limited",
    }),
  )
  writeLaneTip(set.b.root, lane, entryId("e-5"))
  await set.pending(lane, entryId("e-1"))
  putValue(set.b, writesOf(set.pi.calls)[0] as Parameters<typeof putValue>[1])
  await set.digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
  await set.keeper.idle()
  expect(methods(set.pi.calls)).not.toContain("complete")
  expect(writesOf(set.pi.calls).at(-1)).toEqual(
    setRecord(VERDICT, {
      lane,
      ask: entryId("e-1"),
      end: entryId("e-5"),
      verdict: { kind: "failed", error: "rate limited" },
    }),
  )
})

test("the scripted model answers a run's end with a verdict and a digest, so the suites have both", () => {
  expect(
    endReplyOf(
      `${SCRIPTED_VERDICT}\n${SCRIPTED_DESCRIPTION}`,
      "verdict and digest",
    ),
  ).toEqual({
    verdict: { said: "done", reason: null },
    digest: { headline: SCRIPTED_DESCRIPTION, points: [] },
  })
})

test("a run's end answered after its task was archived writes nothing and opens no root", async () => {
  const answer = Promise.withResolvers<string | null>()
  const { b, pi, keeper, digests } = await stopping(answer.promise)
  const opened: unknown[] = []
  const root = b.docs.root.bind(b.docs)
  b.docs.root = async id => {
    opened.push(id)
    return root(id)
  }
  await digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
  const written = writesOf(pi.calls).length
  // Its task is archived while the model writes.
  archiveTask(b)
  answer.resolve("done\nFixed the rail.\n- `rail.tsx` draws it")
  await keeper.idle()
  expect([writesOf(pi.calls).length, opened]).toEqual([written, []])
})
