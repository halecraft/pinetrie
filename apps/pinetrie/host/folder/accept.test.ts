// The accept's laws (`packages/folder/TECHNICAL.md`, "The accept's laws"),
// each one test titled by its sentence (`scripts/laws.ts`), over a plain
// temp directory: the executor and recovery of `write.ts` as the accept runs
// them. A save races the accept at every boundary between its sub-steps
// (after a path's check, after its move aside and the aside's check, after
// its link), so each interleaving is run, none left to a clock.

import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  type AcceptJournal,
  type AcceptWrite,
  acceptStageDir,
  type InodeStat,
  pointId,
  threadIdFor,
} from "@pinetrie/core"
import {
  checkStage,
  journalPaths,
  keptAsides,
  planAsides,
  planWriteSteps,
  shownMergeId,
} from "@pinetrie/folder"
import { afterEach, beforeEach, expect, test } from "vitest"
import { scanFolder } from "./scan.ts"
import { executeWriteSteps, recoverAccept, walkStage } from "./write.ts"

const ID = "0190-law"
const LANE = threadIdFor("1")
const L1 = pointId("line-1")
const TIP = pointId("turn-1")

let root = ""
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "pinetrie-accept-"))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function put(files: Record<string, string>, under = root) {
  for (const [p, v] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(under, p)), { recursive: true })
    await writeFile(path.join(under, p), v)
  }
}
const read = (p: string) =>
  readFile(path.join(root, p), "utf8").catch(() => null)
const fresh = async () => {
  await rm(root, { recursive: true, force: true })
  await mkdir(root)
}

/** An accept of `shown` (null deletes a path) planned over the folder as it is now, staged as the tar stream stages it. */
async function planned(shown: Record<string, string | null>) {
  const scan = await scanFolder({ root, own: "" })
  const writes: AcceptWrite[] = Object.entries(shown).map(([p, v]) => ({
    path: p,
    expected: scan.get(p) ?? null,
    to: v === null ? null : { kind: "file" },
  }))
  const stage = acceptStageDir(ID)
  await mkdir(path.join(root, stage))
  await put(
    Object.fromEntries(
      Object.entries(shown).flatMap(([p, v]) => (v === null ? [] : [[p, v]])),
    ),
    path.join(root, stage),
  )
  const checked = checkStage(await walkStage(path.join(root, stage)), writes)
  if (checked.kind !== "staged") throw new Error(JSON.stringify(checked))
  const steps = planWriteSteps(writes, stage)
  const journal: AcceptJournal = {
    id: ID,
    lane: LANE,
    record: {
      id: shownMergeId(L1, TIP),
      parents: [L1, TIP],
      made: { kind: "accept", lane: LANE },
      at: 0,
      by: null,
    },
    paths: journalPaths(steps, checked.files, ID),
    status: "open",
  }
  return { steps, journal }
}

/**
 * The accept run to its end with `race` at its `n`th sub-step boundary
 * (0: after its read, before its first step);
 * then a failure put back, as the host does. Answers whether it accepted,
 * the journal as it ended, and how many boundaries it reached and journal
 * writes it made.
 */
async function acceptRacing(
  shown: Record<string, string | null>,
  n: number,
  race: () => Promise<void>,
) {
  const { steps, journal } = await planned(shown)
  // Boundary 0: after the read the accept is planned from, before it writes.
  if (n === 0) await race()
  let saves = 0
  let boundaries = 0
  const { done, journal: after } = await executeWriteSteps({
    root,
    journal,
    steps,
    save: async () => {
      saves++
    },
    reached: async () => {
      if (++boundaries === n) await race()
    },
  })
  if (done.kind === "linked") {
    const ended: AcceptJournal = {
      ...after,
      status: "accepted",
      paths: after.paths.map(p =>
        p.moved === null ? p : { ...p, keptOn: after.record.id },
      ),
    }
    return { accepted: true, journal: ended, saves, boundaries }
  }
  const recovered = await recoverAccept(root, after)
  return {
    accepted: false,
    journal: recovered.kind === "put-back" ? recovered.journal : after,
    saves,
    boundaries,
  }
}

/** Every path a journal kept aside, and whether the folder still holds it. */
const keptContent = async (journal: AcceptJournal) =>
  Promise.all(
    keptAsides([journal]).map(k =>
      readFile(path.join(root, k.aside), "utf8").catch(() => null),
    ),
  )

const SHOWN = { "a.txt": "a-new", "b.txt": "b-new", "c.txt": null }
const BEFORE = { "a.txt": "a-old", "b.txt": "b-old", "c.txt": "c-old" }
/** How many journal writes the accept of `SHOWN` makes: one before each move, one after each link or delete. */
const WRITES = 6
/** How many sub-step boundaries it reaches: checked, moved and linked for each path. */
const BOUNDARIES = 9

