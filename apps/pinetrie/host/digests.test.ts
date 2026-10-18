import { entryId, runId, threadIdFor, writerId } from "@pinetrie/core"
import {
  type PiSetup,
  SCRIPTED_DESCRIPTION,
  SCRIPTED_URGENCY,
} from "@pinetrie/pi"
import { readRunEndReports } from "@pinetrie/reads"
import {
  DIGEST,
  deleteRecord,
  parseDigest,
  parseEndReply,
  pendingRunEndReport,
  RUN_END_REPORT,
  setRecord,
} from "@pinetrie/rules"
import { readingKey, seatKey } from "@pinetrie/schema"
import {
  beginRun,
  newPresenceDoc,
  writeEntry,
  writeLaneTip,
} from "@pinetrie/schema/fixtures"
import { expect, test } from "vitest"
import { createDigests, writePendingRunEndReport } from "./digests.ts"
import {
  archiveCanvas,
  basics,
  methods,
  placesFor,
  putCanvas,
  putValue,
  ROOT_ID,
  record,
  row,
  stepKeeper,
  writtenValues,
} from "./fakes.ts"
import { createLater } from "./later.ts"
import type { StepRecords } from "./records.ts"
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
    Pick<PiSetup, "complete" | "skill"> & Pick<StepRecords, "writeValues">
  >({
    skill: async () => ({ path: "SKILL.md", content: "Summarize.", hash: "h" }),
    complete: async () => ({ text: await answer, tokens: 0 }),
    writeValues: async () => {},
  })
  // The thread on an open canvas, so its late writes land.
  putCanvas(b, lane)
  const keeper = stepKeeper(b, { records: pi.port })
  const later = createLater({
    basics: b,
    keeper,
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
  const pending = writePendingRunEndReport({
    runs: { docOf: () => b.root },
    records: pi.port,
  })
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
  expect(writtenValues(pi.calls)).toEqual([
    setRecord(
      DIGEST,
      {
        prompt: entryId("e-1"),
        headline: "Fixing the rail",
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
    rows: [row(entryId("e-5"), "e-4", { role: "person", content: "fyi" })],
    tip: entryId("e-5"),
    next: false,
  },
  {
    left: "the next run started",
    rows: [
      row(entryId("e-5"), "e-4", { role: "person", content: "next" }),
      row(entryId("e-6"), "e-5", { role: "assistant", content: "starting" }),
    ],
    tip: entryId("e-6"),
    next: true,
  },
])(
  "a run's end digests the ask it answered, after the drain left $left",
  async ({ rows, tip, next }) => {
    const { b, pi, keeper, digests } = running(
      "Fixed the rail.\n- `rail.tsx` draws it",
    )
    endRun(b.live, lane, runId("r-1"))
    for (const r of rows) writeEntry(b.root, r)
    writeLaneTip(b.root, lane, tip)
    if (next) beginRun(b.live, lane, runId("r-2"))
    await digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
    await keeper.idle()
    expect(writtenValues(pi.calls)).toEqual([FINAL])
    const asked = pi.calls.find(c => c.method === "complete")?.args[0] as {
      user: string
    }
    expect(asked.user).toContain("looking")
    expect(asked.user).not.toContain("starting")
  },
)

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
])("at the run's end, %s deletes the live headline", async (_, answer) => {
  const { b, pi, keeper, digests } = running(answer)
  putValue(
    b,
    setRecord(
      DIGEST,
      {
        prompt: entryId("e-1"),
        headline: "Fixing the rail",
        at: 1,
        final: false,
      },
      ROOT_ID,
    ),
  )
  await digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
  await keeper.idle()
  expect(writtenValues(pi.calls)).toEqual([
    deleteRecord(DIGEST, entryId("e-1"), ROOT_ID),
  ])
})

test("a short ask is not asked about", async () => {
  const { b, pi, keeper, digests } = running()
  const short = entryId("e-7")
  writeEntry(b.root, row(short, "e-4", { role: "person", content: "and?" }))
  writeEntry(
    b.root,
    row(entryId("e-8"), "e-7", { role: "assistant", content: "done" }),
  )
  await digests.ended(ROOT_ID, lane, short, failed)
  await keeper.idle()
  expect(methods(pi.calls)).toEqual([])
})

test("the scripted model's answer is a digest, so the suites have one", () => {
  expect(parseDigest(SCRIPTED_DESCRIPTION)?.headline).toBe(SCRIPTED_DESCRIPTION)
})

// ── a run's end report ───────────────────────────────────────────────────────

/** Ada's ask `e-1` is stopping: its end report is pending, as `runs.ts` writes it. */
async function stopping(
  answer: string | null | Promise<string | null>,
  enabled = true,
) {
  const set = running(answer, enabled)
  await set.pending(lane, entryId("e-1"))
  putValue(
    set.b,
    writtenValues(set.pi.calls)[0] as Parameters<typeof putValue>[1],
  )
  endRun(set.b.live, lane, runId("r-1"))
  return set
}

test("a run's end report is pending as it stops, at the run's last entry", async () => {
  const { b } = await stopping(null)
  expect(readRunEndReports(b.session).get(lane)).toEqual(
    pendingRunEndReport(lane, entryId("e-1"), entryId("e-4")),
  )
})

test("at a run's end, one request for the urgency line and the final digest, written in one write", async () => {
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
      setRecord(RUN_END_REPORT, {
        lane,
        ask: entryId("e-1"),
        end: entryId("e-4"),
        report: {
          kind: "modelSaid",
          urgency: "needsYou",
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
    "Answer with the urgency line, then the summary.",
  )
})

test("with digests off, a run's end asks for its urgency line alone, and no live digest is asked", async () => {
  const { pi, keeper, digests, read } = await stopping("done", false)
  read()
  const before = pi.calls.length
  await digests.step(lane, entryId("e-2"), failed)
  await keeper.idle()
  expect(pi.calls.length).toBe(before)
  await digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
  await keeper.idle()
  expect(writtenValues(pi.calls).at(-1)).toEqual(
    setRecord(RUN_END_REPORT, {
      lane,
      ask: entryId("e-1"),
      end: entryId("e-4"),
      report: { kind: "modelSaid", urgency: "done", reason: null },
    }),
  )
  const asked = pi.calls.findLast(c => c.method === "complete")?.args[0] as {
    user: string
  }
  expect(asked.user).toContain("Answer with the urgency line alone.")
})

test.each([
  ["fails", null],
  ["answers in another shape", "All done here."],
])(
  "a request that %s leaves the run-end report unclassified, never pending",
  async (_, answer) => {
    const { pi, keeper, digests } = await stopping(answer, false)
    await digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
    await keeper.idle()
    expect(writtenValues(pi.calls).at(-1)).toEqual(
      setRecord(RUN_END_REPORT, {
        lane,
        ask: entryId("e-1"),
        end: entryId("e-4"),
        report: { kind: "unclassified" },
      }),
    )
  },
)

test("a failed run's end report is its error, and no urgency is asked for", async () => {
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
  putValue(
    set.b,
    writtenValues(set.pi.calls)[0] as Parameters<typeof putValue>[1],
  )
  await set.digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
  await set.keeper.idle()
  expect(methods(set.pi.calls)).not.toContain("complete")
  expect(writtenValues(set.pi.calls).at(-1)).toEqual(
    setRecord(RUN_END_REPORT, {
      lane,
      ask: entryId("e-1"),
      end: entryId("e-5"),
      report: { kind: "failed", error: "rate limited" },
    }),
  )
})

test("the scripted model answers a run's end with an urgency line and a digest, so the suites have both", () => {
  expect(
    parseEndReply(
      `${SCRIPTED_URGENCY}\n${SCRIPTED_DESCRIPTION}`,
      "urgency and digest",
    ),
  ).toEqual({
    urgency: { urgency: "done", reason: null },
    digest: { headline: SCRIPTED_DESCRIPTION, points: [] },
  })
})

test("a run's end answered after its canvas was archived writes nothing and opens no root", async () => {
  const answer = Promise.withResolvers<string | null>()
  const { b, pi, keeper, digests } = await stopping(answer.promise)
  await digests.ended(ROOT_ID, lane, entryId("e-1"), failed)
  // What the late step opens, from here on.
  const opened: unknown[] = []
  const root = b.roots.root
  ;(b.roots as { root: typeof root }).root = async id => {
    opened.push(id)
    return root(id)
  }
  const written = writtenValues(pi.calls).length
  // Its canvas is archived while the model writes.
  archiveCanvas(b)
  answer.resolve("done\nFixed the rail.\n- `rail.tsx` draws it")
  await keeper.idle()
  expect([writtenValues(pi.calls).length, opened]).toEqual([written, []])
})