test("An accept never replaces a file it has not checked.", async () => {
  // Your write in place, by path: before the accept, or at any boundary.
  for (const target of ["a.txt", "b.txt"])
    for (let n = 0; n <= BOUNDARIES; n++) {
      await fresh()
      await put(BEFORE)
      const yours = `yours, in place, at ${n}`
      const { accepted } = await acceptRacing(SHOWN, n, () =>
        writeFile(path.join(root, target), yours),
      )
      const where = `${target} at boundary ${n}`
      // Either the accept saw your write and put everything back, or your
      // write came after its link, into what it wrote: never under it.
      expect(await read(target), where).toBe(yours)
      if (!accepted)
        for (const [p, v] of Object.entries(BEFORE))
          if (p !== target) expect(await read(p), where).toBe(v)
    }
})

test("A save made by name during an accept survives it.", async () => {
  for (const kind of ["rename", "in place"] as const)
    for (const target of Object.keys(BEFORE))
      for (let n = 1; n <= BOUNDARIES; n++) {
        await fresh()
        await put(BEFORE)
        const yours = `yours, ${kind}, at boundary ${n}`
        const { accepted, journal } = await acceptRacing(SHOWN, n, async () => {
          const at = path.join(root, target)
          if (kind === "rename") {
            await writeFile(`${at}.tmp`, yours)
            await rename(`${at}.tmp`, at)
          } else await writeFile(at, yours)
        })
        const where = `${kind} into ${target} at boundary ${n}`
        // At its path, or kept aside, never lost.
        const held = [await read(target), ...(await keptContent(journal))]
        expect(held, where).toContain(yours)
        if (!accepted)
          for (const [p, v] of Object.entries(BEFORE))
            if (p !== target) expect(await read(p), where).toBe(v)
      }
})

test("A write through a file held across an accept is kept as a concurrent save.", async () => {
  await put(BEFORE)
  const held = await open(path.join(root, "a.txt"), "r+")
  try {
    const { accepted, journal } = await acceptRacing(SHOWN, -1, async () => {})
    expect(accepted).toBe(true)
    expect(await read("a.txt")).toBe("a-new")
    // The app writes through the file it held, after the accept.
    await held.write("yours, late", 0)
    const kept = keptAsides([journal])
    const now = await Promise.all(
      kept.map(async (k): Promise<InodeStat | null> => {
        const s = await lstat(path.join(root, k.aside), { bigint: true })
        return {
          ino: Number(s.ino),
          size: Number(s.size),
          mtimeNs: String(s.mtimeNs),
        }
      }),
    )
    const asides = planAsides(kept, now)
    expect(asides.saves.map(s => s.path)).toEqual(["a.txt"])
    const save = asides.saves[0]
    expect(save?.on).toBe(journal.record.id)
    expect(await read(save?.aside ?? "")).toMatch(/^yours, late/)
    // The others hold what was moved, and go.
    expect(asides.drop).toHaveLength(2)
  } finally {
    await held.close()
  }
})

test("An accept writes exactly the paths whose content changed.", async () => {
  await put({ ...BEFORE, "same.txt": "same", "d/kept.txt": "kept" })
  const before = await scanFolder({ root, own: "" })
  const { accepted } = await acceptRacing(SHOWN, -1, async () => {})
  expect(accepted).toBe(true)
  const after = await scanFolder({ root, own: "" })
  const touched = [...new Set([...before.keys(), ...after.keys()])]
    .filter(p => JSON.stringify(before.get(p)) !== JSON.stringify(after.get(p)))
    .sort()
  expect(touched).toEqual(Object.keys(SHOWN).sort())
})

test("A host that stops during an accept finishes or puts it back at its next start.", async () => {
  const done = { "a.txt": "a-new", "b.txt": "b-new", "c.txt": null }
  for (let n = 1; n <= WRITES + 1; n++) {
    await fresh()
    await put(BEFORE)
    const { steps, journal } = await planned(SHOWN)
    let saves = 0
    let last = journal
    // The host stops at its `n`th journal write: that write is lost with it.
    const ran = await executeWriteSteps({
      root,
      journal,
      steps,
      save: async j => {
        if (++saves === n) throw new Error("stopped")
        last = j
      },
    }).catch(() => null)
    const recovered = await recoverAccept(root, last)
    const files = {
      "a.txt": await read("a.txt"),
      "b.txt": await read("b.txt"),
      "c.txt": await read("c.txt"),
    }
    expect(files, `stopped at write ${n}`).toEqual(
      ran !== null || recovered.kind === "finish" ? done : BEFORE,
    )
  }
})

test("the accept of the laws' changes writes its journal before each move and after each link, and reaches each boundary", async () => {
  await put(BEFORE)
  const ran = await acceptRacing(SHOWN, -1, async () => {})
  expect([ran.saves, ran.boundaries]).toEqual([WRITES, BOUNDARIES])
})
